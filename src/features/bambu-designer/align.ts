// Align and mirror, the two multi-object operations Tinkercad leans on.
//
// Both work on axis-aligned bounds of the evaluated meshes rather than on
// transform values, because a rotated box's visual extent is not its width.
import type { Mesh } from '../../geometry/mesh.ts'
import type { SceneObject, Triple } from '../../model/document.ts'

export type Axis = 0 | 1 | 2
export type AlignEdge = 'min' | 'centre' | 'max'

export interface Bounds { min: Triple; max: Triple }

export const meshBounds = (mesh: Mesh): Bounds => ({
  min: [mesh.bbox[0], mesh.bbox[1], mesh.bbox[2]],
  max: [mesh.bbox[3], mesh.bbox[4], mesh.bbox[5]],
})

export function combinedBounds(all: readonly Bounds[]): Bounds | null {
  if (!all.length) return null
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const b of all) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], b.min[i])
      max[i] = Math.max(max[i], b.max[i])
    }
  }
  return { min, max }
}

const edgeValue = (b: Bounds, axis: Axis, edge: AlignEdge): number =>
  edge === 'min' ? b.min[axis]
    : edge === 'max' ? b.max[axis]
      : (b.min[axis] + b.max[axis]) / 2

/**
 * How far each object must move along `axis` to line up. Returned as deltas
 * rather than applied, so the caller can put the whole operation through one
 * history entry.
 */
export function alignDeltas(
  bounds: ReadonlyMap<string, Bounds>,
  ids: Iterable<string>,
  axis: Axis,
  edge: AlignEdge,
): Map<string, number> {
  const entries = [...ids]
    .map(id => [id, bounds.get(id)] as const)
    .filter((e): e is readonly [string, Bounds] => Boolean(e[1]))
  const deltas = new Map<string, number>()
  if (entries.length < 2) return deltas

  const overall = combinedBounds(entries.map(([, b]) => b))
  if (!overall) return deltas
  const target = edgeValue(overall, axis, edge)

  for (const [id, b] of entries) deltas.set(id, target - edgeValue(b, axis, edge))
  return deltas
}

/**
 * Mirror across the selection's own centre plane. Negative scale is what
 * actually flips the geometry; the position term keeps the object where it was
 * instead of letting it swing to the far side of the origin.
 */
export function mirrorTransform(
  object: SceneObject,
  bounds: Bounds | undefined,
  pivot: number,
  axis: Axis,
): { position: Triple; scale: Triple } {
  const position = [...object.transform.position] as [number, number, number]
  const scale = [...object.transform.scale] as [number, number, number]
  scale[axis] = -scale[axis]

  if (bounds) {
    const centre = (bounds.min[axis] + bounds.max[axis]) / 2
    // Reflect the object's own centre about the pivot, then move by the same
    // amount its origin sat from that centre.
    position[axis] += 2 * (pivot - centre)
  }
  return { position, scale }
}
