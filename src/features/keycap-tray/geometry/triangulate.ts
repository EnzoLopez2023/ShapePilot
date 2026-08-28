import earcut from 'earcut'
import type { Polygon } from './vec.ts'
import { openRing } from './vec.ts'

export interface Triangulation {
  /** Flat [x0,y0, x1,y1, ...] */
  verts: number[]
  /** Vertex indices into `verts`, three per triangle. */
  tris: number[]
}

/**
 * earcut has no concept of multiple outer rings, so this is per-polygon.
 * Hole offsets are vertex counts, not float counts, and rings must be unclosed
 * or earcut emits zero-area slivers at the repeated point.
 */
export function triangulatePolygon(poly: Polygon): Triangulation {
  const verts: number[] = []
  const holes: number[] = []
  for (let r = 0; r < poly.length; r++) {
    const ring = openRing(poly[r])
    if (ring.length < 3) continue
    if (verts.length) holes.push(verts.length / 2)
    for (const [x, y] of ring) verts.push(x, y)
  }
  if (verts.length < 6) return { verts, tris: [] }
  return { verts, tris: earcut(verts, holes, 2) }
}

/** Twice the signed area of a triangle given as indices into a flat vert array. */
export function signedArea2(verts: number[], a: number, b: number, c: number): number {
  const ax = verts[a * 2], ay = verts[a * 2 + 1]
  const bx = verts[b * 2], by = verts[b * 2 + 1]
  const cx = verts[c * 2], cy = verts[c * 2 + 1]
  return (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
}
