// 2D primitives shared by the whole tray pipeline. Everything is millimetres,
// y-up (CAD convention). The SVG layer is the only place y-down exists.

export type Vec2 = readonly [number, number]

/** Unclosed: ring[0] !== ring[n-1]. earcut emits slivers on repeated points. */
export type Ring = Vec2[]

/** [outer(CCW), ...holes(CW)] */
export type Polygon = Ring[]
export type MultiPolygon = Polygon[]

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }

// Coarser than float32 epsilon at tray scale (2^-23 * 256 ~= 3.05e-5 mm), so
// quantized vertices survive the STL write as distinct values. Doubles as the
// boolean-clipper input tolerance and the mesh weld key.
export const QUANTUM = 1e-4

export const q = (v: number): number => Math.round(v / QUANTUM) * QUANTUM

export const quantizeRing = (r: Ring): Ring => r.map(([x, y]) => [q(x), q(y)] as Vec2)
export const quantizePolygon = (p: Polygon): Polygon => p.map(quantizeRing)
export const quantizeMulti = (m: MultiPolygon): MultiPolygon => m.map(quantizePolygon)

/** Shoelace. Positive = counter-clockwise. */
export function signedArea(ring: Ring): number {
  let a = 0
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[(i + 1) % n]
    a += x0 * y1 - x1 * y0
  }
  return a / 2
}

export function ringBBox(ring: Ring): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of ring) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

export function multiBBox(mp: MultiPolygon): BBox {
  let b: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const poly of mp) {
    if (!poly.length) continue
    const r = ringBBox(poly[0])
    b = {
      minX: Math.min(b.minX, r.minX), minY: Math.min(b.minY, r.minY),
      maxX: Math.max(b.maxX, r.maxX), maxY: Math.max(b.maxY, r.maxY),
    }
  }
  return b
}

export const bboxOverlaps = (a: BBox, b: BBox, gap = 0): boolean =>
  a.minX - gap < b.maxX && b.minX - gap < a.maxX &&
  a.minY - gap < b.maxY && b.minY - gap < a.maxY

export const bboxContains = (outer: BBox, inner: BBox): boolean =>
  inner.minX >= outer.minX && inner.maxX <= outer.maxX &&
  inner.minY >= outer.minY && inner.maxY <= outer.maxY

/** Ray casting. Points exactly on the edge are not guaranteed either way. */
export function pointInRing(p: Vec2, ring: Ring): boolean {
  const [px, py] = p
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * Outer rings CCW, holes CW. With this invariant, walking any ring in index
 * order keeps material on the left, so wall extrusion needs no outer/hole branch.
 */
export function normalizePolygon(poly: Polygon): Polygon {
  return poly.map((ring, i) => {
    const wantCCW = i === 0
    const isCCW = signedArea(ring) > 0
    return isCCW === wantCCW ? ring : [...ring].reverse()
  })
}

export const normalizeMulti = (mp: MultiPolygon): MultiPolygon => mp.map(normalizePolygon)

/** Strip a GeoJSON-style repeated closing point. */
export function openRing(ring: Ring): Ring {
  if (ring.length < 2) return ring
  const [fx, fy] = ring[0]
  const [lx, ly] = ring[ring.length - 1]
  return fx === lx && fy === ly ? ring.slice(0, -1) : ring
}

export const area = (poly: Polygon): number =>
  poly.reduce((sum, r, i) => sum + (i === 0 ? Math.abs(signedArea(r)) : -Math.abs(signedArea(r))), 0)

export const multiArea = (mp: MultiPolygon): number => mp.reduce((s, p) => s + area(p), 0)

export const translateRing = (r: Ring, dx: number, dy: number): Ring =>
  r.map(([x, y]) => [x + dx, y + dy] as Vec2)

/** Fold any angle into the canonical [0, 360) range. */
export const normalizeAngleDeg = (deg: number): number => ((deg % 360) + 360) % 360

/**
 * Proper rotation (determinant +1) about (cx, cy), degrees CCW. Winding is
 * preserved, so a CCW ring stays CCW -- no reverse needed.
 */
export function rotateRing(r: Ring, deg: number, cx: number, cy: number): Ring {
  if (!deg) return r
  const a = (deg * Math.PI) / 180
  const cos = Math.cos(a), sin = Math.sin(a)
  return r.map(([x, y]) => {
    const dx = x - cx, dy = y - cy
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos] as Vec2
  })
}

/**
 * Reflect a ring inside its own w x h footprint box: `mx` mirrors left-to-right
 * (x -> w - x), `fy` flips front-to-back (y -> h - y). A single reflection
 * reverses winding, so the ring is reversed again iff exactly one axis flips,
 * restoring the CCW invariant. Operates on a fresh array, never a shared cache.
 */
export function reflectRingInBox(r: Ring, w: number, h: number, mx: boolean, fy: boolean): Ring {
  const mapped = r.map(([x, y]) => [mx ? w - x : x, fy ? h - y : y] as Vec2)
  return mx !== fy ? mapped.reverse() : mapped
}
