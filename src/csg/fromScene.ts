// Scene objects -> ShapeProgram. This is what makes an AI proposal and a
// hand-built Tinkercad-style group the same thing downstream: both become a
// program, and the program is the only input the evaluator knows.
import type {
  GroupObject, SceneObject, Shape2DObject, SolidObject, Transform,
} from '../model/document.ts'
import type {
  PartNode, Point2, ProgramParams, ProgramTransform, ShapeProgram,
} from '../../lib/contracts/shapeProgram.ts'
import { SHAPE_PROGRAM_VERSION } from '../../lib/contracts/shapeProgram.ts'
import type { Ring } from '../geometry/vec.ts'
import { circleRing, ellipseRing, rectRing, regularPolygonRing, triangleRing } from '../geometry/primitives.ts'
import type { TextOutlines } from '../geometry/sceneShapes.ts'

export interface FromSceneOptions {
  /** Glyph outlines per object id; see src/geometry/sceneShapes.ts. */
  textOutlines?: TextOutlines
}

const toProgramTransform = (t: Transform): ProgramTransform => ({
  position: t.position,
  rotationDeg: t.rotationDeg,
  scale: t.scale,
})

const toProfile = (ring: Ring): Point2[] => ring.map(([x, y]) => [x, y] as Point2)

/** 2D shapes become extrusions. Rings are generated centred so a rotation in
 *  the inspector turns the shape about itself, matching the 2D canvas. */
function shape2dProfile(o: Shape2DObject): Ring {
  const p = o.params
  switch (o.shape) {
    case 'circle': return circleRing(p.radiusMm ?? 10)
    case 'ellipse': return ellipseRing(p.radiusMm ?? 10, p.radiusYMm ?? p.radiusMm ?? 10)
    case 'rect':
    case 'square': {
      const w = p.widthMm ?? 10
      const h = o.shape === 'square' ? w : (p.heightMm ?? w)
      return rectRing(w, h, p.cornerRadiusMm ?? 0).map(([x, y]) => [x - w / 2, y - h / 2] as const)
    }
    case 'triangle': {
      const w = p.widthMm ?? 10
      const h = p.heightMm ?? w
      return triangleRing(w, h).map(([x, y]) => [x - w / 2, y - h / 2] as const)
    }
    case 'polygon': return regularPolygonRing(p.sides ?? 6, p.radiusMm ?? 10)
  }
}

const solidParams = (o: SolidObject): ProgramParams => {
  const p = o.params
  return {
    widthMm: p.widthMm, depthMm: p.depthMm, heightMm: p.heightMm,
    radiusMm: p.radiusMm, topRadiusMm: p.topRadiusMm, tubeMm: p.tubeMm,
    segments: p.segments,
  }
}

/**
 * A group becomes `difference(union(solids), ...holes)` -- Tinkercad's Group in
 * one line. A group of only holes has nothing to cut from and compiles away.
 */
function groupNode(o: GroupObject, opts: FromSceneOptions): PartNode | null {
  const solids: PartNode[] = []
  const holes: PartNode[] = []
  for (const child of o.children) {
    const node = objectNode(child, opts)
    if (!node) continue
    ;(child.mode === 'hole' ? holes : solids).push(node)
  }
  if (!solids.length) return null

  const positive: PartNode = solids.length === 1
    ? solids[0]
    : { id: `${o.id}:solids`, name: `${o.name} solids`, op: 'union', children: solids, transform: IDENTITY }

  if (!holes.length) {
    return { ...positive, id: o.id, name: o.name, transform: toProgramTransform(o.transform) } as PartNode
  }
  return {
    id: o.id, name: o.name, op: 'difference',
    children: [positive, ...holes],
    transform: toProgramTransform(o.transform),
  }
}

const IDENTITY: ProgramTransform = {
  position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1],
}

/** `null` means "contributes no solid" -- an invisible object, an unresolved
 *  import, or a text object whose outlines have not loaded yet. */
export function objectNode(o: SceneObject, opts: FromSceneOptions = {}): PartNode | null {
  if (!o.visible) return null
  const transform = toProgramTransform(o.transform)

  switch (o.type) {
    case 'solid':
      return { id: o.id, name: o.name, op: o.primitive, params: solidParams(o), transform }

    case 'shape2d':
      return {
        id: o.id, name: o.name, op: 'extrude', transform,
        params: { profile: toProfile(shape2dProfile(o)), heightMm: o.thicknessMm ?? 5 },
      }

    case 'path': {
      const [outer, ...holes] = o.rings
      if (!outer?.length) return null
      return {
        id: o.id, name: o.name, op: 'extrude', transform,
        params: {
          profile: outer.map(([x, y]) => [x, y] as Point2),
          holes: holes.map(h => h.map(([x, y]) => [x, y] as Point2)),
          heightMm: o.thicknessMm ?? 5,
        },
      }
    }

    case 'text': {
      const rings = opts.textOutlines?.get(o.id)
      if (!rings?.length) return null
      // Each glyph contour extrudes separately and the set unions: one
      // extrusion with all contours would treat counters as solid, so the hole
      // in an "o" would fill in.
      const children: PartNode[] = rings.map((ring, i) => ({
        id: `${o.id}:${i}`, name: `${o.name} ${i + 1}`, op: 'extrude' as const,
        params: { profile: toProfile(ring), heightMm: o.thicknessMm ?? 5 },
        transform: IDENTITY,
      }))
      return children.length === 1
        ? { ...children[0], id: o.id, name: o.name, transform }
        : { id: o.id, name: o.name, op: 'union', children, transform }
    }

    // An imported model joins the program as a `mesh` node keyed by its content
    // hash; the triangles travel beside the program, not inside it. That is what
    // lets an import be grouped, cut against and exported like anything else.
    case 'imported':
      return {
        id: o.id, name: o.name, op: 'mesh', transform,
        params: { meshId: o.asset.hash },
      }

    case 'group': return groupNode(o, opts)
  }
}

export function programFromScene(
  objects: readonly SceneObject[],
  opts: FromSceneOptions = {},
): ShapeProgram {
  const parts = objects
    // A top-level hole has nothing to subtract from, so it is inert here too.
    .filter(o => o.mode !== 'hole')
    .map(o => objectNode(o, opts))
    .filter((n): n is PartNode => n !== null)
  return { version: SHAPE_PROGRAM_VERSION, units: 'mm', parts }
}

/** Compile a program back into scene objects, for applying an AI proposal.
 *  Each top-level part lands as its own object so it stays editable. */
export const programIsEmpty = (program: ShapeProgram): boolean => program.parts.length === 0
