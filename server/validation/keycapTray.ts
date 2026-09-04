// Complete runtime validation for the keycap tray write routes.
//
// Every design and library body is validated in full — shape, discriminated
// profile, geometry, sizing, dimensions and every pocket field — *before* a
// repository call opens a transaction. A rejected body is a stable typed 400
// carrying the offending field, and it can never reach SQLite.
//
// What is deliberately preserved from the pinned Hearth route:
//
//   * the messages `name is required` and `profile.kind is required`
//   * optional dimensions keep their pinned defaults (2.4 / 10 / 0.4)
//   * `sizing` may be absent, exactly as before, and is stored as `{}`
//   * `shape` is accepted on the wire, validated, and persisted (ShapePilot's
//     ISO Enter editor needs it); `mirrorX`/`flipY` pack into the `mirror_x`
//     column as a 0-3 bitfield. Legacy rows are 0/NULL, so import is unchanged.
//
// What is new is only refusal: NaN, Infinity, numeric strings, unknown keys,
// unknown enum values, unknown preset ids, degenerate or unbounded geometry and
// absurd magnitudes are 400s instead of rows. `rotationDeg` is now any finite
// angle in [0, 360) rather than only 0 or 90.
import { ApiError } from '../errors/ApiError.ts'
import type {
  LibraryPocketInput, PocketInput, TrayDesignInput,
} from '../../lib/db/repositories/contracts.ts'

interface PocketSizing {
  pitch: number
  widthOffset: number
  height: number
  cornerRadius: number
  cornerSegments: number
}

const DEFAULT_SIZING: PocketSizing = {
  pitch: 19.05,
  widthOffset: -0.25,
  height: 18.8,
  cornerRadius: 1,
  cornerSegments: 16,
}

/**
 * The preset outlines the client ships, from
 * `src/features/keycap-tray/model/types.ts`. A design may only name one of
 * these; `test/parity/keycapTrayValidation.test.ts` fails if the two drift.
 */
export const KNOWN_PRESET_PROFILE_IDS = [
  'systainer-s76-plain',
  'systainer-s76-notched',
] as const

export const LABEL_MODES = ['guide', 'engrave', 'none'] as const
export const POCKET_SHAPES = ['rect', 'iso-enter'] as const
export const PROFILE_KINDS = ['rect', 'preset', 'custom'] as const

/**
 * Bounds. Every one of these is far beyond any real tray — a Systainer insert
 * is 249 x 165 mm with about eighty 1u pockets — and their only job is to keep
 * a hostile or broken payload from reaching storage or the mesher.
 */
export const LIMITS = {
  nameMaxLength: 200,
  notesMaxLength: 4_000,
  labelMaxLength: 200,
  sourceNameMaxLength: 400,
  clientIdMaxLength: 128,
  maxPockets: 512,
  /** Any extent in millimetres: tray outline, pocket width/height. */
  maxExtentMm: 5_000,
  /** Any placement coordinate in millimetres. */
  maxCoordinateMm: 100_000,
  maxRadiusMm: 1_000,
  maxDepthMm: 1_000,
  maxUnits: 100,
  maxPitchMm: 1_000,
  maxWidthOffsetMm: 1_000,
  maxCornerSegments: 256,
  maxPolygons: 64,
  maxRingsPerPolygon: 64,
  maxPointsPerRing: 2_000,
  maxTotalPoints: 4_000,
  minRingArea: 1e-9,
} as const

const bad = (field: string, message: string): never => {
  throw new ApiError(400, 'bad_request', message, { field })
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(value)) bad(field, `${field} must be a JSON object`)
  return value as Record<string, unknown>
}

function rejectUnknownKeys(
  value: Record<string, unknown>, allowed: readonly string[], field: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      bad(`${field}.${key}`, `${field} does not accept the field "${key}"`)
    }
  }
}

const absent = (value: unknown): boolean => value === undefined || value === null

interface NumberBounds {
  /** Reject values at or below this bound. */
  exclusiveMin?: number
  min?: number
  max: number
  integer?: boolean
}

/**
 * A number and nothing else. `"1"`, `true`, `NaN`, `Infinity` and `1e400` are
 * all refused rather than coerced — SQLite would happily store the string.
 */
function requireNumber(value: unknown, field: string, bounds: NumberBounds): number {
  if (typeof value !== 'number') {
    bad(field, `${field} must be a number`)
  }
  const numeric = value as number
  if (!Number.isFinite(numeric)) {
    bad(field, `${field} must be a finite number`)
  }
  if (bounds.integer && !Number.isInteger(numeric)) {
    bad(field, `${field} must be an integer`)
  }
  if (bounds.exclusiveMin !== undefined && numeric <= bounds.exclusiveMin) {
    bad(field, `${field} must be greater than ${bounds.exclusiveMin}`)
  }
  if (bounds.min !== undefined && numeric < bounds.min) {
    bad(field, `${field} must be at least ${bounds.min}`)
  }
  if (Math.abs(numeric) > bounds.max) {
    bad(field, `${field} must be within ±${bounds.max}`)
  }
  return numeric
}

const optionalNumber = (
  value: unknown, field: string, bounds: NumberBounds,
): number | undefined => (absent(value) ? undefined : requireNumber(value, field, bounds))

function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') bad(field, `${field} must be text`)
  const text = value as string
  if (text.length > maxLength) {
    bad(field, `${field} must be at most ${maxLength} characters`)
  }
  return text
}

const optionalString = (
  value: unknown, field: string, maxLength: number,
): string | undefined => (absent(value) ? undefined : requireString(value, field, maxLength))

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') bad(field, `${field} must be true or false`)
  return value as boolean
}

function requireEnum<T extends string>(
  value: unknown, field: string, allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    bad(field, `${field} must be one of ${allowed.join(', ')}`)
  }
  return value as T
}

// -- profile ------------------------------------------------------------------

const RING_FIELD = 'profile.rings'

/** One `[x, y]` pair, finite and bounded. */
function validatePoint(value: unknown, field: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    bad(field, `${field} must be a two-number coordinate pair`)
  }
  const point = value as unknown[]
  return [
    requireNumber(point[0], `${field}[0]`, { max: LIMITS.maxCoordinateMm }),
    requireNumber(point[1], `${field}[1]`, { max: LIMITS.maxCoordinateMm }),
  ]
}

/**
 * A ring must be a real closed outline: at least three points, at least three
 * distinct points, and a non-zero area. A collapsed ring produces degenerate
 * triangles and NaN normals downstream, so it is refused here.
 */
type Point = [number, number]

const samePoint = (a: Point, b: Point): boolean => a[0] === b[0] && a[1] === b[1]

const orientation = (a: Point, b: Point, c: Point): number =>
  ((b[0] - a[0]) * (c[1] - a[1])) - ((b[1] - a[1]) * (c[0] - a[0]))

function pointOnSegment(point: Point, a: Point, b: Point): boolean {
  if (Math.abs(orientation(a, b, point)) > 1e-9) return false
  return point[0] >= Math.min(a[0], b[0]) - 1e-9
    && point[0] <= Math.max(a[0], b[0]) + 1e-9
    && point[1] >= Math.min(a[1], b[1]) - 1e-9
    && point[1] <= Math.max(a[1], b[1]) + 1e-9
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = orientation(a, b, c)
  const abD = orientation(a, b, d)
  const cdA = orientation(c, d, a)
  const cdB = orientation(c, d, b)
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true
  return (Math.abs(abC) <= 1e-9 && pointOnSegment(c, a, b))
    || (Math.abs(abD) <= 1e-9 && pointOnSegment(d, a, b))
    || (Math.abs(cdA) <= 1e-9 && pointOnSegment(a, c, d))
    || (Math.abs(cdB) <= 1e-9 && pointOnSegment(b, c, d))
}

function ringIntersectsRing(a: Point[], b: Point[]): boolean {
  for (let ai = 0; ai < a.length; ai += 1) {
    for (let bi = 0; bi < b.length; bi += 1) {
      if (segmentsIntersect(
        a[ai], a[(ai + 1) % a.length], b[bi], b[(bi + 1) % b.length],
      )) return true
    }
  }
  return false
}

function pointInsideRing(point: Point, ring: Point[]): boolean {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index]
    const b = ring[previous]
    if (pointOnSegment(point, a, b)) return false
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside
    }
  }
  return inside
}

const pointInsidePolygon = (point: Point, rings: Point[][]): boolean =>
  pointInsideRing(point, rings[0])
  && !rings.slice(1).some((hole) => pointInsideRing(point, hole))

function polygonsIntersect(a: Point[][], b: Point[][]): boolean {
  return a.some((aRing) => b.some((bRing) => ringIntersectsRing(aRing, bRing)))
}

function validateRing(value: unknown, field: string): Point[] {
  if (!Array.isArray(value)) bad(field, `${field} must be an array of coordinate pairs`)
  const ring = value as unknown[]
  if (ring.length < 3) bad(field, `${field} must have at least three points`)
  if (ring.length > LIMITS.maxPointsPerRing) {
    bad(field, `${field} must have at most ${LIMITS.maxPointsPerRing} points`)
  }

  const points = ring.map((point, index) => validatePoint(point, `${field}[${index}]`))
  const distinct = new Set(points.map(([x, y]) => `${x},${y}`))
  if (distinct.size < 3) bad(field, `${field} must have at least three distinct points`)
  for (let index = 0; index < points.length; index += 1) {
    if (samePoint(points[index], points[(index + 1) % points.length])) {
      bad(field, `${field} must not contain a zero-length edge`)
    }
  }

  let twiceArea = 0
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index]
    const [x2, y2] = points[(index + 1) % points.length]
    twiceArea += (x1 * y2) - (x2 * y1)
  }
  if (!Number.isFinite(twiceArea) || Math.abs(twiceArea / 2) < LIMITS.minRingArea) {
    bad(field, `${field} encloses no area`)
  }
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      const adjacent = second === first + 1 || (first === 0 && second === points.length - 1)
      if (!adjacent && segmentsIntersect(
        points[first], points[(first + 1) % points.length],
        points[second], points[(second + 1) % points.length],
      )) {
        bad(field, `${field} must not self-intersect`)
      }
    }
  }
  return points
}

function validateMultiPolygon(value: unknown): void {
  if (!Array.isArray(value)) bad(RING_FIELD, `${RING_FIELD} must be an array of polygons`)
  const polygons = value as unknown[]
  if (polygons.length === 0) bad(RING_FIELD, `${RING_FIELD} must contain at least one polygon`)
  if (polygons.length > LIMITS.maxPolygons) {
    bad(RING_FIELD, `${RING_FIELD} must contain at most ${LIMITS.maxPolygons} polygons`)
  }

  let pointBudget = 0
  for (const polygon of polygons) {
    if (!Array.isArray(polygon)) continue
    for (const ring of polygon) {
      if (!Array.isArray(ring)) continue
      pointBudget += ring.length
      if (pointBudget > LIMITS.maxTotalPoints) {
        bad(RING_FIELD, `${RING_FIELD} must contain at most ${LIMITS.maxTotalPoints} points in total`)
      }
    }
  }

  let totalPoints = 0
  const validatedPolygons = polygons.map((polygon, polygonIndex) => {
    const field = `${RING_FIELD}[${polygonIndex}]`
    if (!Array.isArray(polygon)) bad(field, `${field} must be an array of rings`)
    const rings = polygon as unknown[]
    if (rings.length === 0) bad(field, `${field} must contain at least one ring`)
    if (rings.length > LIMITS.maxRingsPerPolygon) {
      bad(field, `${field} must contain at most ${LIMITS.maxRingsPerPolygon} rings`)
    }
    const validatedRings = rings.map((ring, ringIndex) => {
      const points = validateRing(ring, `${field}[${ringIndex}]`)
      totalPoints += points.length
      return points
    })
    const outer = validatedRings[0]
    for (let holeIndex = 1; holeIndex < validatedRings.length; holeIndex += 1) {
      const hole = validatedRings[holeIndex]
      if (ringIntersectsRing(outer, hole) || !pointInsideRing(hole[0], outer)) {
        bad(`${field}[${holeIndex}]`, `${field}[${holeIndex}] must be strictly inside its outer ring`)
      }
      for (let sibling = 1; sibling < holeIndex; sibling += 1) {
        const other = validatedRings[sibling]
        if (ringIntersectsRing(other, hole)
          || pointInsideRing(hole[0], other)
          || pointInsideRing(other[0], hole)) {
          bad(`${field}[${holeIndex}]`, `${field} holes must not intersect or contain each other`)
        }
      }
    }
    return validatedRings
  })

  if (totalPoints > LIMITS.maxTotalPoints) {
    bad(RING_FIELD, `${RING_FIELD} must contain at most ${LIMITS.maxTotalPoints} points in total`)
  }
  for (let first = 0; first < validatedPolygons.length; first += 1) {
    for (let second = first + 1; second < validatedPolygons.length; second += 1) {
      const a = validatedPolygons[first][0]
      const b = validatedPolygons[second][0]
      if (polygonsIntersect(validatedPolygons[first], validatedPolygons[second])
        || pointInsidePolygon(a[0], validatedPolygons[second])
        || pointInsidePolygon(b[0], validatedPolygons[first])) {
        bad(RING_FIELD, `${RING_FIELD} polygons must not overlap`)
      }
    }
  }
}

function validateProfile(value: unknown): TrayDesignInput['profile'] {
  const profile = requireObject(value, 'profile')
  if (typeof profile.kind !== 'string' || profile.kind === '') {
    bad('profile.kind', 'profile.kind is required')
  }
  const kind = requireEnum(profile.kind, 'profile.kind', PROFILE_KINDS)

  switch (kind) {
    case 'rect':
      rejectUnknownKeys(profile, ['kind', 'widthMm', 'heightMm', 'cornerRadiusMm'], 'profile')
      requireNumber(profile.widthMm, 'profile.widthMm', {
        exclusiveMin: 0, max: LIMITS.maxExtentMm,
      })
      requireNumber(profile.heightMm, 'profile.heightMm', {
        exclusiveMin: 0, max: LIMITS.maxExtentMm,
      })
      optionalNumber(profile.cornerRadiusMm, 'profile.cornerRadiusMm', {
        min: 0, max: LIMITS.maxRadiusMm,
      })
      break

    case 'preset':
      rejectUnknownKeys(profile, ['kind', 'id'], 'profile')
      requireEnum(profile.id, 'profile.id', KNOWN_PRESET_PROFILE_IDS)
      break

    case 'custom':
      rejectUnknownKeys(profile, ['kind', 'rings', 'sourceName'], 'profile')
      validateMultiPolygon(profile.rings)
      optionalString(profile.sourceName, 'profile.sourceName', LIMITS.sourceNameMaxLength)
      break
  }

  return profile as TrayDesignInput['profile']
}

// -- sizing -------------------------------------------------------------------

function validateSizing(value: unknown): { stored: unknown; effective: PocketSizing } {
  if (absent(value)) return { stored: undefined, effective: DEFAULT_SIZING }
  const sizing = requireObject(value, 'sizing')
  if (Object.keys(sizing).length === 0) {
    return { stored: sizing, effective: DEFAULT_SIZING }
  }
  rejectUnknownKeys(
    sizing, ['pitch', 'widthOffset', 'height', 'cornerRadius', 'cornerSegments'], 'sizing')

  const effective = {
    pitch: requireNumber(
      sizing.pitch, 'sizing.pitch', { exclusiveMin: 0, max: LIMITS.maxPitchMm }),
    widthOffset: requireNumber(
      sizing.widthOffset, 'sizing.widthOffset', { max: LIMITS.maxWidthOffsetMm }),
    height: requireNumber(
      sizing.height, 'sizing.height', { exclusiveMin: 0, max: LIMITS.maxPitchMm }),
    cornerRadius: requireNumber(
      sizing.cornerRadius, 'sizing.cornerRadius', { min: 0, max: LIMITS.maxRadiusMm }),
    cornerSegments: requireNumber(sizing.cornerSegments, 'sizing.cornerSegments', {
    exclusiveMin: 0, max: LIMITS.maxCornerSegments, integer: true,
    }),
  }
  return { stored: sizing, effective }
}

// -- pockets ------------------------------------------------------------------

const POCKET_KEYS = [
  'id', 'units', 'heightUnits', 'x', 'y', 'rotationDeg', 'mirrorX', 'flipY',
  'isThrough', 'shape', 'depthMm', 'label', 'labelMode',
  'widthMm', 'heightMm', 'cornerRadiusMm',
] as const

function validatePocket(value: unknown, index: number, sizing: PocketSizing): PocketInput {
  const field = `pockets[${index}]`
  const pocket = requireObject(value, field)
  rejectUnknownKeys(pocket, POCKET_KEYS, field)

  optionalString(pocket.id, `${field}.id`, LIMITS.clientIdMaxLength)
  requireNumber(pocket.units, `${field}.units`, { exclusiveMin: 0, max: LIMITS.maxUnits })
  optionalNumber(pocket.heightUnits, `${field}.heightUnits`, {
    exclusiveMin: 0, max: LIMITS.maxUnits,
  })
  requireNumber(pocket.x, `${field}.x`, { max: LIMITS.maxCoordinateMm })
  requireNumber(pocket.y, `${field}.y`, { max: LIMITS.maxCoordinateMm })

  if (!absent(pocket.rotationDeg)) {
    const rotation = requireNumber(pocket.rotationDeg, `${field}.rotationDeg`, { min: 0, max: 360 })
    if (rotation >= 360) {
      bad(`${field}.rotationDeg`, `${field}.rotationDeg must be in [0, 360)`)
    }
  }

  optionalBoolean(pocket.isThrough, `${field}.isThrough`)
  optionalBoolean(pocket.mirrorX, `${field}.mirrorX`)
  optionalBoolean(pocket.flipY, `${field}.flipY`)

  // `shape`, `mirrorX` and `flipY` are all persisted -- `shape` in its own
  // column, the two flags packed into `mirror_x` as a 0-3 bitfield by the repo.
  if (!absent(pocket.shape)) requireEnum(pocket.shape, `${field}.shape`, POCKET_SHAPES)

  if (!absent(pocket.label)) requireString(pocket.label, `${field}.label`, LIMITS.labelMaxLength)
  if (!absent(pocket.labelMode)) requireEnum(pocket.labelMode, `${field}.labelMode`, LABEL_MODES)

  optionalNumber(pocket.depthMm, `${field}.depthMm`, { exclusiveMin: 0, max: LIMITS.maxDepthMm })
  optionalNumber(pocket.widthMm, `${field}.widthMm`, { exclusiveMin: 0, max: LIMITS.maxExtentMm })
  optionalNumber(pocket.heightMm, `${field}.heightMm`, { exclusiveMin: 0, max: LIMITS.maxExtentMm })
  optionalNumber(pocket.cornerRadiusMm, `${field}.cornerRadiusMm`, {
    min: 0, max: LIMITS.maxRadiusMm,
  })

  const shape = (pocket.shape ?? 'rect') as (typeof POCKET_SHAPES)[number]
  const explicitWidth = pocket.widthMm as number | undefined
  const width = shape === 'iso-enter'
    ? explicitWidth ?? sizing.pitch * 1.5 + sizing.widthOffset
    : explicitWidth ?? sizing.pitch * (pocket.units as number) + sizing.widthOffset
  const heightUnits = (pocket.heightUnits as number | undefined) ?? 1
  const height = (pocket.heightMm as number | undefined)
    ?? (heightUnits <= 1 ? sizing.height : sizing.pitch * heightUnits + sizing.widthOffset)
  if (!(width > 0)) bad(`${field}.widthMm`, `${field} resolves to a non-positive width`)
  if (!(height > 0)) bad(`${field}.heightMm`, `${field} resolves to a non-positive height`)

  return pocket as unknown as PocketInput
}

function validatePockets(value: unknown, sizing: PocketSizing): PocketInput[] | undefined {
  if (absent(value)) return undefined
  if (!Array.isArray(value)) bad('pockets', 'pockets must be an array')
  const pockets = value as unknown[]
  if (pockets.length > LIMITS.maxPockets) {
    bad('pockets', `a design may have at most ${LIMITS.maxPockets} pockets`)
  }
  return pockets.map((pocket, index) => validatePocket(pocket, index, sizing))
}

// -- entry points -------------------------------------------------------------

const DESIGN_KEYS = [
  'name', 'projectId', 'notes', 'profile', 'sizing', 'floorThicknessMm', 'pocketDepthMm',
  'engraveDepthMm', 'cornerSpacers', 'pockets',
] as const

/**
 * Corner-spacer posts: absent or null means none, an object sets both
 * dimensions. Bounded like every other extent so a broken payload cannot reach
 * the mesher.
 */
function validateCornerSpacers(value: unknown): { heightMm: number; sizeMm: number } | undefined {
  if (absent(value)) return undefined
  const spacers = requireObject(value, 'cornerSpacers')
  rejectUnknownKeys(spacers, ['heightMm', 'sizeMm'], 'cornerSpacers')
  return {
    heightMm: requireNumber(spacers.heightMm, 'cornerSpacers.heightMm', {
      exclusiveMin: 0, max: LIMITS.maxDepthMm,
    }),
    sizeMm: requireNumber(spacers.sizeMm, 'cornerSpacers.sizeMm', {
      exclusiveMin: 0, max: LIMITS.maxExtentMm,
    }),
  }
}

/** Row ids are integers in SQLite and strings on the wire. */
const ROW_ID = /^[0-9]{1,19}$/

/**
 * Three distinct meanings, all of them wanted:
 *   * absent   -- leave the tray's project link exactly as it is
 *   * `null`   -- unassign it
 *   * an id    -- link it, once the route has proved the caller owns that project
 */
function validateProjectId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const id = requireString(value, 'projectId', 19)
  if (!ROW_ID.test(id)) bad('projectId', 'projectId must be a project id')
  return id
}

/**
 * Validate a create or update body completely. Field order matters: `name` and
 * then `profile.kind` are checked first so the pinned 400s are unchanged.
 */
export function validateTrayDesignInput(value: unknown): TrayDesignInput {
  const body = requireObject(value, 'body')
  rejectUnknownKeys(body, DESIGN_KEYS, 'body')

  if (typeof body.name !== 'string' || body.name.trim() === '') {
    bad('name', 'name is required')
  }
  const name = requireString(body.name, 'name', LIMITS.nameMaxLength)
  const profile = validateProfile(body.profile)

  const notes = absent(body.notes)
    ? undefined
    : requireString(body.notes, 'notes', LIMITS.notesMaxLength)

  const sizing = validateSizing(body.sizing)

  const floorThicknessMm = optionalNumber(body.floorThicknessMm, 'floorThicknessMm', {
    exclusiveMin: 0, max: LIMITS.maxDepthMm,
  })
  const pocketDepthMm = optionalNumber(body.pocketDepthMm, 'pocketDepthMm', {
    exclusiveMin: 0, max: LIMITS.maxDepthMm,
  })
  const engraveDepthMm = optionalNumber(body.engraveDepthMm, 'engraveDepthMm', {
    min: 0, max: LIMITS.maxDepthMm,
  })
  const cornerSpacers = validateCornerSpacers(body.cornerSpacers)

  const pockets = validatePockets(body.pockets, sizing.effective)

  const projectId = validateProjectId(body.projectId)

  // Rebuilt rather than passed through, so nothing unvalidated survives.
  const input: TrayDesignInput = { name, profile }
  if (projectId !== undefined) input.projectId = projectId
  if (notes !== undefined) input.notes = notes
  if (sizing.stored !== undefined) input.sizing = sizing.stored
  if (floorThicknessMm !== undefined) input.floorThicknessMm = floorThicknessMm
  if (pocketDepthMm !== undefined) input.pocketDepthMm = pocketDepthMm
  if (engraveDepthMm !== undefined) input.engraveDepthMm = engraveDepthMm
  if (cornerSpacers !== undefined) input.cornerSpacers = cornerSpacers
  if (pockets !== undefined) input.pockets = pockets
  return input
}

const LIBRARY_KEYS = [
  'name', 'units', 'widthMm', 'heightMm', 'cornerRadiusMm', 'notes',
] as const

export function validateLibraryPocketInput(value: unknown): LibraryPocketInput {
  const body = requireObject(value, 'body')
  rejectUnknownKeys(body, LIBRARY_KEYS, 'body')

  if (typeof body.name !== 'string' || body.name.trim() === '') {
    bad('name', 'name is required')
  }
  const name = requireString(body.name, 'name', LIMITS.nameMaxLength)

  const units = optionalNumber(body.units, 'units', { exclusiveMin: 0, max: LIMITS.maxUnits })
  const widthMm = optionalNumber(body.widthMm, 'widthMm', {
    exclusiveMin: 0, max: LIMITS.maxExtentMm,
  })
  const heightMm = optionalNumber(body.heightMm, 'heightMm', {
    exclusiveMin: 0, max: LIMITS.maxExtentMm,
  })
  const cornerRadiusMm = optionalNumber(body.cornerRadiusMm, 'cornerRadiusMm', {
    min: 0, max: LIMITS.maxRadiusMm,
  })
  const notes = absent(body.notes)
    ? undefined
    : requireString(body.notes, 'notes', LIMITS.notesMaxLength)

  return {
    name,
    units: units ?? 1,
    widthMm: widthMm ?? null,
    heightMm: heightMm ?? null,
    cornerRadiusMm: cornerRadiusMm ?? null,
    notes: notes ?? null,
  }
}

/**
 * The clone body carries an optional replacement name and an optional target
 * project. `projectId` has the same three meanings as on a design write: absent
 * keeps the source's project, `null` unassigns the copy, an id moves it (the
 * route then proves the caller owns that project).
 */
export function validateCloneRequest(value: unknown): { name?: string; projectId?: string | null } {
  const body = requireObject(value ?? {}, 'body')
  rejectUnknownKeys(body, ['name', 'projectId'], 'body')
  const result: { name?: string; projectId?: string | null } = {}
  if (!absent(body.name)) {
    const name = requireString(body.name, 'name', LIMITS.nameMaxLength)
    if (name.trim() !== '') result.name = name
  }
  if ('projectId' in body) {
    const projectId = validateProjectId(body.projectId)
    if (projectId !== undefined) result.projectId = projectId
  }
  return result
}
