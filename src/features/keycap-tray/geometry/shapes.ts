// Rounded-rect generation and the pocket sizing formula.
import type { Polygon, Ring, Vec2 } from '../../../geometry/vec.ts'
import { normalizeAngleDeg, quantizeRing, reflectRingInBox, rotateRing, translateRing } from '../../../geometry/vec.ts'
import { rectRing, roundedRectRing, unitRing } from '../../../geometry/primitives.ts'

export { rectRing, roundedRectRing, unitRing }

export interface PocketSizing {
  /** Key pitch. 19.05 mm is the ANSI standard and should not change. */
  pitch: number
  /** width = pitch * u + widthOffset. Library -0.45, Python -0.25. */
  widthOffset: number
  /** 1u pocket height. Library 18.60, Python 18.80. */
  height: number
  cornerRadius: number
  /** Segments per 90-degree corner. 16 gives 0.0024 mm chord error at r=2. */
  cornerSegments: number
}

export const LIBRARY_SIZING: PocketSizing = {
  pitch: 19.05, widthOffset: -0.45, height: 18.6, cornerRadius: 2.0, cornerSegments: 16,
}

// Matches the Systainer trays already cut. The 1.00 mm radius is NOT machinable
// with a 1/8" bit -- validate.ts flags it for the Origin.
export const PYTHON_SIZING: PocketSizing = {
  pitch: 19.05, widthOffset: -0.25, height: 18.8, cornerRadius: 1.0, cornerSegments: 16,
}

export const pocketWidth = (units: number, s: PocketSizing): number => s.pitch * units + s.widthOffset

export const pocketHeight = (heightUnits: number, s: PocketSizing): number =>
  heightUnits <= 1 ? s.height : s.pitch * heightUnits + s.widthOffset

export interface PocketLike {
  units: number
  heightUnits?: number
  x: number
  y: number
  /** Real rotation about the un-rotated footprint centre, degrees, [0, 360). */
  rotationDeg?: number
  /** Reflect the geometry across its own vertical centreline, in place. */
  mirrorX?: boolean
  /** Reflect the geometry across its own horizontal centreline, in place. */
  flipY?: boolean
  widthMm?: number
  heightMm?: number
  cornerRadiusMm?: number
  shape?: 'rect' | 'iso-enter'
}

/**
 * The per-pocket transform, applied to a base ring built at the origin with an
 * un-rotated footprint of `w0 x h0`: reflect inside that box, then rotate about
 * its centre. Order matters -- reflecting first keeps mirror/flip meaningful in
 * the pocket's own frame regardless of angle. Callers still translate by (x, y).
 */
function applyPocketTransform(local: Ring, w0: number, h0: number, p: PocketLike): Ring {
  const deg = normalizeAngleDeg(p.rotationDeg ?? 0)
  if (!p.mirrorX && !p.flipY && !deg) return local
  let ring = local
  if (p.mirrorX || p.flipY) ring = reflectRingInBox(ring, w0, h0, !!p.mirrorX, !!p.flipY)
  if (deg) ring = rotateRing(ring, deg, w0 / 2, h0 / 2)
  // Snap transcendental rotation coordinates onto the QUANTUM grid the boolean
  // and T-junction passes assume; the plain (un-transformed) path is untouched.
  return quantizeRing(ring)
}

export function effectivePocketCornerRadius(p: PocketLike, s: PocketSizing): number {
  const requested = p.cornerRadiusMm ?? s.cornerRadius
  if (p.shape === 'iso-enter') {
    const bottomW = p.widthMm ?? pocketWidth(1.5, s)
    const topW = pocketWidth(1.25, s)
    const rowH = p.heightMm ?? pocketHeight(1, s)
    return Math.max(0, Math.min(requested, topW / 2, rowH / 2, bottomW - topW))
  }
  const width = p.widthMm ?? pocketWidth(p.units, s)
  const height = p.heightMm ?? pocketHeight(p.heightUnits ?? 1, s)
  return Math.max(0, Math.min(requested, width / 2, height / 2))
}

export function pocketRing(p: PocketLike, s: PocketSizing): Polygon {
  if (p.shape === 'iso-enter') return [isoEnterRing(p, s)]
  // Un-rotated footprint; the cache stays keyed on this, rotation is applied after.
  const w0 = p.widthMm ?? pocketWidth(p.units, s)
  const h0 = p.heightMm ?? pocketHeight(p.heightUnits ?? 1, s)
  const r = effectivePocketCornerRadius(p, s)
  const ring = applyPocketTransform(unitRing(w0, h0, r, s.cornerSegments), w0, h0, p)
  return [translateRing(ring, p.x, p.y)]
}

const dedupeRing = (ring: Ring): Ring => ring.filter((pt, i) => {
  if (i === 0) return true
  const prev = ring[i - 1]
  return Math.abs(pt[0] - prev[0]) > 1e-12 || Math.abs(pt[1] - prev[1]) > 1e-12
})

/**
 * ISO Enter ("big-ass Enter"): a 2-row-tall backwards L. The bottom row is
 * 1.5u wide; the top row is 1.25u wide and right-aligned above it, so the
 * step-in sits at the top-left -- where the ISO # key lives above it on a
 * real board. Origin (p.x, p.y) is still the lower-left of the full 1.5u-wide
 * bounding box, matching every other pocket.
 *
 * Five of the six corners are convex and round like any other pocket; the
 * sixth, where the step turns inward, is reflex and stays sharp -- a router
 * bit or an earcut fan can't put a bulge into a concave corner anyway.
 */
export function isoEnterRing(p: PocketLike, s: PocketSizing): Ring {
  const bottomW = p.widthMm ?? pocketWidth(1.5, s)
  const topW = pocketWidth(1.25, s)
  const rowH = p.heightMm ?? pocketHeight(1, s)
  const notchX = bottomW - topW
  const r = effectivePocketCornerRadius(p, s)
  const segs = s.cornerSegments

  const arc = (cx: number, cy: number, start: number): Vec2[] => {
    if (r < 1e-9) return [[cx, cy]]
    const pts: Vec2[] = []
    for (let i = 0; i <= segs; i++) {
      const a = start + (Math.PI / 2) * (i / segs)
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)] as Vec2)
    }
    return pts
  }

  const ring: Vec2[] = [
    ...arc(bottomW - r, r, -Math.PI / 2),          // bottom-right
    ...arc(bottomW - r, 2 * rowH - r, 0),           // top-right
    ...arc(notchX + r, 2 * rowH - r, Math.PI / 2),  // top of the step
    [notchX, rowH] as Vec2,                         // reflex notch -- sharp
    ...arc(r, rowH - r, Math.PI / 2),               // foot of the step
    ...arc(r, r, Math.PI),                          // bottom-left
  ]
  const transformed = applyPocketTransform(ring as Ring, bottomW, 2 * rowH, p)
  return dedupeRing(translateRing(transformed, p.x, p.y))
}

