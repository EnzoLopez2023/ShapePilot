// ShapeProgram -> scene objects, the inverse of fromScene.
//
// This is what makes an AI proposal ordinary editable work rather than an
// opaque blob: each top-level part lands as its own object, keeps the model's
// chosen name, and can then be moved, renamed, grouped or deleted like anything
// the user drew by hand.
import type {
  BooleanNode, PartNode, PrimitiveNode, ProgramTransform, ShapeProgram,
} from '../../lib/contracts/shapeProgram.ts'
import { isBooleanNode } from '../../lib/contracts/shapeProgram.ts'
import type {
  Contour, SceneObject, SolidKind, Transform,
} from '../model/document.ts'
import { newId } from '../model/scene.ts'

const toTransform = (t: ProgramTransform): Transform => ({
  position: t.position,
  rotationDeg: t.rotationDeg,
  scale: t.scale,
})

const SOLID_OPS = new Set<string>(['box', 'cylinder', 'sphere', 'cone', 'torus', 'wedge'])

/**
 * Program ids are kebab-case and meaningful, and the model is told to keep them
 * stable across edits. They are reused as scene object ids so an "add a hole to
 * the base" turn modifies the same object rather than replacing it -- which is
 * what makes the diff in the review panel truthful.
 */
function primitiveObject(node: PrimitiveNode): SceneObject | null {
  const base = {
    id: node.id || newId(),
    name: node.name,
    transform: toTransform(node.transform),
    mode: 'solid' as const,
    visible: true,
    locked: false,
  }

  if (SOLID_OPS.has(node.op)) {
    return {
      ...base,
      type: 'solid',
      primitive: node.op as SolidKind,
      params: {
        widthMm: node.params.widthMm,
        depthMm: node.params.depthMm,
        heightMm: node.params.heightMm,
        radiusMm: node.params.radiusMm,
        topRadiusMm: node.params.topRadiusMm,
        tubeMm: node.params.tubeMm,
        segments: node.params.segments,
      },
    }
  }

  if (node.op === 'extrude' && node.params.profile) {
    const rings: Contour[] = [
      node.params.profile.map(([x, y]) => [x, y] as const),
      ...(node.params.holes ?? []).map(h => h.map(([x, y]) => [x, y] as const)),
    ]
    return {
      ...base,
      type: 'path',
      rings,
      thicknessMm: node.params.heightMm ?? 5,
    }
  }

  if (node.op === 'text' && node.params.text) {
    return {
      ...base,
      type: 'text',
      text: node.params.text,
      fontId: node.params.fontId ?? 'archivo-medium',
      sizeMm: node.params.sizeMm ?? node.params.heightMm ?? 12,
      thicknessMm: node.params.heightMm ?? 5,
    }
  }

  return null
}

/**
 * A boolean node becomes a group. `difference` is the interesting case: its
 * first child is material and the rest are holes, which is exactly the
 * solid/hole distinction the group already expresses, so the round trip through
 * fromScene is lossless for the shapes a person can also build by hand.
 */
function booleanObject(node: BooleanNode): SceneObject | null {
  const children: SceneObject[] = []
  node.children.forEach((child, index) => {
    const object = nodeObject(child)
    if (!object) return
    const hole = node.op === 'difference' && index > 0
    children.push(hole ? { ...object, mode: 'hole' } : object)
  })
  if (!children.length) return null

  // An intersection has no scene equivalent -- a group unions its solids -- so
  // it is kept as a group and flagged in the name rather than silently becoming
  // a union, which would change the geometry.
  const name = node.op === 'intersection' ? `${node.name} (intersection)` : node.name

  return {
    id: node.id || newId(),
    name,
    transform: toTransform(node.transform),
    mode: 'solid',
    visible: true,
    locked: false,
    type: 'group',
    children,
  }
}

export const nodeObject = (node: PartNode): SceneObject | null =>
  isBooleanNode(node) ? booleanObject(node) : primitiveObject(node)

export function programToObjects(program: ShapeProgram): SceneObject[] {
  const objects: SceneObject[] = []
  for (const part of program.parts) {
    const object = nodeObject(part)
    if (object) objects.push(object)
  }
  return objects
}

/** Scene objects reuse program ids, so a later turn can be matched back. */
export const objectIdsFrom = (program: ShapeProgram): string[] =>
  program.parts.map(p => p.id)
