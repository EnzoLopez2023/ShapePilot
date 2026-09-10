// Turning a traced outline into a pocket the part actually drops into.
//
// An SVG or DXF of a part is the shape of the PART. A pocket cut to it exactly
// is a pocket the part will not go into: the printer has tolerance, and so does
// the part. So the trace is grown by the material's own pocket clearance --
// the same figure `MATERIALS` already carries and the keycap tray already
// applies -- before it becomes a footprint.
//
// Two things stand in the way, and both are handled here rather than left for
// the mesher or the server to hit:
//
//  1. THIS CODEBASE HAS NO POLYGON BUFFER. `offsetRingInward` is inward-only
//     and documents itself as a best-effort visual overlay, and mitering a
//     traced outline OUTWARD would throw spikes off every sharp convex corner.
//     So the growth here is a Minkowski sum with a disc, built from booleans
//     that are already trusted: sweep a capsule along every edge of every ring
//     and union the lot back into the original. Round joins, no spikes, and it
//     shrinks holes by the same amount, which is what a pocket with an island
//     in it wants.
//
//  2. A TRACE HAS FAR TOO MANY POINTS. Server validation caps a ring at 512
//     and a whole tray at 8,000, and the sweep above costs two polygons per
//     point, so an unsimplified 3,000-point curve is both rejected and slow
//     enough to hang the page on the way to being rejected. Every ring is
//     decimated to a tolerance well under the clearance it is about to be
//     grown by, so simplification cannot make the pocket smaller than the part.
import type { MultiPolygon, Polygon, Ring, Vec2 } from '../../../geometry/vec.ts'
import {
  multiBBox, quantizeMulti, ringBBox, signedArea,
} from '../../../geometry/vec.ts'
import { union } from '../../../geometry/boolean.ts'
import { ellipseRing } from '../../../geometry/primitives.ts'
import { applyPocketTransform } from '../../../geometry/pocketTransform.ts'
import { translateRing } from '../../../geometry/vec.ts'
import { rectRing } from '../../../geometry/primitives.ts'

/**
 * Points below this contribute nothing a printer can resolve, so decimating to
 * it is free. Deliberately far finer than any clearance it precedes: the
 * simplified ring must never fall INSIDE the traced one by enough to matter.
 */
export const TRACE_TOLERANCE_MM = 0.05

/** What one ring may carry once simplified. The server's own cap is 512. */
export const MAX_RING_POINTS = 480

/** Segments per disc in the growth sweep. 16 is under 0.02 mm of chord error
 * at a 0.2 mm clearance, and every one of them survives into the result. */
const DISC_SEGMENTS = 16

/** Perpendicular distance from `p` to the segment `a`-`b`. */
function pointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared < 1e-18) return Math.hypot(p[0] - a[0], p[1] - a[1])
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Ramer-Douglas-Peucker on an open run of points. */
function decimate(points: readonly Vec2[], tolerance: number): Vec2[] {
  if (points.length < 3) return [...points]
  let worst = 0
  let index = 0
  const first = points[0]!
  const last = points[points.length - 1]!
  for (let i = 1; i + 1 < points.length; i++) {
    const distance = pointToSegment(points[i]!, first, last)
    if (distance > worst) {
      worst = distance
      index = i
    }
  }
  if (worst <= tolerance) return [first, last]
  const head = decimate(points.slice(0, index + 1), tolerance)
  const tail = decimate(points.slice(index), tolerance)
  return [...head.slice(0, -1), ...tail]
}

/**
 * A closed ring with the points a printer cannot resolve taken out.
 *
 * Split at the extreme point rather than at index 0, so the result does not
 * depend on where the tracer happened to start the ring.
 */
export function simplifyRing(ring: Ring, toleranceMm = TRACE_TOLERANCE_MM): Ring {
  if (ring.length < 4) return [...ring]
  let start = 0
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i]!
    const best = ring[start]!
    if (p[0] < best[0] || (p[0] === best[0] && p[1] < best[1])) start = i
  }
  const rotated = [...ring.slice(start), ...ring.slice(0, start)]
  const closed = [...rotated, rotated[0]!]
  const simplified = decimate(closed, toleranceMm)
  simplified.pop()
  return simplified.length >= 3 ? simplified : [...ring]
}

/** Every ring simplified, at a tolerance raised until the budget is met. */
export function simplifyRegion(
  region: MultiPolygon,
  toleranceMm = TRACE_TOLERANCE_MM,
  maxPoints = MAX_RING_POINTS,
): MultiPolygon {
  let tolerance = toleranceMm
  for (let attempt = 0; attempt < 12; attempt++) {
    const simplified = region.map(poly => poly.map(ring => simplifyRing(ring, tolerance)))
    const worst = Math.max(0, ...simplified.flat().map(ring => ring.length))
    if (worst <= maxPoints) return simplified
    tolerance *= 2
  }
  return region.map(poly => poly.map(ring => simplifyRing(ring, tolerance)))
}

/**
 * Grow a region outward by `mm` on every boundary: the Minkowski sum with a
 * disc of that radius, assembled from a capsule per edge and unioned back into
 * the original.
 *
 * Holes shrink by the same amount, because their boundaries are swept too --
 * which is the right answer for a pocket, where a hole is a post of material
 * the part has to clear.
 */
export function expandRegion(region: MultiPolygon, mm: number): MultiPolygon {
  if (!(mm > 0) || region.length === 0) return region
  const sweep: Polygon[] = []
  for (const poly of region) {
    for (const ring of poly) {
      if (ring.length < 2) continue
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i]!
        const [bx, by] = ring[(i + 1) % ring.length]!
        // A disc at every vertex -- every one, not only the interior ones, or
        // the corner where the ring closes comes out mitred and short.
        sweep.push([translateRing(ellipseRing(mm, mm, DISC_SEGMENTS), ax, ay)])
        const length = Math.hypot(bx - ax, by - ay)
        if (length < 1e-9) continue
        const deg = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI
        const centred = translateRing(rectRing(length, mm * 2), -length / 2, -mm)
        const spun = applyPocketTransform(centred, 0, 0, { rotationDeg: deg })
        sweep.push([translateRing(spun, (ax + bx) / 2, (ay + by) / 2)])
      }
    }
  }
  // Quantised BEFORE the union, not only after. polygon-clipping is exact-
  // arithmetic over its inputs but still fails ("unable to complete output
  // ring") when hundreds of capsules meet at very nearly -- but not exactly --
  // the same point, which is precisely what a sweep along a traced curve
  // produces. Snapping every input to the shared 1e-4 grid first makes those
  // coincidences exact, and QUANTUM is four orders finer than any clearance.
  const parts = [quantizeMulti(region), ...sweep.map(p => quantizeMulti([p]))]

  // Folded in balanced pairs rather than in one variadic call: each union stays
  // small, so a failure is contained and the intermediate rings stay simple.
  let level = parts
  while (level.length > 1) {
    const next: MultiPolygon[] = []
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i]!
      const b = level[i + 1]
      next.push(b ? quantizeMulti(union(a, b)) : a)
    }
    level = next
  }
  return level[0] ?? region
}

/**
 * What an importer hands over: rings that are readonly all the way down, since
 * `Contour` is. Accepted as-is rather than making every caller copy first.
 */
export type TracedRegion = readonly (readonly Vec2[])[]

export interface TracedFootprint {
  /** Rings in the pocket's own frame, lower-left at the origin. */
  rings: MultiPolygon
  widthMm: number
  heightMm: number
}

/**
 * The largest closed region of an import, simplified, grown by `clearanceMm`,
 * and moved so its lower-left corner sits at the pocket's origin.
 *
 * Largest by area rather than all of them: an exported drawing usually carries
 * a border, a title block or stray construction lines, and a pocket is one
 * part. Anything else the tracer found is the caller's to offer separately.
 */
export function traceToFootprint(
  regions: readonly TracedRegion[],
  clearanceMm: number,
): TracedFootprint | null {
  const usable = regions.filter(poly => poly.length > 0 && poly[0]!.length >= 3)
  if (usable.length === 0) return null

  const biggest = usable.reduce((best, poly) =>
    Math.abs(signedArea([...poly[0]!])) > Math.abs(signedArea([...best[0]!])) ? poly : best)

  const mutable: Polygon = biggest.map(ring => [...ring])
  const grown = expandRegion(simplifyRegion([mutable]), clearanceMm)
  const trimmed = simplifyRegion(grown)
  if (trimmed.length === 0) return null

  const box = multiBBox(trimmed)
  const rings = trimmed.map(poly => poly.map(
    ring => ring.map(([x, y]) => [x - box.minX, y - box.minY] as Vec2)))
  return {
    rings,
    widthMm: box.maxX - box.minX,
    heightMm: box.maxY - box.minY,
  }
}

/** Total points, for reporting against the server's own budget. */
export const countPoints = (rings: MultiPolygon): number =>
  rings.flat().reduce((total, ring) => total + ring.length, 0)

export { ringBBox }
