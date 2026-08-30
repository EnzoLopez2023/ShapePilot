// The keycap tray's four cut layers, in the order the reference SVG emits them.
// This is the whole of what used to be TrayDesign-specific inside the exporters:
// the writers now take layers, and this adapter is what a tray looks like as
// layers. See src/export/shaperSvg.ts and src/export/dxf.ts.
import type { CutDrawing, CutLayer } from '../../../export/cutLayers.ts'
import type { Ring } from '../../../geometry/vec.ts'
import { buildRegions } from '../geometry/layers.ts'
import { pocketRing } from '../geometry/shapes.ts'
import type { TrayDesign } from '../model/types.ts'

const n = (v: number): string => {
  const s = v.toFixed(4)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

export interface TrayDrawingOptions {
  /** Glyph outlines per pocket, already positioned in model space. */
  labelPaths?: Map<string, Ring[]>
}

export function trayCutDrawing(design: TrayDesign, opts: TrayDrawingOptions = {}): CutDrawing {
  const { profile } = buildRegions(design)
  const blind = design.pockets.filter(p => !p.isThrough)
  const through = design.pockets.filter(p => p.isThrough)

  const layers: CutLayer[] = [
    { id: 'exterior-profile', cutType: 'exterior', polygons: profile },
    {
      id: 'pockets', cutType: 'pocket', depthMm: design.pocketDepthMm,
      polygons: blind.map(p => pocketRing(p, design.sizing)),
    },
    {
      id: 'finger-holes', cutType: 'interior',
      polygons: through.map(p => pocketRing(p, design.sizing)),
    },
  ]

  const guideRings: Ring[] = []
  for (const rings of opts.labelPaths?.values() ?? []) guideRings.push(...rings)

  return {
    name: design.name,
    layers,
    guideRings,
    description:
      `Keycap tray. 1 unit = 1 mm, 1:1 scale. grey = pocket ${n(design.pocketDepthMm)} mm` +
      ' | black = through | white+outline = profile | blue = guide',
  }
}
