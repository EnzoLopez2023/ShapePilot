// Scene objects -> 2D polygons, in millimetres and y-up. This is what the
// Shaper canvas draws and what the CNC exporters cut; the 3D sub-apps use
// src/csg/fromScene.ts instead.
import type { MultiPolygon, Polygon, Ring } from './vec.ts'
import { normalizeMulti, quantizeRing, rotateRing, translateRing } from './vec.ts'
import { difference, union } from './boolean.ts'
import {
  circleRing, ellipseRing, rectRing, regularPolygonRing, triangleRing,
} from './primitives.ts'
import type { SceneObject, Shape2DObject, TextObject } from '../model/document.ts'

/**
 * Glyph outlines need a font binary, which loads asynchronously. Callers resolve
 * text up front and pass the result in, so this whole module stays synchronous
 * and pure -- the canvas re-renders on every drag and cannot await.
 */
export type TextOutlines = ReadonlyMap<string, Ring[]>

export interface CompileOptions {
  /** Keyed by object id. Missing entries render as nothing rather than throwing. */
  textOutlines?: TextOutlines
}

const scaleRing = (r: Ring, sx: number, sy: number): Ring =>
  sx === 1 && sy === 1 ? r : r.map(([x, y]) => [x * sx, y * sy] as const)

/**
 * Object-local rings -> document space. Scale, then rotate about the object's
 * own origin, then translate: the same order the transform fields are written
 * in, and the order the inspector's numbers imply.
 */
function place(rings: Ring[], o: SceneObject): Ring[] {
  const [sx, sy] = o.transform.scale
  const [, , rz] = o.transform.rotationDeg
  const [px, py] = o.transform.position
  return rings.map(r => {
    let out = scaleRing(r, sx, sy)
    if (rz) out = rotateRing(out, rz, 0, 0)
    return quantizeRing(translateRing(out, px, py))
  })
}

function shape2dRings(o: Shape2DObject): Ring[] {
  const p = o.params
  switch (o.shape) {
    case 'circle':
      return [circleRing(p.radiusMm ?? 10)]
    case 'ellipse':
      return [ellipseRing(p.radiusMm ?? 10, p.radiusYMm ?? p.radiusMm ?? 10)]
    case 'rect':
    case 'square': {
      const w = p.widthMm ?? 10
      const h = o.shape === 'square' ? w : (p.heightMm ?? w)
      // rectRing puts the origin at the lower-left; every other primitive is
      // centred, so recentre to keep rotation and drag behaviour consistent.
      return [translateRing(rectRing(w, h, p.cornerRadiusMm ?? 0), -w / 2, -h / 2)]
    }
    case 'triangle': {
      const w = p.widthMm ?? 10
      const h = p.heightMm ?? w
      return [translateRing(triangleRing(w, h), -w / 2, -h / 2)]
    }
    case 'polygon':
      return [regularPolygonRing(p.sides ?? 6, p.radiusMm ?? 10)]
  }
}

const textRings = (o: TextObject, opts: CompileOptions): Ring[] =>
  [...(opts.textOutlines?.get(o.id) ?? [])]

/**
 * One object's own outline, before any group boolean. Groups return their
 * resolved result; imported meshes contribute nothing here (the importer turns
 * an SVG or DXF into real shape objects, and an STL has no 2D outline until it
 * is projected).
 */
export function objectRings(o: SceneObject, opts: CompileOptions = {}): Ring[] {
  switch (o.type) {
    case 'shape2d': return place(shape2dRings(o), o)
    case 'text': return place(textRings(o, opts), o)
    // A 3D primitive dropped into a 2D document is not silently cut; the Shaper
    // page reports it as an unsupported object instead.
    case 'solid': return []
    case 'imported': return []
    // Resolving a group means running its boolean; `compileObject` owns that.
    case 'group': return []
  }
}

/**
 * A group resolves like Tinkercad's Group: solids union, holes subtract. The
 * same rule at every level, so nesting behaves the way the object tree looks.
 */
export function compileObject(o: SceneObject, opts: CompileOptions = {}): MultiPolygon {
  if (!o.visible) return []

  if (o.type === 'group') {
    const solids: MultiPolygon = []
    const holes: MultiPolygon = []
    for (const child of o.children) {
      const target = child.mode === 'hole' ? holes : solids
      target.push(...compileObject(child, opts))
    }
    const merged = solids.length ? union(solids) : []
    const cut = holes.length ? difference(merged, holes) : merged
    return applyGroupTransform(cut, o)
  }

  const rings = objectRings(o, opts)
  return normalizeMulti(rings.map(r => [r] as Polygon))
}

/** A group's own transform applies on top of its resolved children. */
function applyGroupTransform(mp: MultiPolygon, o: SceneObject): MultiPolygon {
  const [sx, sy] = o.transform.scale
  const [, , rz] = o.transform.rotationDeg
  const [px, py] = o.transform.position
  if (sx === 1 && sy === 1 && !rz && !px && !py) return mp
  return normalizeMulti(mp.map(poly => poly.map(ring => {
    let out = scaleRing(ring, sx, sy)
    if (rz) out = rotateRing(out, rz, 0, 0)
    return quantizeRing(translateRing(out, px, py))
  })))
}

/** Top-level objects, each resolved independently. Hole-mode objects that sit
 *  outside any group are inert, exactly as they are in Tinkercad. */
export const compileObjects = (
  objects: readonly SceneObject[],
  opts: CompileOptions = {},
): MultiPolygon[] => objects.filter(o => o.visible).map(o => compileObject(o, opts))

/** Everything merged into one region -- used for fit-to-view and bounds. */
export function compileScene(
  objects: readonly SceneObject[],
  opts: CompileOptions = {},
): MultiPolygon {
  const all = compileObjects(objects, opts).filter(mp => mp.length)
  return all.length ? union(...all) : []
}
