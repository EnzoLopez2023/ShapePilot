// Applying an AI proposal to the scene it was asked about.
//
// The assistant only ever sees part of a scene. programFromScene leaves out
// top-level holes, hidden objects and text whose outlines had not loaded, and
// the one thing it does send that the assistant cannot send back is an import:
// `mesh` is not an op the model may emit. Replacing the scene with
// programToObjects(proposal) therefore deleted all of those, and flattened the
// colour, lock and editable text of every part the model returned untouched.
//
// So a proposal is merged, not swapped in. The rule is that the assistant owns
// exactly what it was shown and could have written:
// - an object it was never shown, or an import, is kept where it was;
// - a part it returns unchanged is the original object, not a rebuild of it;
// - a part it changes is rebuilt, keeping the original's colour, filament and lock;
// - a part it was shown and left out is removed.
import type { BooleanNode, PartNode, ShapeProgram } from '../../lib/contracts/shapeProgram.ts'
import { isBooleanNode, walkProgram } from '../../lib/contracts/shapeProgram.ts'
import type { SceneObject } from '../model/document.ts'
import { findObject, newId } from '../model/scene.ts'
import { childMode, groupObject, nodeObject } from './toScene.ts'

/** Stable across key order and an empty `holes`, which the scene emits and a
 *  validated program may not -- so "unchanged" means the geometry is. */
function canonical(node: PartNode): string {
  return JSON.stringify(node, (key, value: unknown) => {
    if (key === 'holes' && Array.isArray(value) && value.length === 0) return undefined
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
    }
    return value
  })
}

export function mergeProposal(
  objects: readonly SceneObject[],
  sent: ShapeProgram | null,
  proposed: ShapeProgram,
): SceneObject[] {
  const shown = new Map<string, string>()
  if (sent) for (const node of walkProgram(sent.parts)) shown.set(node.id, canonical(node))

  const outOfReach = (o: SceneObject) => o.type === 'imported' || !shown.has(o.id)

  const convert = (node: PartNode, mode: 'solid' | 'hole'): SceneObject | null => {
    const found = findObject(objects, node.id)
    // An id the model reused for something it could not have been shown keeps
    // that object safe: the new part gets an id of its own.
    const collides = found !== undefined && outOfReach(found)
    const prior = collides ? undefined : found

    if (prior && shown.get(node.id) === canonical(node)) return { ...prior, mode }

    const rebuilt = isBooleanNode(node)
      ? groupObject(node, level(prior?.type === 'group' ? prior.children : [], node.children, node))
      : nodeObject(node)
    if (!rebuilt) return null
    return {
      ...rebuilt,
      ...(collides ? { id: newId() } : {}),
      ...(prior?.color !== undefined ? { color: prior.color } : {}),
      ...(prior?.filamentSlot !== undefined ? { filamentSlot: prior.filamentSlot } : {}),
      ...(prior ? { locked: prior.locked } : {}),
      mode,
    }
  }

  /** One list of siblings: the existing ones in their order, then new parts. */
  const level = (
    existing: readonly SceneObject[],
    nodes: readonly PartNode[],
    parent: BooleanNode | null,
  ): SceneObject[] => {
    const modeOf = (index: number) => (parent ? childMode(parent, index) : 'solid')
    const indexById = new Map(nodes.map((node, index) => [node.id, index]))
    const placed = new Set<number>()
    const out: SceneObject[] = []

    for (const object of existing) {
      const index = indexById.get(object.id)
      if (index !== undefined && object.type !== 'imported') {
        placed.add(index)
        const converted = convert(nodes[index], modeOf(index))
        if (converted) out.push(converted)
      } else if (outOfReach(object)) {
        out.push(object)
      }
    }
    nodes.forEach((node, index) => {
      if (placed.has(index)) return
      const converted = convert(node, modeOf(index))
      if (converted) out.push(converted)
    })
    return out
  }

  return level(objects, proposed.parts, null)
}
