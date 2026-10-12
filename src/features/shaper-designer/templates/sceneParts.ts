// The objects a template is made of. Plain path objects, so everything in a
// template can be moved, re-typed or deleted like anything the user drew.
import type {
  Contour, CutType, DesignDocument, GroupObject, PathObject, SceneObject,
} from '../../../model/document.ts'
import type { Ring } from '../../../geometry/vec.ts'
import { ringBBox } from '../../../geometry/vec.ts'
import { IDENTITY_TRANSFORM, emptyDocument, newId } from '../../../model/scene.ts'

const base = (name: string, type: CutType, depthMm?: number) => ({
  id: newId(),
  name,
  transform: IDENTITY_TRANSFORM,
  mode: 'solid' as const,
  visible: true,
  locked: false,
  cut: depthMm === undefined ? { type } : { type, depthMm },
})

/** One outline. A PathObject's later rings are holes in its first, so a part
 *  with several separate outlines is a `part` group instead. */
export const outline = (name: string, ring: Ring, type: CutType, depthMm?: number): PathObject => ({
  ...base(name, type, depthMm),
  type: 'path',
  rings: [ring],
  thicknessMm: 19,
})

/**
 * Several outlines cut the same way -- a grid of holes, a set of coasters. A
 * group resolves to the union of its children and is cut as the group's own
 * cut type, so this only ever groups like with like: grouping a groove with
 * the board it sits in would hand the groove the board's exterior cut.
 */
export const part = (name: string, rings: Ring[], type: CutType, depthMm?: number): GroupObject => ({
  ...base(name, type, depthMm),
  type: 'group',
  children: rings.map((r, i) => outline(`${name} ${i + 1}`, r, type, depthMm)),
})

const ringsOf = (o: SceneObject): Contour[] =>
  o.type === 'path' ? o.rings : o.type === 'group' ? o.children.flatMap(ringsOf) : []

function shift(o: SceneObject, dx: number, dy: number): SceneObject {
  const move = (r: Contour): Contour => r.map(([x, y]) => [x + dx, y + dy] as const)
  if (o.type === 'path') return { ...o, rings: o.rings.map(move) }
  if (o.type === 'group') return { ...o, children: o.children.map(c => shift(c, dx, dy)) }
  return o
}

/** A new document with the drawing centred on the origin, so it opens in the
 *  middle of the canvas whatever coordinates it was drawn in. */
export function templateDocument(name: string, notes: string[], objects: SceneObject[]): DesignDocument {
  const b = ringBBox(objects.flatMap(ringsOf).flat() as Ring)
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2
  return {
    ...emptyDocument('shaper', name),
    notes: notes.join('\n'),
    objects: objects.map(o => shift(o, -cx, -cy)),
  }
}
