// Adapter over the 2D clipper. Everything downstream imports from here so
// swapping polygon-clipping (unmaintained since 2023) for polyclip-ts is a
// one-file change.
import * as pcNamespace from 'polygon-clipping'

// Dual-package hazard: Node's CJS interop exposes only a default export, while
// Vite resolves the ESM build which has only named exports. Normalize both.
const pc = ((pcNamespace as unknown as { default?: typeof pcNamespace }).default ??
  pcNamespace) as typeof pcNamespace
import type { MultiPolygon, Polygon, Ring } from './vec.ts'
import {
  bboxContains, bboxOverlaps, multiBBox, normalizeMulti, openRing,
  pointInRing, quantizeMulti, ringBBox, signedArea,
} from './vec.ts'

// polygon-clipping speaks GeoJSON: closed rings, [x,y] pairs.
type GeoRing = [number, number][]
type GeoPoly = GeoRing[]
type GeoMulti = GeoPoly[]

const close = (r: Ring): GeoRing => {
  const pts = r.map(([x, y]) => [x, y] as [number, number])
  if (pts.length && (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1])) {
    pts.push([pts[0][0], pts[0][1]])
  }
  return pts
}

const toGeo = (mp: MultiPolygon): GeoMulti => mp.map(p => p.map(close))
const fromGeo = (g: GeoMulti): MultiPolygon =>
  normalizeMulti(g.map(poly => poly.map(r => openRing(r.map(([x, y]) => [x, y] as const)))))

// Quantizing *before* the clipper is what keeps intersection points reproducible
// between the top-face and pocket-floor passes, which is what makes the mesh weld.
const prep = (mp: MultiPolygon): GeoMulti => toGeo(quantizeMulti(mp))

export function union(...geoms: MultiPolygon[]): MultiPolygon {
  const nonEmpty = geoms.filter(g => g.length)
  if (nonEmpty.length === 0) return []
  if (nonEmpty.length === 1) return normalizeMulti(quantizeMulti(nonEmpty[0]))
  const [first, ...rest] = nonEmpty.map(prep)
  return fromGeo(pc.union(first, ...rest) as GeoMulti)
}

export function difference(subject: MultiPolygon, ...clips: MultiPolygon[]): MultiPolygon {
  if (!subject.length) return []
  const active = clips.filter(c => c.length)
  if (!active.length) return normalizeMulti(quantizeMulti(subject))
  return fromGeo(pc.difference(prep(subject), ...active.map(prep)) as GeoMulti)
}

export function intersection(a: MultiPolygon, b: MultiPolygon): MultiPolygon {
  if (!a.length || !b.length) return []
  return fromGeo(pc.intersection(prep(a), prep(b)) as GeoMulti)
}

/**
 * Pockets in a real tray are a gap-separated grid that never overlaps, so the
 * clipper can be skipped entirely for ~100% of real designs. Returns null when
 * anything overlaps, meaning the caller must fall back to union().
 */
export function unionDisjointFast(polys: Polygon[]): MultiPolygon | null {
  const boxes = polys.map(p => ringBBox(p[0]))
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (bboxOverlaps(boxes[i], boxes[j])) return null
    }
  }
  return normalizeMulti(quantizeMulti(polys.map(p => [...p])))
}

/**
 * difference(outer, holes) for the common case where every hole sits strictly
 * inside `outer` and none touch each other: the holes become hole rings directly.
 * Returns null when the caller must use the general difference().
 *
 * Containment is tested against the outline itself, not its bounding box. On a
 * notched profile like the Systainer insert a pocket can sit inside the bbox
 * while spilling into a notch, and treating that as a clean hole silently yields
 * a non-manifold mesh.
 */
export function punchDisjointFast(outer: MultiPolygon, holes: Polygon[]): MultiPolygon | null {
  if (outer.length !== 1) return null
  const outerRing = outer[0][0]
  const outerBox = ringBBox(outerRing)
  const boxes = holes.map(h => ringBBox(h[0]))
  for (let i = 0; i < holes.length; i++) {
    if (!bboxContains(outerBox, boxes[i])) return null
    // Every vertex of the hole must lie inside the outline.
    for (const v of holes[i][0]) if (!pointInRing(v, outerRing)) return null
    // ...and no part of the outline may poke into the hole, which would mean the
    // hole swallowed a notch tip without any of its own vertices leaving.
    for (const v of outerRing) {
      if (v[0] > boxes[i].minX && v[0] < boxes[i].maxX &&
          v[1] > boxes[i].minY && v[1] < boxes[i].maxY) return null
    }
    for (let j = i + 1; j < holes.length; j++) {
      if (bboxOverlaps(boxes[i], boxes[j])) return null
    }
  }
  const existingHoles = outer[0].slice(1)
  for (const h of holes) {
    for (const eh of existingHoles) {
      if (bboxOverlaps(ringBBox(h[0]), ringBBox(eh))) return null
    }
  }
  const holeRings: Ring[] = holes.map(h => (signedArea(h[0]) > 0 ? [...h[0]].reverse() : h[0]))
  return normalizeMulti(quantizeMulti([[outerRing, ...existingHoles, ...holeRings]]))
}

export { multiBBox }
