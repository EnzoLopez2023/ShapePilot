// Complete runtime validation for the design-document write routes.
//
// Same posture as server/validation/keycapTray.ts: the whole body is validated
// before any repository call opens a transaction, the result is rebuilt rather
// than passed through, and a rejection is a stable typed 400 naming the field.
//
// The scene tree is the interesting part. It is a recursive discriminated union
// with a group node, so the walk is bounded on three axes -- total nodes, depth
// and contour size -- because "a valid document" and "a document that will not
// exhaust the mesher" are different questions and both have to be answered here.
import { ApiError } from '../errors/ApiError.ts'
import type {
  DesignDocumentInput, DesignDocumentKind,
} from '../../lib/db/repositories/contracts.ts'
import { DESIGN_DOCUMENT_KINDS } from '../../lib/db/repositories/contracts.ts'

export const OBJECT_TYPES = ['shape2d', 'path', 'text', 'solid', 'imported', 'group'] as const
export const SHAPE_KINDS = ['circle', 'ellipse', 'rect', 'square', 'triangle', 'polygon'] as const
export const SOLID_KINDS = ['box', 'cylinder', 'sphere', 'cone', 'torus', 'wedge'] as const
export const IMPORT_FORMATS = ['stl', 'obj', 'svg', 'dxf', '3mf'] as const
export const OBJECT_MODES = ['solid', 'hole'] as const
export const CUT_TYPES = ['exterior', 'interior', 'pocket', 'online', 'guide'] as const
export const CHAT_ROLES = ['user', 'assistant'] as const

/**
 * Bounds. Every one is far beyond a real design; their only job is to keep a
 * hostile or broken payload out of storage and away from the mesher.
 */
export const LIMITS = {
  nameMaxLength: 200,
  notesMaxLength: 4_000,
  textMaxLength: 500,
  idMaxLength: 64,
  fontIdMaxLength: 80,
  filenameMaxLength: 400,
  colorMaxLength: 32,
  maxObjects: 2_000,
  maxDepth: 12,
  maxContoursPerObject: 256,
  maxPointsPerContour: 20_000,
  maxChatTurns: 500,
  chatTextMaxLength: 8_000,
  /** Any coordinate or dimension, millimetres. */
  maxCoordMm: 100_000,
  maxDimensionMm: 100_000,
  minSegments: 3,
  maxSegments: 512,
  /** Guards the JSON column against a payload express.json would still accept. */
  maxDocJsonBytes: 1_500_000,
} as const

const bad = (field: string, message: string): never => {
  throw new ApiError(400, 'bad_request', message, { field })
}

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

function requireString(value: unknown, field: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string') bad(field, `${field} must be a string`)
  const s = value as string
  if (!allowEmpty && !s.trim().length) bad(field, `${field} is required`)
  if (s.length > maxLength) bad(field, `${field} must be at most ${maxLength} characters`)
  return s
}

const optionalString = (value: unknown, field: string, maxLength: number): string | undefined =>
  value === undefined || value === null ? undefined : requireString(value, field, maxLength, true)

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') bad(field, `${field} must be true or false`)
  return value as boolean
}

function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    bad(field, `${field} must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

type Triple = [number, number, number]

function requireTriple(value: unknown, field: string, max: number): Triple {
  if (!Array.isArray(value) || value.length !== 3) {
    bad(field, `${field} must be an array of three numbers`)
  }
  const a = value as unknown[]
  return [
    requireNumber(a[0], `${field}[0]`, { min: -max, max }),
    requireNumber(a[1], `${field}[1]`, { min: -max, max }),
    requireNumber(a[2], `${field}[2]`, { min: -max, max }),
  ]
}

const TRANSFORM_KEYS = ['position', 'rotationDeg', 'scale'] as const

function validateTransform(value: unknown, field: string): Record<string, unknown> {
  const raw = requireObject(value, field)
  rejectUnknownKeys(raw, TRANSFORM_KEYS, field)
  const scale = requireTriple(raw.scale, `${field}.scale`, 10_000)
  // A zero or negative factor collapses or inverts the solid; no kernel can
  // make that watertight, so it is refused here rather than failing later.
  scale.forEach((v, i) => { if (v <= 0) bad(`${field}.scale[${i}]`, `${field}.scale must be positive`) })
  return {
    position: requireTriple(raw.position, `${field}.position`, LIMITS.maxCoordMm),
    rotationDeg: requireTriple(raw.rotationDeg, `${field}.rotationDeg`, 3_600),
    scale,
  }
}

function validateContour(value: unknown, field: string): [number, number][] {
  if (!Array.isArray(value)) bad(field, `${field} must be an array of points`)
  const a = value as unknown[]
  if (a.length < 3) bad(field, `${field} needs at least three points`)
  if (a.length > LIMITS.maxPointsPerContour) {
    bad(field, `${field} must have at most ${LIMITS.maxPointsPerContour} points`)
  }
  return a.map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2) bad(`${field}[${i}]`, `${field}[${i}] must be a [x, y] pair`)
    const pt = p as unknown[]
    const m = LIMITS.maxCoordMm
    return [
      requireNumber(pt[0], `${field}[${i}][0]`, { min: -m, max: m }),
      requireNumber(pt[1], `${field}[${i}][1]`, { min: -m, max: m }),
    ] as [number, number]
  })
}

const CUT_KEYS = ['type', 'depthMm'] as const

function validateCut(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined
  const raw = requireObject(value, field)
  rejectUnknownKeys(raw, CUT_KEYS, field)
  const cut: Record<string, unknown> = { type: requireEnum(raw.type, `${field}.type`, CUT_TYPES) }
  const depth = optionalNumber(raw.depthMm, `${field}.depthMm`, { min: 0, max: LIMITS.maxDimensionMm })
  if (depth !== undefined) cut.depthMm = depth
  return cut
}

const BASE_KEYS = ['id', 'name', 'transform', 'mode', 'visible', 'locked', 'color', 'cut', 'type']
const SHAPE_PARAM_KEYS =
  ['widthMm', 'heightMm', 'radiusMm', 'radiusYMm', 'sides', 'cornerRadiusMm'] as const
const SOLID_PARAM_KEYS =
  ['widthMm', 'depthMm', 'heightMm', 'radiusMm', 'topRadiusMm', 'tubeMm', 'segments'] as const
const ASSET_KEYS = ['hash', 'filename', 'byteLength'] as const

const dim = { min: 0, max: LIMITS.maxDimensionMm }

function validateParams(
  value: unknown, allowed: readonly string[], field: string,
): Record<string, number> {
  const raw = requireObject(value ?? {}, field)
  rejectUnknownKeys(raw, allowed, field)
  const out: Record<string, number> = {}
  for (const key of allowed) {
    const bounds = key === 'sides'
      ? { min: 3, max: 512, integer: true }
      : key === 'segments'
        ? { min: LIMITS.minSegments, max: LIMITS.maxSegments, integer: true }
        : dim
    const n = optionalNumber(raw[key], `${field}.${key}`, bounds)
    if (n !== undefined) out[key] = n
  }
  return out
}

interface WalkState { count: number }

function validateObject(value: unknown, field: string, depth: number, state: WalkState): Record<string, unknown> {
  if (depth > LIMITS.maxDepth) bad(field, `objects nest deeper than ${LIMITS.maxDepth} levels`)
  if (++state.count > LIMITS.maxObjects) {
    bad(field, `the document has more than ${LIMITS.maxObjects} objects`)
  }

  const raw = requireObject(value, field)
  const type = requireEnum(raw.type, `${field}.type`, OBJECT_TYPES)

  const base = {
    id: requireString(raw.id, `${field}.id`, LIMITS.idMaxLength),
    name: requireString(raw.name, `${field}.name`, LIMITS.nameMaxLength),
    transform: validateTransform(raw.transform, `${field}.transform`),
    mode: requireEnum(raw.mode, `${field}.mode`, OBJECT_MODES),
    visible: requireBoolean(raw.visible, `${field}.visible`),
    locked: requireBoolean(raw.locked, `${field}.locked`),
    type,
  } as Record<string, unknown>

  const color = optionalString(raw.color, `${field}.color`, LIMITS.colorMaxLength)
  if (color !== undefined) base.color = color
  const cut = validateCut(raw.cut, `${field}.cut`)
  if (cut !== undefined) base.cut = cut

  const thickness = (): void => {
    const t = optionalNumber(raw.thicknessMm, `${field}.thicknessMm`, dim)
    if (t !== undefined) base.thicknessMm = t
  }

  switch (type) {
    case 'shape2d':
      rejectUnknownKeys(raw, [...BASE_KEYS, 'shape', 'params', 'thicknessMm'], field)
      base.shape = requireEnum(raw.shape, `${field}.shape`, SHAPE_KINDS)
      base.params = validateParams(raw.params, SHAPE_PARAM_KEYS, `${field}.params`)
      thickness()
      return base

    case 'path': {
      rejectUnknownKeys(raw, [...BASE_KEYS, 'rings', 'thicknessMm', 'source'], field)
      if (!Array.isArray(raw.rings)) bad(`${field}.rings`, `${field}.rings must be an array`)
      const rings = raw.rings as unknown[]
      if (!rings.length) bad(`${field}.rings`, `${field}.rings must not be empty`)
      if (rings.length > LIMITS.maxContoursPerObject) {
        bad(`${field}.rings`, `${field}.rings must have at most ${LIMITS.maxContoursPerObject} contours`)
      }
      base.rings = rings.map((r, i) => validateContour(r, `${field}.rings[${i}]`))
      thickness()
      if (raw.source !== undefined && raw.source !== null) {
        const src = requireObject(raw.source, `${field}.source`)
        rejectUnknownKeys(src, ['format', 'filename'], `${field}.source`)
        base.source = {
          format: requireEnum(src.format, `${field}.source.format`, IMPORT_FORMATS),
          filename: requireString(src.filename, `${field}.source.filename`, LIMITS.filenameMaxLength),
        }
      }
      return base
    }

    case 'text':
      rejectUnknownKeys(
        raw, [...BASE_KEYS, 'text', 'fontId', 'sizeMm', 'letterSpacing', 'thicknessMm'], field)
      base.text = requireString(raw.text, `${field}.text`, LIMITS.textMaxLength, true)
      base.fontId = requireString(raw.fontId, `${field}.fontId`, LIMITS.fontIdMaxLength)
      base.sizeMm = requireNumber(raw.sizeMm, `${field}.sizeMm`, { min: 0, max: LIMITS.maxDimensionMm })
      {
        const ls = optionalNumber(raw.letterSpacing, `${field}.letterSpacing`,
          { min: -LIMITS.maxDimensionMm, max: LIMITS.maxDimensionMm })
        if (ls !== undefined) base.letterSpacing = ls
      }
      thickness()
      return base

    case 'solid':
      rejectUnknownKeys(raw, [...BASE_KEYS, 'primitive', 'params'], field)
      base.primitive = requireEnum(raw.primitive, `${field}.primitive`, SOLID_KINDS)
      base.params = validateParams(raw.params, SOLID_PARAM_KEYS, `${field}.params`)
      return base

    case 'imported': {
      rejectUnknownKeys(raw, [...BASE_KEYS, 'format', 'asset'], field)
      base.format = requireEnum(raw.format, `${field}.format`, IMPORT_FORMATS)
      const asset = requireObject(raw.asset, `${field}.asset`)
      rejectUnknownKeys(asset, ASSET_KEYS, `${field}.asset`)
      const hash = requireString(asset.hash, `${field}.asset.hash`, 64)
      // The hash is the asset-store key, so a malformed one would dangle.
      if (!/^[0-9a-f]{64}$/.test(hash)) {
        bad(`${field}.asset.hash`, `${field}.asset.hash must be a SHA-256 hex digest`)
      }
      base.asset = {
        hash,
        filename: requireString(asset.filename, `${field}.asset.filename`, LIMITS.filenameMaxLength),
        byteLength: requireNumber(asset.byteLength, `${field}.asset.byteLength`,
          { min: 0, max: Number.MAX_SAFE_INTEGER, integer: true }),
      }
      return base
    }

    case 'group': {
      rejectUnknownKeys(raw, [...BASE_KEYS, 'children'], field)
      if (!Array.isArray(raw.children)) bad(`${field}.children`, `${field}.children must be an array`)
      base.children = (raw.children as unknown[])
        .map((c, i) => validateObject(c, `${field}.children[${i}]`, depth + 1, state))
      return base
    }
  }
}

const CNC_KEYS = ['kind', 'id', 'label', 'toolDiameterMm', 'stockThicknessMm', 'maxDepthPerPassMm'] as const
const PRINTER_KEYS = [
  'kind', 'id', 'label', 'buildMm', 'dualNozzleBuildMm', 'nozzleDiameterMm',
  'maxNozzleC', 'maxBedC', 'chamberC',
] as const

function validateMachine(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined
  const raw = requireObject(value, field)
  const kind = requireEnum(raw.kind, `${field}.kind`, ['cnc', 'printer'] as const)
  const common = {
    kind,
    id: requireString(raw.id, `${field}.id`, LIMITS.idMaxLength),
    label: requireString(raw.label, `${field}.label`, LIMITS.nameMaxLength),
  }

  if (kind === 'cnc') {
    rejectUnknownKeys(raw, CNC_KEYS, field)
    return {
      ...common,
      toolDiameterMm: requireNumber(raw.toolDiameterMm, `${field}.toolDiameterMm`, dim),
      stockThicknessMm: requireNumber(raw.stockThicknessMm, `${field}.stockThicknessMm`, dim),
      maxDepthPerPassMm: requireNumber(raw.maxDepthPerPassMm, `${field}.maxDepthPerPassMm`, dim),
    }
  }

  rejectUnknownKeys(raw, PRINTER_KEYS, field)
  const out: Record<string, unknown> = {
    ...common,
    buildMm: requireTriple(raw.buildMm, `${field}.buildMm`, LIMITS.maxDimensionMm),
    nozzleDiameterMm: requireNumber(raw.nozzleDiameterMm, `${field}.nozzleDiameterMm`, dim),
    maxNozzleC: requireNumber(raw.maxNozzleC, `${field}.maxNozzleC`, { min: 0, max: 2_000 }),
    maxBedC: requireNumber(raw.maxBedC, `${field}.maxBedC`, { min: 0, max: 2_000 }),
  }
  if (raw.dualNozzleBuildMm !== undefined && raw.dualNozzleBuildMm !== null) {
    out.dualNozzleBuildMm =
      requireTriple(raw.dualNozzleBuildMm, `${field}.dualNozzleBuildMm`, LIMITS.maxDimensionMm)
  }
  const chamber = optionalNumber(raw.chamberC, `${field}.chamberC`, { min: 0, max: 2_000 })
  if (chamber !== undefined) out.chamberC = chamber
  return out
}

const CHAT_KEYS = ['id', 'role', 'text', 'at', 'summary'] as const

function validateChat(value: unknown, field: string): Record<string, unknown>[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) bad(field, `${field} must be an array`)
  const turns = value as unknown[]
  if (turns.length > LIMITS.maxChatTurns) {
    bad(field, `${field} must have at most ${LIMITS.maxChatTurns} turns`)
  }
  return turns.map((t, i) => {
    const raw = requireObject(t, `${field}[${i}]`)
    rejectUnknownKeys(raw, CHAT_KEYS, `${field}[${i}]`)
    const turn: Record<string, unknown> = {
      id: requireString(raw.id, `${field}[${i}].id`, LIMITS.idMaxLength),
      role: requireEnum(raw.role, `${field}[${i}].role`, CHAT_ROLES),
      text: requireString(raw.text, `${field}[${i}].text`, LIMITS.chatTextMaxLength, true),
      at: requireString(raw.at, `${field}[${i}].at`, 40),
    }
    const summary = optionalString(raw.summary, `${field}[${i}].summary`, LIMITS.chatTextMaxLength)
    if (summary !== undefined) turn.summary = summary
    return turn
  })
}

const BODY_KEYS = ['kind', 'name', 'notes', 'objects', 'machine', 'chat'] as const

/**
 * Rebuilds the document from scratch, so nothing unvalidated survives into
 * doc_json. The stored JSON deliberately omits `id` and `revision`: the row id
 * is the identity, and revision is client-side history state.
 */
export function validateDesignDocumentInput(body: unknown): DesignDocumentInput {
  const raw = requireObject(body, 'body')
  rejectUnknownKeys(raw, BODY_KEYS, 'body')

  const kind = requireEnum(raw.kind, 'kind', DESIGN_DOCUMENT_KINDS)
  const name = requireString(raw.name, 'name', LIMITS.nameMaxLength)
  const notes = optionalString(raw.notes, 'notes', LIMITS.notesMaxLength)

  if (!Array.isArray(raw.objects)) bad('objects', 'objects must be an array')
  const state: WalkState = { count: 0 }
  const objects = (raw.objects as unknown[])
    .map((o, i) => validateObject(o, `objects[${i}]`, 0, state))

  const doc: Record<string, unknown> = { kind, name, objects }
  if (notes !== undefined) doc.notes = notes
  const machine = validateMachine(raw.machine, 'machine')
  if (machine !== undefined) doc.machine = machine
  const chat = validateChat(raw.chat, 'chat')
  if (chat !== undefined) doc.chat = chat

  const docJson = JSON.stringify(doc)
  // express.json's 2 MB limit admits payloads that are still unreasonable for a
  // single TEXT column, so the serialised size is bounded here too.
  if (Buffer.byteLength(docJson, 'utf8') > LIMITS.maxDocJsonBytes) {
    bad('objects', 'the document is too large to store')
  }

  return {
    kind: kind as DesignDocumentKind,
    name,
    notes: notes ?? null,
    docJson,
    objectCount: objects.length,
  }
}

const CLONE_KEYS = ['name', 'kind'] as const

export interface CloneRequest {
  name?: string
  kind?: DesignDocumentKind
}

export function validateCloneRequest(body: unknown): CloneRequest {
  const raw = requireObject(body ?? {}, 'body')
  rejectUnknownKeys(raw, CLONE_KEYS, 'body')
  const out: CloneRequest = {}
  if (raw.name !== undefined && raw.name !== null) {
    out.name = requireString(raw.name, 'name', LIMITS.nameMaxLength)
  }
  if (raw.kind !== undefined && raw.kind !== null) {
    out.kind = requireEnum(raw.kind, 'kind', DESIGN_DOCUMENT_KINDS)
  }
  return out
}

/** `?kind=` on the list route. Absent means every kind. */
export function validateKindQuery(value: unknown): DesignDocumentKind | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requireEnum(value, 'kind', DESIGN_DOCUMENT_KINDS)
}
