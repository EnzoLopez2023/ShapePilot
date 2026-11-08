// A scene document as Shaper cut layers.
//
// Objects are grouped by cut type, not emitted one per layer, because the SVG
// encoding is per-cut-type: Origin reads the colour of a group to decide what
// the bit does. Order matters -- exterior last would have the profile drawn
// over its own pockets.
import type { MultiPolygon, Ring } from '../../geometry/vec.ts'
import { union } from '../../geometry/boolean.ts'
import { compileObject, objectPockets, openPathRings } from '../../geometry/sceneShapes.ts'
import type { CompileOptions } from '../../geometry/sceneShapes.ts'
import type { CutType, DesignDocument, SceneObject } from '../../model/document.ts'
import type { CutDrawing, CutLayer } from '../../export/cutLayers.ts'
import { SHAPER_ORIGIN } from '../../model/machines.ts'

/** Paint order, bottom to top. The profile goes first, as the keycap tray's
 *  proven file has it: its white fill would otherwise paint over every pocket
 *  and hole inside it, in Origin's preview and in any viewer. Which cut is made
 *  first is decided at the machine, not by this order. */
const LAYER_ORDER: CutType[] = ['exterior', 'pocket', 'interior', 'online', 'guide']

const LAYER_LABEL: Record<CutType, string> = {
  pocket: 'pockets',
  interior: 'interior-cuts',
  online: 'on-line-cuts',
  guide: 'guides',
  exterior: 'exterior-profile',
}

export const cutTypeOf = (o: SceneObject): CutType => o.cut?.type ?? 'exterior'

/** The stock the design is cut from: the depth every through cut goes to. A
 *  document saved before the setting existed falls back to the machine default. */
export const materialThicknessMm = (doc: DesignDocument): number =>
  doc.machine?.kind === 'cnc' ? doc.machine.stockThicknessMm : SHAPER_ORIGIN.stockThicknessMm

/** Through cuts go the full material thickness. */
const THROUGH: ReadonlySet<CutType> = new Set(['exterior', 'interior'])

/** Shapes that carry their own through-holes: a pegboard's slots, an MFT top's dog holes. */
const isPegboard = (o: SceneObject): boolean =>
  o.type === 'shape2d' && (o.shape === 'skadis' || o.shape === 'mft')

/**
 * Which layers one object feeds, and with what.
 *
 * Almost everything feeds one layer. A pegboard (or an MFT top) feeds two: Origin reads the
 * bit's behaviour from the colour of a path, so the outline that frees the
 * board and the slots that go through it cannot share a layer. Sent as a single
 * holed path the slots would inherit the outline's cut type and never be cut.
 */
function cutContributions(o: SceneObject, polygons: MultiPolygon): [CutType, MultiPolygon][] {
  const type = cutTypeOf(o)
  if (!isPegboard(o)) return [[type, polygons]]
  const outline: MultiPolygon = polygons.map(poly => [poly[0]])
  const slots: MultiPolygon = polygons.flatMap(poly => poly.slice(1).map(hole => [hole]))
  return [[type, outline], ['interior', slots]]
}

export function sceneCutDrawing(doc: DesignDocument, opts: CompileOptions = {}): CutDrawing {
  const byType = new Map<CutType, MultiPolygon[]>()
  const openByType = new Map<CutType, Ring[]>()
  const depths = new Map<CutType, number>()

  for (const object of doc.objects) {
    if (!object.visible) continue
    // Origin follows an open path with the bit centred on it and nothing else,
    // so it is a line cut whatever the object's own cut type says.
    const open = openPathRings(object)
    if (open.length) {
      const type: CutType = cutTypeOf(object) === 'guide' ? 'guide' : 'online'
      openByType.set(type, [...(openByType.get(type) ?? []), ...open])
    }
    const polygons = compileObject(object, opts)
    if (!polygons.length) continue
    for (const [type, contribution] of cutContributions(object, polygons)) {
      if (!contribution.length) continue
      const bucket = byType.get(type) ?? []
      bucket.push(contribution)
      byType.set(type, bucket)
    }
    // An MFT top's counterbores are pockets whatever the top's own cut type.
    const pockets = objectPockets(object)
    if (pockets) {
      byType.set('pocket', [...(byType.get('pocket') ?? []), pockets.polygons])
      depths.set('pocket', Math.max(depths.get('pocket') ?? 0, pockets.depthMm))
    }
    const type = cutTypeOf(object)
    if (type === 'pocket' && object.cut?.depthMm !== undefined) {
      // One depth per layer is what the format carries, so the deepest wins and
      // the page warns when objects disagree.
      depths.set(type, Math.max(depths.get(type) ?? 0, object.cut.depthMm))
    }
  }

  const layers: CutLayer[] = []
  for (const type of LAYER_ORDER) {
    const bucket = byType.get(type)
    const openPaths = openByType.get(type)
    if (!bucket?.length && !openPaths?.length) continue
    layers.push({
      id: LAYER_LABEL[type],
      cutType: type,
      polygons: bucket?.length ? union(...bucket) : [],
      ...(openPaths?.length ? { openPaths } : {}),
      ...(type === 'pocket' ? { depthMm: depths.get(type) ?? 3 } : {}),
      ...(THROUGH.has(type) ? { depthMm: materialThicknessMm(doc) } : {}),
    })
  }

  return {
    name: doc.name,
    layers,
    description: '1 unit = 1 mm, 1:1 scale. grey = pocket | black = interior | '
      + 'white+outline = exterior | blue = guide',
  }
}

/** Pocket depths that reach or pass the material thickness -- they would cut
 *  through, so the page warns rather than letting a counterbore become a hole. */
export function pocketsThroughMaterial(doc: DesignDocument): number[] {
  const t = materialThicknessMm(doc)
  const depths = new Set<number>()
  for (const o of doc.objects) {
    if (!o.visible) continue
    if (cutTypeOf(o) === 'pocket' && (o.cut?.depthMm ?? 3) >= t) depths.add(o.cut?.depthMm ?? 3)
    const pockets = objectPockets(o)
    if (pockets && pockets.depthMm >= t) depths.add(pockets.depthMm)
  }
  return [...depths].sort((a, b) => a - b)
}

/** Objects whose pocket depths disagree, so the page can say so rather than
 *  silently cutting them all to one depth. */
export function conflictingPocketDepths(doc: DesignDocument): number[] {
  const depths = new Set<number>()
  for (const o of doc.objects) {
    if (o.visible && cutTypeOf(o) === 'pocket') depths.add(o.cut?.depthMm ?? 3)
    const pockets = objectPockets(o)
    if (pockets) depths.add(pockets.depthMm)
  }
  return depths.size > 1 ? [...depths].sort((a, b) => a - b) : []
}
