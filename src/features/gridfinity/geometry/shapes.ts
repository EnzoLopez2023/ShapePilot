// Small solid-building helpers for the Gridfinity generators. Every profile in
// a Gridfinity bin or baseplate is a stack of rounded rectangles that grow or
// shrink at 45 degrees, so each band is the convex hull of two rings. Hulls
// keep the booleans that follow robust: no thin slivers, no coplanar fights.
import type { Manifold, ManifoldToplevel, Vec3 } from 'manifold-3d'

/** Quarter-circle segments per rounded corner. */
const CORNER_SEGMENTS = 8

/** A rounded rectangle, by its min corner, size and inset from that outline. */
export interface Outline {
  x: number
  y: number
  w: number
  d: number
  /** Corner radius of the outline before any inset. */
  r: number
}

/**
 * Points of `outline` shrunk by `inset` all round, at height `z`. The radius
 * shrinks with the inset (an offset), never below a hair so the ring keeps a
 * consistent vertex count for the hull.
 */
export function ring(outline: Outline, inset: number, z: number): Vec3[] {
  const r = Math.max(0.05, outline.r - inset)
  const x0 = outline.x + inset + r
  const x1 = outline.x + outline.w - inset - r
  const y0 = outline.y + inset + r
  const y1 = outline.y + outline.d - inset - r
  const centres: [number, number, number][] = [
    [x1, y1, 0], [x0, y1, 90], [x0, y0, 180], [x1, y0, 270],
  ]
  const pts: Vec3[] = []
  for (const [cx, cy, start] of centres) {
    for (let i = 0; i <= CORNER_SEGMENTS; i++) {
      const a = ((start + (90 * i) / CORNER_SEGMENTS) * Math.PI) / 180
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), z])
    }
  }
  return pts
}

/** A band between two (inset, z) stations of one outline. */
export const band = (
  wasm: ManifoldToplevel, outline: Outline,
  from: readonly [inset: number, z: number], to: readonly [inset: number, z: number],
): Manifold => wasm.Manifold.hull([...ring(outline, from[0], from[1]), ...ring(outline, to[0], to[1])])

/** A stack of bands through successive (inset, z) stations, unioned. */
export function profile(
  wasm: ManifoldToplevel, outline: Outline, stations: readonly (readonly [number, number])[],
): Manifold {
  const parts: Manifold[] = []
  for (let i = 1; i < stations.length; i++) parts.push(band(wasm, outline, stations[i - 1], stations[i]))
  return wasm.Manifold.union(parts)
}

export function finish(solid: Manifold, what: string): Manifold {
  const status = solid.status()
  if (status !== 'NoError') throw new Error(`${what} could not be built (${status})`)
  return solid
}
