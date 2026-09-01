// The typed vector drawing: the only 2D-artwork vocabulary the AI is allowed to
// speak when it traces a photograph, and the compilation target for the
// Playground's path objects.
//
// Like lib/contracts/shapeProgram.ts this module is imported by both TypeScript
// projects, so it is deliberately dependency-free -- no node, no DOM, no
// ApiError. The server route maps VectorDrawingError onto ApiError; the client
// surfaces it as a validation message. Validating in both places is intentional:
// the model's output is untrusted input on the way in and on the way out.

export const VECTOR_DRAWING_VERSION = 1

/** Millimetres, y-up (CAD convention), matching src/geometry/vec.ts. */
export type Vec2 = readonly [number, number]

/**
 * A minimal path vocabulary: move, line, cubic bezier, close. One `VectorPath`
 * may hold several subpaths -- every `M` starts a new one -- and a hole is just
 * a subpath wound opposite its container (even-odd fill).
 */
export type PathCommand =
  | { cmd: 'M'; to: Vec2 }
  | { cmd: 'L'; to: Vec2 }
  | { cmd: 'C'; c1: Vec2; c2: Vec2; to: Vec2 }
  | { cmd: 'Z' }

export type PathCommandKind = PathCommand['cmd']

export const PATH_COMMANDS: readonly PathCommandKind[] = ['M', 'L', 'C', 'Z']

export interface VectorPath {
  /** Stable, unique within the drawing; how a later edit stays addressable. */
  id: string
  /** Short human-readable label. */
  name: string
  /** At least one subpath. The first command is always `M`. */
  commands: PathCommand[]
  /** CSS hex (`#rrggbb`). Presentation only -- never reaches an exporter's
   *  geometry, only its fill attribute. */
  fill?: string
}

/** Top-level paths are painted in order; each lands as its own scene object
 *  when a proposal is applied, so each stays independently editable. */
export interface VectorDrawing {
  version: typeof VECTOR_DRAWING_VERSION
  units: 'mm'
  /** The artwork box in millimetres. Paths already sit inside this frame. */
  widthMm: number
  heightMm: number
  paths: VectorPath[]
}

// -- Limits -----------------------------------------------------------------

export const VECTOR_LIMITS = Object.freeze({
  maxPaths: 64,
  maxCommandsPerPath: 4_000,
  maxCommandsTotal: 20_000,
  /** Nothing traced from a photograph is metres across; a sanity bound. */
  maxCoordMm: 5_000,
  maxDimensionMm: 5_000,
  maxNameLength: 80,
  maxIdLength: 64,
})

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/

export class VectorDrawingError extends Error {
  readonly field: string
  constructor(field: string, message: string) {
    super(message)
    this.name = 'VectorDrawingError'
    this.field = field
  }
}

const bad = (field: string, message: string): never => {
  throw new VectorDrawingError(field, message)
}

// -- Primitives -----------------------------------------------------------------

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(value)) bad(field, `${field} must be an object`)
  return value as Record<string, unknown>
}

function rejectUnknownKeys(
  value: Record<string, unknown>, allowed: readonly string[], field: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) bad(field, `${field} has an unknown property "${key}"`)
  }
}

function requireNumber(value: unknown, field: string, bounds: { min?: number; max?: number } = {}): number {
  // Numeric strings, NaN and Infinity are refused rather than coerced.
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    bad(field, `${field} must be a finite number`)
  }
  const n = value as number
  if (bounds.min !== undefined && n < bounds.min) bad(field, `${field} must be at least ${bounds.min}`)
  if (bounds.max !== undefined && n > bounds.max) bad(field, `${field} must be at most ${bounds.max}`)
  return n
}

function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') bad(field, `${field} must be a string`)
  const s = value as string
  if (!s.length) bad(field, `${field} must not be empty`)
  if (s.length > maxLength) bad(field, `${field} must be at most ${maxLength} characters`)
  return s
}

function requireVec2(value: unknown, field: string): Vec2 {
  if (!Array.isArray(value) || value.length !== 2) bad(field, `${field} must be an [x, y] pair`)
  const a = value as unknown[]
  const m = VECTOR_LIMITS.maxCoordMm
  return [
    requireNumber(a[0], `${field}[0]`, { min: -m, max: m }),
    requireNumber(a[1], `${field}[1]`, { min: -m, max: m }),
  ]
}

// -- Commands -----------------------------------------------------------------

const COMMAND_KEYS: Record<PathCommandKind, readonly string[]> = {
  M: ['cmd', 'to'],
  L: ['cmd', 'to'],
  C: ['cmd', 'c1', 'c2', 'to'],
  Z: ['cmd'],
}

function validateCommand(value: unknown, field: string): PathCommand {
  const raw = requireObject(value, field)
  const cmd = raw.cmd
  if (typeof cmd !== 'string' || !(PATH_COMMANDS as readonly string[]).includes(cmd)) {
    bad(`${field}.cmd`, `${field}.cmd must be one of: ${PATH_COMMANDS.join(', ')}`)
  }
  const kind = cmd as PathCommandKind
  rejectUnknownKeys(raw, COMMAND_KEYS[kind], field)
  switch (kind) {
    case 'M': return { cmd: 'M', to: requireVec2(raw.to, `${field}.to`) }
    case 'L': return { cmd: 'L', to: requireVec2(raw.to, `${field}.to`) }
    case 'C': return {
      cmd: 'C',
      c1: requireVec2(raw.c1, `${field}.c1`),
      c2: requireVec2(raw.c2, `${field}.c2`),
      to: requireVec2(raw.to, `${field}.to`),
    }
    case 'Z': return { cmd: 'Z' }
  }
}

const PATH_KEYS = ['id', 'name', 'commands', 'fill'] as const

function validatePath(value: unknown, field: string, count: { total: number }, ids: Set<string>): VectorPath {
  const raw = requireObject(value, field)
  rejectUnknownKeys(raw, PATH_KEYS, field)

  const id = requireString(raw.id, `${field}.id`, VECTOR_LIMITS.maxIdLength)
  if (ids.has(id)) bad(`${field}.id`, `duplicate path id "${id}"`)
  ids.add(id)
  const name = requireString(raw.name, `${field}.name`, VECTOR_LIMITS.maxNameLength)

  if (!Array.isArray(raw.commands)) bad(`${field}.commands`, `${field}.commands must be an array`)
  const rawCommands = raw.commands as unknown[]
  if (!rawCommands.length) bad(`${field}.commands`, `${field}.commands must not be empty`)
  if (rawCommands.length > VECTOR_LIMITS.maxCommandsPerPath) {
    bad(`${field}.commands`,
      `${field}.commands must have at most ${VECTOR_LIMITS.maxCommandsPerPath} entries`)
  }
  count.total += rawCommands.length
  if (count.total > VECTOR_LIMITS.maxCommandsTotal) {
    bad(`${field}.commands`,
      `the drawing has more than ${VECTOR_LIMITS.maxCommandsTotal} path commands`)
  }

  const commands: PathCommand[] = []
  // A subpath opens on `M` and closes on `Z`; `L`/`C`/`Z` outside an open
  // subpath are meaningless, which also forces the first command to be `M`.
  let open = false
  rawCommands.forEach((entry, i) => {
    const command = validateCommand(entry, `${field}.commands[${i}]`)
    if (command.cmd === 'M') {
      open = true
    } else if (!open) {
      bad(`${field}.commands[${i}]`,
        `${field}.commands[${i}] (${command.cmd}) has no open subpath; a subpath starts with M`)
    } else if (command.cmd === 'Z') {
      open = false
    }
    commands.push(command)
  })

  const path: VectorPath = { id, name, commands }
  if (raw.fill !== undefined) {
    if (typeof raw.fill !== 'string' || !HEX_COLOUR.test(raw.fill)) {
      bad(`${field}.fill`, `${field}.fill must be a #rrggbb colour`)
    }
    path.fill = (raw.fill as string).toLowerCase()
  }
  return path
}

const DRAWING_KEYS = ['version', 'units', 'widthMm', 'heightMm', 'paths'] as const

/**
 * Rebuilds the drawing from scratch rather than passing the input through, so
 * nothing unvalidated can survive. Throws VectorDrawingError on the first
 * problem, naming the offending field.
 */
export function validateVectorDrawing(value: unknown): VectorDrawing {
  const raw = requireObject(value, 'drawing')
  rejectUnknownKeys(raw, DRAWING_KEYS, 'drawing')

  const version = requireNumber(raw.version, 'drawing.version')
  if (version !== VECTOR_DRAWING_VERSION) {
    bad('drawing.version', `unsupported drawing version ${version}`)
  }
  if (raw.units !== 'mm') bad('drawing.units', 'drawing.units must be "mm"')

  const widthMm = requireNumber(raw.widthMm, 'drawing.widthMm', {
    min: 1e-6, max: VECTOR_LIMITS.maxDimensionMm,
  })
  const heightMm = requireNumber(raw.heightMm, 'drawing.heightMm', {
    min: 1e-6, max: VECTOR_LIMITS.maxDimensionMm,
  })

  if (!Array.isArray(raw.paths)) bad('drawing.paths', 'drawing.paths must be an array')
  const paths = raw.paths as unknown[]
  if (!paths.length) bad('drawing.paths', 'drawing.paths must not be empty')
  if (paths.length > VECTOR_LIMITS.maxPaths) {
    bad('drawing.paths', `drawing.paths must have at most ${VECTOR_LIMITS.maxPaths} entries`)
  }

  const count = { total: 0 }
  const ids = new Set<string>()
  return {
    version: VECTOR_DRAWING_VERSION,
    units: 'mm',
    widthMm,
    heightMm,
    paths: paths.map((p, i) => validatePath(p, `drawing.paths[${i}]`, count, ids)),
  }
}

export const vectorPathIds = (drawing: VectorDrawing): string[] =>
  drawing.paths.map(p => p.id)

/** Every command in the drawing, path by path, in paint order. */
export function* walkVectorDrawing(drawing: VectorDrawing): Generator<PathCommand> {
  for (const path of drawing.paths) yield* path.commands
}
