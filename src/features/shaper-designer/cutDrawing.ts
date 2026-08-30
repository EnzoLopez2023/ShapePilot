// A scene document as Shaper cut layers.
//
// Objects are grouped by cut type, not emitted one per layer, because the SVG
// encoding is per-cut-type: Origin reads the colour of a group to decide what
// the bit does. Order matters -- exterior last would have the profile drawn
// over its own pockets.
import type { MultiPolygon } from '../../geometry/vec.ts'
import { union } from '../../geometry/boolean.ts'
import { compileObject } from '../../geometry/sceneShapes.ts'
import type { CompileOptions } from '../../geometry/sceneShapes.ts'
import type { CutType, DesignDocument, SceneObject } from '../../model/document.ts'
import type { CutDrawing, CutLayer } from '../../export/cutLayers.ts'

/** Emission order. Anything not cut through comes before the outline that frees
 *  the part, which is also the order a person would cut them by hand. */
const LAYER_ORDER: CutType[] = ['pocket', 'interior', 'online', 'guide', 'exterior']

const LAYER_LABEL: Record<CutType, string> = {
  pocket: 'pockets',
  interior: 'interior-cuts',
  online: 'on-line-cuts',
  guide: 'guides',
  exterior: 'exterior-profile',
}

export const cutTypeOf = (o: SceneObject): CutType => o.cut?.type ?? 'exterior'

export function sceneCutDrawing(doc: DesignDocument, opts: CompileOptions = {}): CutDrawing {
  const byType = new Map<CutType, MultiPolygon[]>()
  const depths = new Map<CutType, number>()

  for (const object of doc.objects) {
    if (!object.visible) continue
    const polygons = compileObject(object, opts)
    if (!polygons.length) continue
    const type = cutTypeOf(object)
    const bucket = byType.get(type) ?? []
    bucket.push(polygons)
    byType.set(type, bucket)
    if (type === 'pocket' && object.cut?.depthMm !== undefined) {
      // One depth per layer is what the format carries, so the deepest wins and
      // the page warns when objects disagree.
      depths.set(type, Math.max(depths.get(type) ?? 0, object.cut.depthMm))
    }
  }

  const layers: CutLayer[] = []
  for (const type of LAYER_ORDER) {
    const bucket = byType.get(type)
    if (!bucket?.length) continue
    layers.push({
      id: LAYER_LABEL[type],
      cutType: type,
      polygons: union(...bucket),
      ...(type === 'pocket' ? { depthMm: depths.get(type) ?? 3 } : {}),
    })
  }

  return {
    name: doc.name,
    layers,
    description: '1 unit = 1 mm, 1:1 scale. grey = pocket | black = interior | '
      + 'white+outline = exterior | blue = guide',
  }
}

/** Objects whose pocket depths disagree, so the page can say so rather than
 *  silently cutting them all to one depth. */
export function conflictingPocketDepths(doc: DesignDocument): number[] {
  const depths = new Set<number>()
  for (const o of doc.objects) {
    if (o.visible && cutTypeOf(o) === 'pocket') depths.add(o.cut?.depthMm ?? 3)
  }
  return depths.size > 1 ? [...depths].sort((a, b) => a - b) : []
}
