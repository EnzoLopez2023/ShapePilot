// Flat rings -> nested polygons.
//
// Importers get a bag of closed rings with no parent/child information: SVG
// subpaths carry it only through fill-rule, which a file may omit, and DXF has
// no concept of a hole at all. Containment is the one signal always present, so
// nesting is derived from geometry rather than trusted from the file.
import type { BBox, MultiPolygon, Polygon, Ring } from './vec.ts'
import { bboxContains, normalizeMulti, pointInRing, ringBBox, signedArea } from './vec.ts'

interface Candidate {
  ring: Ring
  bbox: BBox
  area: number
  parent: number
  depth: number
}

/** Sample several vertices rather than one: a single vertex can sit exactly on
 *  the parent's edge where the ray test is undefined either way. */
function inside(ring: Ring, outer: Ring): boolean {
  const step = Math.max(1, Math.floor(ring.length / 5))
  let hits = 0, tested = 0
  for (let i = 0; i < ring.length && tested < 5; i += step, tested++) {
    if (pointInRing(ring[i], outer)) hits++
  }
  return hits * 2 > tested
}

/**
 * Rings at even containment depth are outers; odd depth are their holes. Depth
 * two starts a new polygon again -- an island inside a hole, which is how a
 * washer inside a counterbore comes out of a real drawing.
 */
export function nestRings(rings: readonly Ring[]): MultiPolygon {
  const items: Candidate[] = rings
    .filter(r => r.length >= 3)
    .map(ring => ({ ring, bbox: ringBBox(ring), area: Math.abs(signedArea(ring)), parent: -1, depth: 0 }))
    .filter(c => c.area > 0)
    // Largest first, so a ring's parent is always earlier in the list.
    .sort((a, b) => b.area - a.area)

  for (let i = 0; i < items.length; i++) {
    for (let j = i - 1; j >= 0; j--) {
      // Checked innermost-outward, so the first container found is the closest.
      if (!bboxContains(items[j].bbox, items[i].bbox)) continue
      if (!inside(items[i].ring, items[j].ring)) continue
      items[i].parent = j
      items[i].depth = items[j].depth + 1
      break
    }
  }
  // A ring is a hole only where its parent is an outer; nesting deeper than
  // that restarts, which the parity of `depth` already expresses.
  const polygons = new Map<number, Polygon>()
  for (let i = 0; i < items.length; i++) {
    if (items[i].depth % 2 === 0) polygons.set(i, [items[i].ring])
  }
  for (let i = 0; i < items.length; i++) {
    if (items[i].depth % 2 === 1) polygons.get(items[i].parent)?.push(items[i].ring)
  }

  // normalizeMulti fixes winding: outer CCW, holes CW.
  return normalizeMulti([...polygons.values()])
}
