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
//  * **Slot pitch, counted from the bottom.** Every tray rides in a dado of its
//    own, the lowest included, so a 12-tray case is cut with 12 dados per side.
//    The lowest dado sits one gap above the bottom panel, which leaves the same
//    solid side under it as between any two dados, and the top gap above the
//    highest tray matches. So the interior is one gap taller than the slots.
//
// Optionally the case hangs on a **French cleat**. The back then moves forward
// by the cleat's thickness -- its rabbet becomes a groove -- and the sides, top
// and bottom grow by the same amount, so a hidden pocket opens behind the back.
// The case half of a strip ripped at 45 degrees is fixed in the top of that
// pocket, a square spacer of the same stock in the bottom keeps the case plumb,
// and the wall half sits in the pocket below the case half. Put back together
// the two halves are the original strip, so the pocket only has to be one
// cleat thick and the case hangs flush to the wall.

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
  /** Hang the case on a French cleat hidden behind the back. */
  frenchCleat: boolean
  /** Cleat stock thickness -- also how far the back is set forward. */
  cleatThicknessMm: number
  /** Each cleat's long face, after the 45 degree rip. */
  cleatHeightMm: number
}

/** Every cleat is ripped at 45 degrees, so the bevel drops one thickness. */
export const CLEAT_ANGLE_DEG = 45

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
  frenchCleat: false,
  cleatThicknessMm: 12.7,
  cleatHeightMm: 50.8,
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
  /** Sides, top and bottom: tray depth plus the back, plus the cleat if any. */
  panelDepthMm: number
  /** Rabbet for the back, in all four case pieces: this far into the inner face
   *  and this wide, so the back finishes flush. With a cleat it is a groove. */
  backRabbetMm: number
  /** Rear edge to the back's rear face: 0 for a rabbet, the cleat thickness
   *  for a groove. */
  backInsetMm: number
  backWidthMm: number
  backHeightMm: number
  /** Dado floors, measured from the bottom end of a side panel, lowest first.
   *  One per slot above the bottom one, which rests on the cabinet floor. */
  dadoFloorsMm: number[]
  /** Clear air above a seated tray's top face, up to the next tray's underside. */
  headroomMm: number
  /** The French cleat, when there is one. */
  cleat: CleatDims | null
}

/**
 * The pocket behind the back, in the side's own frame: depth back from the
 * front edge, height up from the bottom end of the case. Profiles are closed
 * rings, counter-clockwise in (depth, height).
 */
export interface CleatDims {
  /** Both cleats and the spacer fit between the sides. */
  lengthMm: number
  /** The case half: long face to the wall, bevel underneath, its top against
   *  the underside of the top panel. */
  caseProfile: [number, number][]
  /** The wall half, seated: long face against the back, bevel on top. */
  wallProfile: [number, number][]
  /** The square spacer at the bottom of the pocket. */
  spacerProfile: [number, number][]
  spacerHeightMm: number
  /** From the very top of the case down to the wall cleat's high edge: mark the
   *  case top on the wall, and the wall cleat goes this far below it. */
  wallCleatDropMm: number
  /** Air between the seated wall cleat and the spacer. The case has to lift at
   *  least one cleat thickness to hook on and off. */
  liftClearanceMm: number
}

export function cabinetDims(p: CabinetParams): CabinetDims {
  const pitchMm = p.dadoHeightMm + p.gapMm
  const interiorWidthMm = p.trayWidthMm + p.slideClearanceMm - 2 * p.dadoDepthMm
  // One gap of solid side below the lowest dado, and the same above the highest.
  const interiorHeightMm = p.trayCount * pitchMm + p.gapMm
  const dadoFloorsMm = Array.from(
    { length: p.trayCount }, (_, i) => p.stockMm + p.gapMm + i * pitchMm)
  // A tray rests on its dado floor, so the air above it is the rest of the dado
  // plus the solid gap to the next one.
  const headroomMm = pitchMm - p.trayThicknessMm
  const backInsetMm = p.frenchCleat ? p.cleatThicknessMm : 0
  const panelDepthMm = p.trayDepthMm + p.backMm + backInsetMm
  const overallHeightMm = interiorHeightMm + 2 * p.stockMm
  return {
    pitchMm,
    interiorWidthMm,
    interiorHeightMm,
    dadoSpanMm: interiorWidthMm + 2 * p.dadoDepthMm,
    engagementMm: p.dadoDepthMm - p.slideClearanceMm / 2,
    overallWidthMm: interiorWidthMm + 2 * p.stockMm,
    overallHeightMm,
    panelDepthMm,
    backRabbetMm: p.backMm,
    backInsetMm,
    backWidthMm: interiorWidthMm + 2 * p.backMm,
    backHeightMm: interiorHeightMm + 2 * p.backMm,
    dadoFloorsMm,
    headroomMm,
    cleat: p.frenchCleat
      ? cleatDims(p, interiorWidthMm, interiorHeightMm, panelDepthMm, overallHeightMm)
      : null,
  }
}

function cleatDims(
  p: CabinetParams, lengthMm: number, interiorHeightMm: number,
  panelDepthMm: number, overallHeightMm: number,
): CleatDims {
  const t = p.cleatThicknessMm
  const h = p.cleatHeightMm
  const wall = panelDepthMm // the rear edge is where the wall is
  const face = wall - t // the back's rear face
  const top = overallHeightMm - p.stockMm // underside of the top panel
  const floor = p.stockMm // top face of the bottom panel
  const spacerHeightMm = h / 2
  // At 45 degrees the bevel drops one thickness across the cleat, so each half's
  // long face is h and its short face h - t. The wall half is the same piece
  // turned over, and seated the two are the strip again: 2h - t tall.
  const caseLow = top - h
  const wallLow = caseLow - h + t
  return {
    lengthMm,
    caseProfile: [[face, caseLow + t], [wall, caseLow], [wall, top], [face, top]],
    wallProfile: [[face, wallLow], [wall, wallLow], [wall, caseLow], [face, caseLow + t]],
    spacerProfile: [
      [face, floor], [wall, floor], [wall, floor + spacerHeightMm], [face, floor + spacerHeightMm],
    ],
    spacerHeightMm,
    wallCleatDropMm: p.stockMm + h - t,
    liftClearanceMm: interiorHeightMm - (2 * h - t) - spacerHeightMm,
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
  const rows: CutListRow[] = [
    {
      part: 'Side', count: 2,
      lengthMm: d.overallHeightMm, widthMm: d.panelDepthMm, thicknessMm: p.stockMm,
      note: `${d.dadoFloorsMm.length} dados ${p.dadoHeightMm} × ${p.dadoDepthMm} mm deep, ` +
        `plus the back ${d.cleat ? 'groove' : 'rabbet'}`,
    },
    {
      part: 'Top / bottom', count: 2,
      lengthMm: d.interiorWidthMm, widthMm: d.panelDepthMm, thicknessMm: p.stockMm,
      note: d.cleat
        ? `butts between the sides; back groove ${p.cleatThicknessMm} mm in from the rear edge`
        : 'butts between the sides; back rabbet along the rear edge',
    },
    {
      part: 'Back', count: 1,
      lengthMm: d.backHeightMm, widthMm: d.backWidthMm, thicknessMm: p.backMm,
      note: d.cleat
        ? 'captured in the grooves, so it goes in as the case goes together'
        : 'sits in the rabbets, flush with the rear edges',
    },
  ]
  if (d.cleat) {
    rows.push(
      {
        part: 'French cleat', count: 2,
        lengthMm: d.cleat.lengthMm, widthMm: p.cleatHeightMm, thicknessMm: p.cleatThicknessMm,
        note: `rip a ${+(2 * p.cleatHeightMm - p.cleatThicknessMm).toFixed(2)} mm strip (plus kerf) ` +
          `at ${CLEAT_ANGLE_DEG}°: one half under the top behind the back, one on the wall`,
      },
      {
        part: 'Cleat spacer', count: 1,
        lengthMm: d.cleat.lengthMm, widthMm: d.cleat.spacerHeightMm, thicknessMm: p.cleatThicknessMm,
        note: 'square edges, on the bottom behind the back, so the case hangs plumb',
      },
    )
  }
  return rows
}

/** Where the screws go through a side into the top or bottom, along the depth. */
export function screwPositionsMm(p: CabinetParams, count = 3, insetMm = 30): number[] {
  const d = cabinetDims(p)
  // Clear of the back rabbet at one end and the front edge at the other.
  const first = insetMm
  const last = d.panelDepthMm - d.backInsetMm - p.backMm - insetMm
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
  if (d.cleat) {
    if (p.cleatHeightMm < 2 * p.cleatThicknessMm) {
      out.push({
        code: 'cleat-too-narrow',
        message: `A ${p.cleatHeightMm} mm cleat in ${p.cleatThicknessMm} mm stock leaves a ` +
          `${+(p.cleatHeightMm - p.cleatThicknessMm).toFixed(2)} mm short face after the bevel. ` +
          'Make it at least twice the thickness.',
      })
    }
    if (d.cleat.liftClearanceMm < p.cleatThicknessMm) {
      out.push({
        code: 'cleat-no-lift',
        message: 'There is not enough room behind the back for the case to lift over the wall ' +
          'cleat. Use narrower cleats, or more trays.',
      })
    }
  }
  return out
}
