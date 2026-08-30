// The typed CSG program: the only geometry vocabulary the AI is allowed to
// speak, and the compilation target for the Bambu group tree.
//
// This module is the one piece of code both TypeScript projects import. It is
// deliberately dependency-free -- no node, no DOM, no ApiError -- because
// tsconfig.app.json and tsconfig.server.json are otherwise disjoint. The server
// route maps ShapeProgramError onto ApiError; the client surfaces it as a
// validation message. Validating in both places is intentional: the model's
// output is untrusted input on the way in and on the way out.

export const SHAPE_PROGRAM_VERSION = 1

export type Point2 = readonly [number, number]
export type Triple = readonly [number, number, number]

export type PrimitiveOp =
  | 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus' | 'wedge' | 'extrude' | 'text'

export type BooleanOp = 'union' | 'difference' | 'intersection'

export const PRIMITIVE_OPS: readonly PrimitiveOp[] =
  ['box', 'cylinder', 'sphere', 'cone', 'torus', 'wedge', 'extrude', 'text']
export const BOOLEAN_OPS: readonly BooleanOp[] = ['union', 'difference', 'intersection']

export interface ProgramTransform {
  /** Millimetres. */
  position: Triple
  /** Degrees about x, y, z in that order. */
  rotationDeg: Triple
  scale: Triple
}

export interface ProgramParams {
  widthMm?: number
  depthMm?: number
  heightMm?: number
  radiusMm?: number
  /** Cone top radius; 0 is a true point. */
  topRadiusMm?: number
  /** Torus tube radius. */
  tubeMm?: number
  segments?: number
  /** `extrude` only: outer ring, CCW, millimetres, unclosed. */
  profile?: Point2[]
  /** `extrude` only: inner rings, CW. */
  holes?: Point2[][]
  /** `text` only. */
  text?: string
  fontId?: string
  sizeMm?: number
}

export interface PrimitiveNode {
  id: string
  /** Human-meaningful; this is what makes a later edit addressable. */
  name: string
  op: PrimitiveOp
  params: ProgramParams
  transform: ProgramTransform
}

export interface BooleanNode {
  id: string
  name: string
  op: BooleanOp
  children: PartNode[]
  transform: ProgramTransform
}

export type PartNode = PrimitiveNode | BooleanNode

/** Top-level parts are unioned for preview and export, and land as separate
 *  scene objects when a proposal is applied, so each stays independently
 *  editable afterwards. */
export interface ShapeProgram {
  version: typeof SHAPE_PROGRAM_VERSION
  units: 'mm'
  parts: PartNode[]
}

export const isBooleanNode = (n: PartNode): n is BooleanNode =>
  (BOOLEAN_OPS as readonly string[]).includes(n.op)

// -- Limits -------------------------------------------------------------------

export const PROGRAM_LIMITS = Object.freeze({
  maxNodes: 512,
  maxDepth: 12,
  maxParts: 64,
  maxChildren: 64,
  maxProfilePoints: 2_000,
  maxHoles: 64,
  /** Nothing we fabricate is larger than a few metres; this is a sanity bound. */
  maxCoordMm: 10_000,
  maxDimensionMm: 5_000,
  minSegments: 8,
  maxSegments: 256,
  maxNameLength: 80,
  maxTextLength: 200,
  maxIdLength: 64,
})

export class ShapeProgramError extends Error {
  readonly field: string
  constructor(field: string, message: string) {
    super(message)
    this.name = 'ShapeProgramError'
    this.field = field
  }
}

const bad = (field: string, message: string): never => {
  throw new ShapeProgramError(field, message)
}

// -- Primitives ---------------------------------------------------------------

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(value)) bad(field, `${field} must be an object`)
  return value as Record<string, unknown>
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) bad(field, `${field} has an unknown property "${key}"`)
  }
}

interface NumberBounds { min?: number; max?: number; integer?: boolean }

function requireNumber(value: unknown, field: string, bounds: NumberBounds = {}): number {
  // Numeric strings, NaN and Infinity are refused rather than coerced.
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    bad(field, `${field} must be a finite number`)
  }
  const n = value as number
  if (bounds.integer && !Number.isInteger(n)) bad(field, `${field} must be an integer`)
  if (bounds.min !== undefined && n < bounds.min) bad(field, `${field} must be at least ${bounds.min}`)
  if (bounds.max !== undefined && n > bounds.max) bad(field, `${field} must be at most ${bounds.max}`)
  return n
}

const optionalNumber = (value: unknown, field: string, bounds?: NumberBounds): number | undefined =>
  value === undefined ? undefined : requireNumber(value, field, bounds)

function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') bad(field, `${field} must be a string`)
  const s = value as string
  if (!s.length) bad(field, `${field} must not be empty`)
  if (s.length > maxLength) bad(field, `${field} must be at most ${maxLength} characters`)
  return s
}

function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    bad(field, `${field} must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

function requireTriple(value: unknown, field: string, max: number): Triple {
  if (!Array.isArray(value) || value.length !== 3) bad(field, `${field} must be an array of three numbers`)
  const a = value as unknown[]
  return [
    requireNumber(a[0], `${field}[0]`, { min: -max, max }),
    requireNumber(a[1], `${field}[1]`, { min: -max, max }),
    requireNumber(a[2], `${field}[2]`, { min: -max, max }),
  ]
}

function requirePoint2(value: unknown, field: string): Point2 {
  if (!Array.isArray(value) || value.length !== 2) bad(field, `${field} must be a [x, y] pair`)
  const a = value as unknown[]
  const m = PROGRAM_LIMITS.maxCoordMm
  return [
    requireNumber(a[0], `${field}[0]`, { min: -m, max: m }),
    requireNumber(a[1], `${field}[1]`, { min: -m, max: m }),
  ]
}

function requireRing(value: unknown, field: string): Point2[] {
  if (!Array.isArray(value)) bad(field, `${field} must be an array of points`)
  const a = value as unknown[]
  if (a.length < 3) bad(field, `${field} needs at least three points`)
  if (a.length > PROGRAM_LIMITS.maxProfilePoints) {
    bad(field, `${field} must have at most ${PROGRAM_LIMITS.maxProfilePoints} points`)
  }
  return a.map((p, i) => requirePoint2(p, `${field}[${i}]`))
}

// -- Node validation ----------------------------------------------------------

const TRANSFORM_KEYS = ['position', 'rotationDeg', 'scale'] as const

const IDENTITY: ProgramTransform = {
  position: [0, 0, 0],
  rotationDeg: [0, 0, 0],
  scale: [1, 1, 1],
}

function validateTransform(value: unknown, field: string): ProgramTransform {
  if (value === undefined) return IDENTITY
  const raw = requireObject(value, field)
  rejectUnknownKeys(raw, TRANSFORM_KEYS, field)
  return {
    position: raw.position === undefined
      ? IDENTITY.position
      : requireTriple(raw.position, `${field}.position`, PROGRAM_LIMITS.maxCoordMm),
    rotationDeg: raw.rotationDeg === undefined
      ? IDENTITY.rotationDeg
      : requireTriple(raw.rotationDeg, `${field}.rotationDeg`, 3_600),
    // A zero or negative scale factor inverts or collapses the solid; both
    // produce geometry no kernel can make watertight.
    scale: raw.scale === undefined
      ? IDENTITY.scale
      : (requireTriple(raw.scale, `${field}.scale`, 1_000).map((v, i) =>
          v > 0 ? v : bad(`${field}.scale[${i}]`, `${field}.scale must be positive`)) as unknown as Triple),
  }
}

const PARAM_KEYS = [
  'widthMm', 'depthMm', 'heightMm', 'radiusMm', 'topRadiusMm', 'tubeMm',
  'segments', 'profile', 'holes', 'text', 'fontId', 'sizeMm',
] as const

/** Which params each op actually requires. Anything else present is allowed
 *  through but ignored by the evaluator, so a model that over-specifies is
 *  merely wasteful rather than an error. */
const REQUIRED_PARAMS: Record<PrimitiveOp, readonly (keyof ProgramParams)[]> = {
  box: ['widthMm', 'depthMm', 'heightMm'],
  cylinder: ['radiusMm', 'heightMm'],
  sphere: ['radiusMm'],
  cone: ['radiusMm', 'heightMm'],
  torus: ['radiusMm', 'tubeMm'],
  wedge: ['widthMm', 'depthMm', 'heightMm'],
  extrude: ['profile', 'heightMm'],
  text: ['text', 'heightMm'],
}

function validateParams(value: unknown, op: PrimitiveOp, field: string): ProgramParams {
  const raw = requireObject(value ?? {}, field)
  rejectUnknownKeys(raw, PARAM_KEYS, field)
  const dim = { min: 0, max: PROGRAM_LIMITS.maxDimensionMm }
  const positive = { min: 1e-6, max: PROGRAM_LIMITS.maxDimensionMm }

  const params: ProgramParams = {
    widthMm: optionalNumber(raw.widthMm, `${field}.widthMm`, positive),
    depthMm: optionalNumber(raw.depthMm, `${field}.depthMm`, positive),
    heightMm: optionalNumber(raw.heightMm, `${field}.heightMm`, positive),
    radiusMm: optionalNumber(raw.radiusMm, `${field}.radiusMm`, positive),
    topRadiusMm: optionalNumber(raw.topRadiusMm, `${field}.topRadiusMm`, dim),
    tubeMm: optionalNumber(raw.tubeMm, `${field}.tubeMm`, positive),
    segments: optionalNumber(raw.segments, `${field}.segments`, {
      min: PROGRAM_LIMITS.minSegments, max: PROGRAM_LIMITS.maxSegments, integer: true,
    }),
    sizeMm: optionalNumber(raw.sizeMm, `${field}.sizeMm`, positive),
  }

  if (raw.profile !== undefined) params.profile = requireRing(raw.profile, `${field}.profile`)
  if (raw.holes !== undefined) {
    if (!Array.isArray(raw.holes)) bad(`${field}.holes`, `${field}.holes must be an array`)
    const holes = raw.holes as unknown[]
    if (holes.length > PROGRAM_LIMITS.maxHoles) {
      bad(`${field}.holes`, `${field}.holes must have at most ${PROGRAM_LIMITS.maxHoles} rings`)
    }
    params.holes = holes.map((h, i) => requireRing(h, `${field}.holes[${i}]`))
  }
  if (raw.text !== undefined) params.text = requireString(raw.text, `${field}.text`, PROGRAM_LIMITS.maxTextLength)
  if (raw.fontId !== undefined) params.fontId = requireString(raw.fontId, `${field}.fontId`, PROGRAM_LIMITS.maxNameLength)

  for (const key of REQUIRED_PARAMS[op]) {
    if (params[key] === undefined) bad(`${field}.${key}`, `${op} requires params.${key}`)
  }
  // A torus whose tube is at least its radius self-intersects at the centre.
  if (op === 'torus' && params.tubeMm! >= params.radiusMm!) {
    bad(`${field}.tubeMm`, 'torus tubeMm must be smaller than radiusMm')
  }
  return params
}

const PRIMITIVE_KEYS = ['id', 'name', 'op', 'params', 'transform'] as const
const BOOLEAN_KEYS = ['id', 'name', 'op', 'children', 'transform'] as const

interface Counter { nodes: number }

function validateNode(value: unknown, field: string, depth: number, count: Counter, ids: Set<string>): PartNode {
  if (depth > PROGRAM_LIMITS.maxDepth) {
    bad(field, `program nests deeper than ${PROGRAM_LIMITS.maxDepth} levels`)
  }
  if (++count.nodes > PROGRAM_LIMITS.maxNodes) {
    bad(field, `program has more than ${PROGRAM_LIMITS.maxNodes} nodes`)
  }

  const raw = requireObject(value, field)
  const op = requireEnum(raw.op, `${field}.op`, [...PRIMITIVE_OPS, ...BOOLEAN_OPS])
  const id = requireString(raw.id, `${field}.id`, PROGRAM_LIMITS.maxIdLength)
  if (ids.has(id)) bad(`${field}.id`, `duplicate part id "${id}"`)
  ids.add(id)
  const name = requireString(raw.name, `${field}.name`, PROGRAM_LIMITS.maxNameLength)

  if ((BOOLEAN_OPS as readonly string[]).includes(op)) {
    rejectUnknownKeys(raw, BOOLEAN_KEYS, field)
    if (!Array.isArray(raw.children)) bad(`${field}.children`, `${field}.children must be an array`)
    const children = raw.children as unknown[]
    if (!children.length) bad(`${field}.children`, `${op} needs at least one child`)
    if (children.length > PROGRAM_LIMITS.maxChildren) {
      bad(`${field}.children`, `${field}.children must have at most ${PROGRAM_LIMITS.maxChildren} entries`)
    }
    return {
      id, name,
      op: op as BooleanOp,
      children: children.map((c, i) => validateNode(c, `${field}.children[${i}]`, depth + 1, count, ids)),
      transform: validateTransform(raw.transform, `${field}.transform`),
    }
  }

  rejectUnknownKeys(raw, PRIMITIVE_KEYS, field)
  return {
    id, name,
    op: op as PrimitiveOp,
    params: validateParams(raw.params, op as PrimitiveOp, `${field}.params`),
    transform: validateTransform(raw.transform, `${field}.transform`),
  }
}

const PROGRAM_KEYS = ['version', 'units', 'parts'] as const

/**
 * Rebuilds the program from scratch rather than passing the input through, so
 * nothing unvalidated can survive. Throws ShapeProgramError on the first
 * problem, naming the offending field.
 */
export function validateShapeProgram(value: unknown): ShapeProgram {
  const raw = requireObject(value, 'program')
  rejectUnknownKeys(raw, PROGRAM_KEYS, 'program')

  const version = requireNumber(raw.version, 'program.version', { integer: true })
  if (version !== SHAPE_PROGRAM_VERSION) {
    bad('program.version', `unsupported program version ${version}`)
  }
  requireEnum(raw.units, 'program.units', ['mm'] as const)

  if (!Array.isArray(raw.parts)) bad('program.parts', 'program.parts must be an array')
  const parts = raw.parts as unknown[]
  if (!parts.length) bad('program.parts', 'program.parts must not be empty')
  if (parts.length > PROGRAM_LIMITS.maxParts) {
    bad('program.parts', `program.parts must have at most ${PROGRAM_LIMITS.maxParts} entries`)
  }

  const count: Counter = { nodes: 0 }
  const ids = new Set<string>()
  return {
    version: SHAPE_PROGRAM_VERSION,
    units: 'mm',
    parts: parts.map((p, i) => validateNode(p, `program.parts[${i}]`, 0, count, ids)),
  }
}

/** Every node in the tree, parents before children. */
export function* walkProgram(parts: readonly PartNode[]): Generator<PartNode> {
  for (const p of parts) {
    yield p
    if (isBooleanNode(p)) yield* walkProgram(p.children)
  }
}

export const programNodeIds = (program: ShapeProgram): string[] =>
  [...walkProgram(program.parts)].map(n => n.id)
