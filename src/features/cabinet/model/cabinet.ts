// A case of dadoed shelves for finished keycap trays.
//
// The trays are the given: each one is a flat panel of known width and depth
// that slides into a dado in each side, and the caps standing proud of it set
// how much air the tray above needs. So the whole case is derived from four
// numbers -- tray width, tray depth, dado height and the clear gap above it --
// and everything else here is arithmetic on those.
//
// Two conventions worth stating because the rest of the file assumes them:
//
//  * **Butt joints.** The sides run the full height and the top and bottom butt
//    between them, screwed through the sides. So the overall height is the
//    interior plus two thicknesses, and the top and bottom are as long as the
//    interior is wide.
//  * **Slot pitch, counted from the bottom.** Slot 0's floor *is* the top face
//    of the bottom panel: the lowest tray slides on the cabinet bottom and
//    needs no dado. Every slot above it gets one, so a 12-tray case is cut with
//    11 dados per side.

export interface CabinetParams {
  /** How many trays the case holds. */
  trayCount: number
  /** Tray width, across the case. The S76 keycap tray is 249 mm. */
  trayWidthMm: number
  /** Tray depth, into the case. Also the interior depth in front of the back. */
  trayDepthMm: number
  /** Tray panel thickness -- what the dado has to swallow. */
  trayThicknessMm: number
  /** Dado height. A little over the tray thickness so a tray never binds. */
  dadoHeightMm: number
  /** How deep each dado is let into the side, per side. */
  dadoDepthMm: number
  /** Clear side material between one dado and the next: the caps' headroom. */
  gapMm: number
  /** Sides, top and bottom. 1/2 in = 12.7 mm. */
  stockMm: number
  /** The back panel, housed in a rabbet. 1/4 in = 6.35 mm. */
  backMm: number
  /** Total side-to-side slop on a tray, so it slides without forcing. */
  slideClearanceMm: number
}

export const DEFAULT_CABINET: CabinetParams = {
  trayCount: 12,
  trayWidthMm: 249,
  trayDepthMm: 166,
  trayThicknessMm: 6.4,
  dadoHeightMm: 7,
  dadoDepthMm: 5,
  gapMm: 17,
  stockMm: 12.7,
  backMm: 6.35,
  slideClearanceMm: 1,
}

export interface CabinetDims {
  /** Dado floor to dado floor. */
  pitchMm: number
  /** Side inner face to side inner face. */
  interiorWidthMm: number
  /** Bottom's top face to the top's underside. */
  interiorHeightMm: number
  /** Back of the dado to back of the dado: what a tray spans. */
  dadoSpanMm: number
  /** How much of a tray's edge each dado holds. */
  engagementMm: number
  overallWidthMm: number
  overallHeightMm: number
  /** Sides, top and bottom: tray depth plus the back. */
  panelDepthMm: number
  /** Rabbet for the back, in all four case pieces: this far into the inner face
   *  and this far forward from the rear edge, so the back finishes flush. */
  backRabbetMm: number
  backWidthMm: number
  backHeightMm: number
  /** Dado floors, measured from the bottom end of a side panel, lowest first.
   *  One per slot above the bottom one, which rests on the cabinet floor. */
  dadoFloorsMm: number[]
  /** Clear air above a seated tray's top face, up to the next tray's underside. */
  headroomMm: number
}

export function cabinetDims(p: CabinetParams): CabinetDims {
  const pitchMm = p.dadoHeightMm + p.gapMm
  const interiorWidthMm = p.trayWidthMm + p.slideClearanceMm - 2 * p.dadoDepthMm
  const interiorHeightMm = p.trayCount * pitchMm
  const dadoFloorsMm = Array.from(
    { length: Math.max(0, p.trayCount - 1) }, (_, i) => p.stockMm + (i + 1) * pitchMm)
  // A tray rests on its dado floor, so the air above it is the rest of the dado
  // plus the solid gap to the next one.
  const headroomMm = pitchMm - p.trayThicknessMm
  return {
    pitchMm,
    interiorWidthMm,
    interiorHeightMm,
    dadoSpanMm: interiorWidthMm + 2 * p.dadoDepthMm,
    engagementMm: p.dadoDepthMm - p.slideClearanceMm / 2,
    overallWidthMm: interiorWidthMm + 2 * p.stockMm,
    overallHeightMm: interiorHeightMm + 2 * p.stockMm,
    panelDepthMm: p.trayDepthMm + p.backMm,
    backRabbetMm: p.backMm,
    backWidthMm: interiorWidthMm + 2 * p.backMm,
    backHeightMm: interiorHeightMm + 2 * p.backMm,
    dadoFloorsMm,
    headroomMm,
  }
}

export interface CutListRow {
  part: string
  count: number
  /** Long dimension × short dimension × thickness, mm. */
  lengthMm: number
  widthMm: number
  thicknessMm: number
  note: string
}

export function cutList(p: CabinetParams): CutListRow[] {
  const d = cabinetDims(p)
  return [
    {
      part: 'Side', count: 2,
      lengthMm: d.overallHeightMm, widthMm: d.panelDepthMm, thicknessMm: p.stockMm,
      note: `${d.dadoFloorsMm.length} dados ${p.dadoHeightMm} × ${p.dadoDepthMm} mm deep, ` +
        `plus the back rabbet`,
    },
    {
      part: 'Top / bottom', count: 2,
      lengthMm: d.interiorWidthMm, widthMm: d.panelDepthMm, thicknessMm: p.stockMm,
      note: 'butts between the sides; back rabbet along the rear edge',
    },
    {
      part: 'Back', count: 1,
      lengthMm: d.backHeightMm, widthMm: d.backWidthMm, thicknessMm: p.backMm,
      note: 'sits in the rabbets, flush with the rear edges',
    },
  ]
}

/** Where the screws go through a side into the top or bottom, along the depth. */
export function screwPositionsMm(p: CabinetParams, count = 3, insetMm = 30): number[] {
  const d = cabinetDims(p)
  // Clear of the back rabbet at one end and the front edge at the other.
  const first = insetMm
  const last = d.panelDepthMm - p.backMm - insetMm
  if (count < 2) return [(first + last) / 2]
  const step = (last - first) / (count - 1)
  return Array.from({ length: count }, (_, i) => first + i * step)
}

export interface CabinetWarning {
  code: string
  message: string
}

/** What would be wrong with the case as specified. Advice, never a refusal. */
export function checkCabinet(p: CabinetParams): CabinetWarning[] {
  const d = cabinetDims(p)
  const out: CabinetWarning[] = []
  if (p.dadoHeightMm < p.trayThicknessMm) {
    out.push({
      code: 'dado-too-shallow',
      message: `A ${p.dadoHeightMm} mm dado will not take a ${p.trayThicknessMm} mm tray.`,
    })
  }
  if (p.dadoDepthMm >= p.stockMm / 2) {
    out.push({
      code: 'dado-too-deep',
      message: `A ${p.dadoDepthMm} mm dado in ${p.stockMm} mm stock leaves only ` +
        `${+(p.stockMm - p.dadoDepthMm).toFixed(2)} mm of side. Keep it under half the thickness.`,
    })
  }
  if (p.gapMm < 1) {
    out.push({ code: 'gap-too-small', message: 'The gap between dados leaves no side material.' })
  }
  if (d.engagementMm < 2) {
    out.push({
      code: 'engagement-thin',
      message: `Each dado only holds ${+d.engagementMm.toFixed(2)} mm of the tray's edge.`,
    })
  }
  return out
}
