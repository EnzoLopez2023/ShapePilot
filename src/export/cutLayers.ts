// The interchange between a design and the two CNC writers. Both exporters used
// to take a TrayDesign directly; they now take layers, so the keycap tray and
// the Shaper Designer can share one proven writer each.
import type { MultiPolygon, Ring } from '../geometry/vec.ts'
import type { CutType } from '../model/document.ts'

export interface CutLayer {
  /** Stable, used as the SVG group id and for ordering. */
  id: string
  cutType: CutType
  polygons: MultiPolygon
  /** Open polylines, written without a closing segment. Line cuts and guides only. */
  openPaths?: Ring[]
  /** Cut depth in mm: a pocket's depth, or the material thickness on a
   *  through cut (exterior, interior). Written as `shaper:cutDepth`, which
   *  Origin offers as the cut's depth. Ignored on line cuts and guides. */
  depthMm?: number
}

export interface CutDrawing {
  name: string
  layers: CutLayer[]
  /** Extra outlines emitted on the guide layer -- engraved labels, mostly. */
  guideRings?: Ring[]
  /** Free text for the SVG <desc>; the DXF has nowhere to put it. */
  description?: string
}

export const nonEmptyLayers = (layers: readonly CutLayer[]): CutLayer[] =>
  layers.filter(l => l.polygons.some(p => p.length) || l.openPaths?.length)
