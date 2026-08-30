// Generic 2D ring builders shared by every designer sub-app. Millimetres, y-up,
// counter-clockwise (the outer-ring convention `normalizePolygon` enforces).
import type { Ring, Vec2 } from './vec.ts'

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

/** Axis-aligned rectangle at the origin. `r` rounds the corners. */
export const rectRing = (w: number, h: number, r = 0, segs = 16): Ring =>
  roundedRectRing(0, 0, w, h, r, segs)

/** Square at the origin -- a rectangle whose sides agree. */
export const squareRing = (side: number, r = 0, segs = 16): Ring => rectRing(side, side, r, segs)

/**
 * Ellipse centred on the origin. `segs` is the total segment count, so a circle
 * of radius r has a chord sagitta of r * (1 - cos(pi/segs)) -- at the default 64
 * that is under 1.2 thou at 25 mm radius, well inside QUANTUM at CNC scale.
 */
export function ellipseRing(rx: number, ry: number, segs = 64): Ring {
  const n = Math.max(8, Math.round(segs))
  const ring: Ring = []
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n
    ring.push([rx * Math.cos(a), ry * Math.sin(a)] as Vec2)
  }
  return ring
}

/** Circle centred on the origin. */
export const circleRing = (radius: number, segs = 64): Ring => ellipseRing(radius, radius, segs)

/**
 * Regular n-gon centred on the origin, inscribed in `radius`. `rotationDeg`
 * turns it; the default puts a vertex at the top, which is what people expect
 * of a drawn pentagon or hexagon.
 */
export function regularPolygonRing(sides: number, radius: number, rotationDeg = 90): Ring {
  const n = Math.max(3, Math.round(sides))
  const phase = (rotationDeg * Math.PI) / 180
  const ring: Ring = []
  for (let i = 0; i < n; i++) {
    const a = phase + (2 * Math.PI * i) / n
    ring.push([radius * Math.cos(a), radius * Math.sin(a)] as Vec2)
  }
  return ring
}

/**
 * Isosceles triangle sitting on the x axis, origin at its lower-left corner --
 * the same origin convention as `rectRing`'s bounding box, so a triangle and a
 * rectangle of the same nominal size drop onto the canvas in the same place.
 */
export const triangleRing = (w: number, h: number): Ring =>
  [[0, 0], [w, 0], [w / 2, h]] as Ring
