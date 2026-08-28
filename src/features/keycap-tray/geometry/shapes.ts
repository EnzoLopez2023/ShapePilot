// Rounded-rect generation and the pocket sizing formula.
import type { Polygon, Ring, Vec2 } from './vec.ts'
import { translateRing } from './vec.ts'

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

/** CCW ring, corners approximated by `segs` segments each. Origin at (x, y). */
export function roundedRectRing(x: number, y: number, w: number, h: number, r: number, segs: number): Ring {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2))
  if (rad < 1e-9) {
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
  }
  const ring: Ring = []
  // CCW from the bottom-right corner arc.
  const corners: [number, number, number][] = [
    [x + w - rad, y + rad, -Math.PI / 2],
    [x + w - rad, y + h - rad, 0],
    [x + rad, y + h - rad, Math.PI / 2],
    [x + rad, y + rad, Math.PI],
  ]
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= segs; i++) {
      const a = start + (Math.PI / 2) * (i / segs)
      ring.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)] as Vec2)
    }
  }
  // Arc endpoints coincide with the next arc's start; drop exact duplicates.
  return ring.filter((p, i) => {
    if (i === 0) return true
    const prev = ring[i - 1]
    return Math.abs(p[0] - prev[0]) > 1e-12 || Math.abs(p[1] - prev[1]) > 1e-12
  })
}

// A full tray is ~80 pockets across ~15 distinct sizes. Caching at the origin
// makes same-size rings bit-identical, which also helps clipper stability.
const ringCache = new Map<string, Ring>()

export function unitRing(w: number, h: number, r: number, segs: number): Ring {
  const key = `${w}|${h}|${r}|${segs}`
  let ring = ringCache.get(key)
  if (!ring) {
    ring = roundedRectRing(0, 0, w, h, r, segs)
    ringCache.set(key, ring)
  }
  return ring
}

export interface PocketLike {
  units: number
  heightUnits?: number
  x: number
  y: number
  rotationDeg?: 0 | 90
  widthMm?: number
  heightMm?: number
  cornerRadiusMm?: number
  shape?: 'rect' | 'iso-enter'
}

export function pocketRing(p: PocketLike, s: PocketSizing): Polygon {
  if (p.shape === 'iso-enter') return [isoEnterRing(p, s)]
  let w = p.widthMm ?? pocketWidth(p.units, s)
  let h = p.heightMm ?? pocketHeight(p.heightUnits ?? 1, s)
  if (p.rotationDeg === 90) [w, h] = [h, w]
  const r = p.cornerRadiusMm ?? s.cornerRadius
  return [translateRing(unitRing(w, h, r, s.cornerSegments), p.x, p.y)]
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
  const r = Math.max(0, Math.min(p.cornerRadiusMm ?? s.cornerRadius, topW / 2, rowH / 2, notchX))
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
  return dedupeRing(translateRing(ring as Ring, p.x, p.y))
}

export const rectRing = (w: number, h: number, r = 0, segs = 16): Ring =>
  roundedRectRing(0, 0, w, h, r, segs)
