// T-junction repair.
//
// A pocket that breaches the tray outline splits the profile edge, so the face
// above the split has vertices at the split points while the wall below still
// spans the edge in one go. That is a T-junction: the mesh looks closed but the
// half-edges never pair, and slicers report it as non-manifold.
//
// The clipper will not solve this -- when a union collapses back to a clean
// rectangle it drops the collinear split points again. So every region meeting
// at a z-interface is re-emitted here with the others' vertices inserted.
import type { MultiPolygon, Ring, Vec2 } from './vec.ts'
import { QUANTUM } from './vec.ts'

const CELL = 4 // mm
// Coordinates are snapped to the QUANTUM grid, so a point closer than one
// quantum to an edge cannot be meaningfully said to be off it -- snapping alone
// moves points by up to half that. A tighter epsilon leaves real T-junctions
// unrepaired where a pocket meets a notch diagonal at a shallow angle (observed
// at 3.0e-6 mm on the Systainer profile). One quantum is 0.1 micron: far below
// anything either machine can resolve.
const ON_EDGE_EPS = QUANTUM

const cellKey = (x: number, y: number): string => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`

// One geometric point can reach here as two different floats -- 18.5004 straight
// from a preset versus 18.500400000000003 after a round-trip through the clipper.
// Snapping every coordinate to `integer * QUANTUM` collapses those to a single
// representation so identity comparisons below are exact.
const snap = (v: number): number => Math.round(v / QUANTUM) * QUANTUM
const snapRing = (r: Ring): Ring => r.map(([x, y]) => [snap(x), snap(y)] as Vec2)
const ptKey = (p: Vec2): string => `${p[0]},${p[1]}`

function buildIndex(regions: MultiPolygon[]): Map<string, Vec2[]> {
  const grid = new Map<string, Vec2[]>()
  const seen = new Set<string>()
  for (const mp of regions) {
    for (const poly of mp) {
      for (const ring of poly) {
        for (const p of ring) {
          const id = ptKey(p)
          if (seen.has(id)) continue
          seen.add(id)
          const k = cellKey(p[0], p[1])
          const bucket = grid.get(k)
          if (bucket) bucket.push(p)
          else grid.set(k, [p])
        }
      }
    }
  }
  return grid
}

function pointsNear(grid: Map<string, Vec2[]>, a: Vec2, b: Vec2): Vec2[] {
  const x0 = Math.floor(Math.min(a[0], b[0]) / CELL)
  const x1 = Math.floor(Math.max(a[0], b[0]) / CELL)
  const y0 = Math.floor(Math.min(a[1], b[1]) / CELL)
  const y1 = Math.floor(Math.max(a[1], b[1]) / CELL)
  const out: Vec2[] = []
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      const bucket = grid.get(`${cx},${cy}`)
      if (bucket) out.push(...bucket)
    }
  }
  return out
}

function splitRing(ring: Ring, grid: Map<string, Vec2[]>): Ring {
  const out: Ring = []
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    out.push(a)
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    if (len2 < 1e-18) continue
    const len = Math.sqrt(len2)
    const hits: { t: number; p: Vec2 }[] = []
    const aKey = ptKey(a), bKey = ptKey(b)
    for (const p of pointsNear(grid, a, b)) {
      // Only this edge's own endpoints are excluded. A ring may legitimately
      // carry the same vertex elsewhere on its boundary and still need it
      // inserted here -- guarding on whole-ring membership silently leaves those
      // T-junctions unrepaired.
      const k = ptKey(p)
      if (k === aKey || k === bKey) continue
      const px = p[0] - a[0], py = p[1] - a[1]
      const t = (px * dx + py * dy) / len2
      if (t <= 1e-12 || t >= 1 - 1e-12) continue
      // perpendicular distance from the segment's line
      if (Math.abs(px * dy - py * dx) / len > ON_EDGE_EPS) continue
      hits.push({ t, p })
    }
    if (!hits.length) continue
    hits.sort((u, v) => u.t - v.t)
    let prevT = -1
    for (const h of hits) {
      if (h.t - prevT < 1e-12) continue // duplicate split point
      out.push(h.p)
      prevT = h.t
    }
  }
  return out
}

/**
 * Re-emit every region with the vertices of all the others inserted wherever
 * they land mid-edge. Regions that share no boundary are returned untouched.
 */
export function insertTJunctions(regions: MultiPolygon[]): MultiPolygon[] {
  const snapped = regions.map(mp => mp.map(poly => poly.map(snapRing)))
  const grid = buildIndex(snapped)
  return snapped.map(mp => mp.map(poly => poly.map(ring => splitRing(ring, grid))))
}
