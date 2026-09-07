// Validation for a tray outline, shared by every tray-shaped designer.
//
// Extracted from `keycapTray.ts` unchanged when the switch tray needed the same
// checks. The geometry rules are the interesting part: a ring must enclose real
// area and not self-intersect, a hole must sit strictly inside its outer ring
// and not touch its siblings, and two polygons in one profile must not overlap
// -- all of which the mesher and the clipper assume and neither one checks.
import {
  bad, optionalNumber, optionalString, rejectUnknownKeys, requireEnum,
  requireNumber, requireObject,
} from './primitives.ts'

/**
 * The preset outlines the client ships, from `src/model/trayProfile.ts`. A
 * design may only name one of these; `test/parity/keycapTrayValidation.test.ts`
 * fails if the two drift.
 */
export const KNOWN_PRESET_PROFILE_IDS = [
  'systainer-s76-plain',
  'systainer-s76-notched',
] as const

export const PROFILE_KINDS = ['rect', 'preset', 'custom'] as const

/**
 * Bounds for an outline. Far beyond any real tray -- a Systainer insert is
 * 249 x 165 mm -- and their only job is to keep a hostile or broken payload
 * from reaching storage or the mesher.
 */
export const PROFILE_LIMITS = {
  sourceNameMaxLength: 400,
  /** Any extent in millimetres: tray outline, pocket width/height. */
  maxExtentMm: 5_000,
  /** Any placement coordinate in millimetres. */
  maxCoordinateMm: 100_000,
  maxRadiusMm: 1_000,
  maxPolygons: 64,
  maxRingsPerPolygon: 64,
  maxPointsPerRing: 2_000,
  maxTotalPoints: 4_000,
  minRingArea: 1e-9,
} as const

/** What a validated profile is, once rebuilt. */
export type TrayProfileInput = { kind: typeof PROFILE_KINDS[number] } & Record<string, unknown>

const LIMITS = PROFILE_LIMITS

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

export function validateTrayProfile(value: unknown): TrayProfileInput {
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

  return profile as TrayProfileInput
}
