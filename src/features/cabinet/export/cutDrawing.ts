// The cabinet's panels as cut layers, for the shared Shaper SVG / DXF writers.
//
// One drawing per panel, because each is a separate piece of stock on the
// Shaper's spoilboard. Every panel is drawn flat with its inner face up -- the
// face the dados and the rabbet are cut into -- so the SVG is what the router
// sees. The side is drawn standing up: X is the case's depth, front edge at
// X = 0, and Y is the case's height from the bottom end.
//
// Pockets carry their own depth, so the dados (5 mm) and the back rabbet
// (6.35 mm) are separate layers even though both are pockets.
import type { CutDrawing, CutLayer } from '../../../export/cutLayers.ts'
import type { MultiPolygon, Ring } from '../../../geometry/vec.ts'
import { cabinetDims, screwPositionsMm } from '../model/cabinet.ts'
import type { CabinetParams } from '../model/cabinet.ts'

export type PanelId = 'side' | 'top-bottom' | 'back'

const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0], [x1, y0], [x1, y1], [x0, y1],
]

const circle = (cx: number, cy: number, r: number, steps = 32): Ring =>
  Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * Math.PI * 2
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const
  })

const n = (v: number): string => {
  const s = v.toFixed(2)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/** Screw pilot marks, on the guide layer: Shaper reads them as reference only. */
const screwMarks = (depths: readonly number[], y: number): Ring[] =>
  depths.map(x => circle(x, y, 2))

export function sideDrawing(p: CabinetParams): CutDrawing {
  const d = cabinetDims(p)
  const W = d.panelDepthMm
  const H = d.overallHeightMm
  const rabbetX = p.trayDepthMm // where the back rabbet starts, measured from the front

  const dados: MultiPolygon = d.dadoFloorsMm.map(y =>
    [rect(0, y, rabbetX, y + p.dadoHeightMm)])

  const layers: CutLayer[] = [
    { id: 'panel', cutType: 'exterior', polygons: [[rect(0, 0, W, H)]] },
    { id: 'tray-dados', cutType: 'pocket', depthMm: p.dadoDepthMm, polygons: dados },
    {
      id: 'back-rabbet', cutType: 'pocket', depthMm: d.backRabbetMm,
      polygons: [[rect(rabbetX, 0, W, H)]],
    },
  ]

  // Where the screws into the top and bottom land, mid-thickness from each end.
  const screws = screwPositionsMm(p)
  const guideRings: Ring[] = [
    ...screwMarks(screws, p.stockMm / 2),
    ...screwMarks(screws, H - p.stockMm / 2),
  ]

  return {
    name: `Cabinet side — ${p.trayCount} trays`,
    layers,
    guideRings,
    description:
      `Inner face up, front edge at left. 1 unit = 1 mm, 1:1. grey = pocket ` +
      `(dados ${n(p.dadoDepthMm)} mm, back rabbet ${n(d.backRabbetMm)} mm) | ` +
      `white+outline = panel ${n(W)} × ${n(H)} mm | blue = 4 mm screw marks, ` +
      `reference only -- Shaper does not cut guide lines.`,
  }
}

export function topBottomDrawing(p: CabinetParams): CutDrawing {
  const d = cabinetDims(p)
  const W = d.interiorWidthMm
  const H = d.panelDepthMm
  const layers: CutLayer[] = [
    { id: 'panel', cutType: 'exterior', polygons: [[rect(0, 0, W, H)]] },
    {
      id: 'back-rabbet', cutType: 'pocket', depthMm: d.backRabbetMm,
      polygons: [[rect(0, 0, W, d.backRabbetMm)]],
    },
  ]
  return {
    name: `Cabinet top / bottom — ${p.trayCount} trays`,
    layers,
    description:
      `Inner face up, rear edge at the bottom of the drawing. 1 unit = 1 mm, 1:1. ` +
      `grey = back rabbet ${n(d.backRabbetMm)} mm deep | white+outline = panel ` +
      `${n(W)} × ${n(H)} mm. Cut two.`,
  }
}

export function backDrawing(p: CabinetParams): CutDrawing {
  const d = cabinetDims(p)
  return {
    name: `Cabinet back — ${p.trayCount} trays`,
    layers: [{
      id: 'panel', cutType: 'exterior',
      polygons: [[rect(0, 0, d.backWidthMm, d.backHeightMm)]],
    }],
    description:
      `${n(d.backWidthMm)} × ${n(d.backHeightMm)} mm from ${n(p.backMm)} mm stock. ` +
      `1 unit = 1 mm, 1:1.`,
  }
}

export const PANEL_DRAWINGS: Record<PanelId, (p: CabinetParams) => CutDrawing> = {
  side: sideDrawing,
  'top-bottom': topBottomDrawing,
  back: backDrawing,
}

export const PANEL_LABELS: Record<PanelId, string> = {
  side: 'Side (×2)',
  'top-bottom': 'Top / bottom (×2)',
  back: 'Back (×1)',
}
