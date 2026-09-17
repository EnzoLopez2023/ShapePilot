// Cutters for the metric hardware a printed part is usually screwed together
// with: clearance holes, countersinks, counterbores, heat-set insert pockets and
// nut traps.
//
// Each cutter is a hole group -- its pieces are solids unioned together, and
// the group as a whole is the hole -- so grouping it with a part subtracts the
// whole shape at once, the way a single Tinkercad hole does. It stands on the
// plate with its bottom at z = 0 and is as tall as the material it cuts, with
// half a millimetre past each face so no zero-thickness skin is left behind.
//
// Dimensions are the ISO nominal sizes plus print clearance: an FDM hole comes
// out a little under size, so every diameter here is already opened up.
import type { GroupObject, PathObject, SceneObject, SolidObject } from '../../model/document.ts'
import { IDENTITY_TRANSFORM, newId } from '../../model/scene.ts'
import type { Triple } from '../../model/document.ts'

export type MetricSize = 'M2' | 'M2.5' | 'M3' | 'M4' | 'M5'
export const METRIC_SIZES: readonly MetricSize[] = ['M2', 'M2.5', 'M3', 'M4', 'M5']

export type FastenerKind = 'clearance' | 'countersunk' | 'counterbored' | 'insert' | 'nut-trap'

interface SizeSpec {
  /** ISO 273 normal clearance hole, mm. */
  clearance: number
  /** ISO 10642 countersunk head, maximum diameter plus clearance; 90° included. */
  countersinkHead: number
  /** ISO 4762 socket head diameter plus clearance, and its height plus clearance. */
  counterboreHead: number
  counterboreDepth: number
  /** Common brass heat-set inserts: the hole the maker specifies, and its length plus 1 mm. */
  insertHole: number
  insertDepth: number
  /** ISO 4032 hex nut across flats plus clearance, and its thickness plus clearance. */
  nutFlats: number
  nutDepth: number
}

export const METRIC: Readonly<Record<MetricSize, SizeSpec>> = {
  'M2': { clearance: 2.4, countersinkHead: 4.2, counterboreHead: 4.3, counterboreDepth: 2.3, insertHole: 3.2, insertDepth: 5, nutFlats: 4.2, nutDepth: 1.9 },
  'M2.5': { clearance: 2.9, countersinkHead: 5.2, counterboreHead: 5.0, counterboreDepth: 2.8, insertHole: 3.6, insertDepth: 6, nutFlats: 5.2, nutDepth: 2.3 },
  'M3': { clearance: 3.4, countersinkHead: 6.9, counterboreHead: 6.0, counterboreDepth: 3.3, insertHole: 4.0, insertDepth: 7, nutFlats: 5.7, nutDepth: 2.7 },
  'M4': { clearance: 4.5, countersinkHead: 9.2, counterboreHead: 7.5, counterboreDepth: 4.3, insertHole: 5.6, insertDepth: 9, nutFlats: 7.2, nutDepth: 3.5 },
  'M5': { clearance: 5.5, countersinkHead: 11.4, counterboreHead: 9.0, counterboreDepth: 5.3, insertHole: 6.4, insertDepth: 10, nutFlats: 8.2, nutDepth: 4.3 },
}

export const FASTENER_LABELS: Readonly<Record<FastenerKind, string>> = {
  'clearance': 'Screw hole',
  'countersunk': 'Countersunk screw hole',
  'counterbored': 'Counterbored screw hole',
  'insert': 'Heat-set insert pocket',
  'nut-trap': 'Hex nut trap',
}

/** Past each face, so the cut never leaves a skin exactly on the surface. */
const OVERCUT = 0.5
const SEGMENTS = 48

const at = (z: number): Triple => [0, 0, z]

const cylinder = (name: string, diameter: number, bottom: number, top: number): SolidObject => ({
  id: newId(), name, type: 'solid', primitive: 'cylinder',
  params: { radiusMm: diameter / 2, heightMm: top - bottom, segments: SEGMENTS },
  transform: { ...IDENTITY_TRANSFORM, position: at(bottom) },
  mode: 'solid', visible: true, locked: false,
})

const cone = (name: string, bottomDiameter: number, topDiameter: number, bottom: number, top: number): SolidObject => ({
  id: newId(), name, type: 'solid', primitive: 'cone',
  params: { radiusMm: bottomDiameter / 2, topRadiusMm: topDiameter / 2, heightMm: top - bottom, segments: SEGMENTS },
  transform: { ...IDENTITY_TRANSFORM, position: at(bottom) },
  mode: 'solid', visible: true, locked: false,
})

/** A hexagon extruded straight up; 48-segment cylinders cannot be one. */
const hexPrism = (name: string, acrossFlats: number, bottom: number, top: number): PathObject => {
  const r = acrossFlats / Math.sqrt(3)
  const ring = Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i
    return [r * Math.cos(angle), r * Math.sin(angle)] as const
  })
  return {
    id: newId(), name, type: 'path', rings: [ring], thicknessMm: top - bottom,
    transform: { ...IDENTITY_TRANSFORM, position: at(bottom) },
    mode: 'solid', visible: true, locked: false,
  }
}

/**
 * One cutter, standing on the plate, for material `thicknessMm` thick. The
 * head recess, insert mouth or nut sits at the face named in its label: heads
 * and inserts open at the top, a nut trap at the bottom.
 */
export function createFastenerCutter(
  kind: FastenerKind, size: MetricSize, thicknessMm: number,
): GroupObject {
  const spec = METRIC[size]
  const top = thicknessMm + OVERCUT
  const floor = -OVERCUT
  // A recess can be no deeper than the material, or it is just a bigger hole.
  const recess = (depth: number) => Math.max(0, thicknessMm - depth)

  const children: SceneObject[] = (() => {
    switch (kind) {
      case 'clearance':
        return [cylinder('Shaft', spec.clearance, floor, top)]
      case 'countersunk': {
        // A 90° countersink is as deep as it is wide, halved.
        const depth = (spec.countersinkHead - spec.clearance) / 2
        const start = recess(depth)
        const widenedTop = spec.countersinkHead + 2 * OVERCUT
        return [
          cylinder('Shaft', spec.clearance, floor, start + 0.01),
          cone('Countersink', spec.clearance, widenedTop, start, top),
        ]
      }
      case 'counterbored':
        return [
          cylinder('Shaft', spec.clearance, floor, top),
          cylinder('Counterbore', spec.counterboreHead, recess(spec.counterboreDepth), top),
        ]
      case 'insert':
        return [cylinder('Insert pocket', spec.insertHole, recess(spec.insertDepth), top)]
      case 'nut-trap':
        return [
          cylinder('Shaft', spec.clearance, floor, top),
          hexPrism('Nut', spec.nutFlats, floor, Math.min(spec.nutDepth, thicknessMm)),
        ]
    }
  })()

  return {
    id: newId(),
    name: `${size} ${FASTENER_LABELS[kind].toLowerCase()}`,
    type: 'group',
    children,
    transform: IDENTITY_TRANSFORM,
    mode: 'hole',
    visible: true,
    locked: false,
  }
}

export const FASTENER_HINTS: Readonly<Record<FastenerKind, string>> = {
  'clearance': 'M2-M5, through',
  'countersunk': 'M2-M5, flat head at top',
  'counterbored': 'M2-M5, socket head at top',
  'insert': 'M2-M5 brass insert, from top',
  'nut-trap': 'M2-M5 hex nut, from bottom',
}
