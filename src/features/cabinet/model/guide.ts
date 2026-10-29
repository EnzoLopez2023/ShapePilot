// The rough cut list and the build guide for a cabinet.
//
// The Origin cuts every panel to its finished outline, but it can only do that
// from a blank that is already bigger than the panel and small enough to place
// in the work area. So this is the other half of `cutList`: the size to saw
// each blank to beforehand, how to break the sheet down into those blanks, and
// the order to build in. Parts the Origin never sees (the cleat strip and its
// spacer) are sawn straight to size.
import { CLEAT_ANGLE_DEG, cabinetDims, cutList, screwPositionsMm } from './cabinet.ts'
import type { CabinetParams } from './cabinet.ts'

/** Total allowance on a blank, over the finished length and over the width. */
export const DEFAULT_ROUGH_MARGIN_MM = 20
/** Blanks are sawn to a round number; this is the step they round up to. */
export const ROUGH_STEP_MM = 5
/** A standard 4 × 8 sheet and the kerf of the saw that breaks it down. */
export const SHEET_MM = { lengthMm: 2440, widthMm: 1220 }
export const SAW_KERF_MM = 3.2

export type Machine = 'origin' | 'saw'

export interface RoughRow {
  part: string
  count: number
  machine: Machine
  /** The size the Origin cuts this part to. */
  finishedLengthMm: number
  finishedWidthMm: number
  /** The blank to saw, long dimension first. Equal to finished for saw parts. */
  roughLengthMm: number
  roughWidthMm: number
  thicknessMm: number
}

const roundUp = (mm: number, step: number): number => Math.ceil(mm / step - 1e-9) * step

export function roughCutList(p: CabinetParams, marginMm = DEFAULT_ROUGH_MARGIN_MM): RoughRow[] {
  return cutList(p).map(r => {
    const machine: Machine = r.part === 'French cleat' || r.part === 'Cleat spacer' ? 'saw' : 'origin'
    // Both cleats come out of one strip ripped at 45 degrees, so the strip is
    // what gets sawn: two long faces less one thickness, plus the blade's kerf.
    const stripWidth = r.part === 'French cleat'
      ? 2 * p.cleatHeightMm - p.cleatThicknessMm + SAW_KERF_MM
      : r.widthMm
    return {
      part: r.part === 'French cleat' ? 'French cleat strip' : r.part,
      count: r.part === 'French cleat' ? 1 : r.count,
      machine,
      finishedLengthMm: r.lengthMm,
      finishedWidthMm: r.widthMm,
      roughLengthMm: machine === 'origin' ? roundUp(r.lengthMm + marginMm, ROUGH_STEP_MM) : r.lengthMm,
      roughWidthMm: machine === 'origin' ? roundUp(r.widthMm + marginMm, ROUGH_STEP_MM) : stripWidth,
      thicknessMm: r.thicknessMm,
    }
  })
}

export interface CrosscutSetting { lengthMm: number; qty: number; parts: string[] }
export interface RipSetting { widthMm: number; strips: number; crosscuts: CrosscutSetting[] }
export interface ThicknessOrder {
  thicknessMm: number
  rips: RipSetting[]
  /** Sheets of this thickness, breaking every strip out of a full sheet. */
  sheets: number
}

const same = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6

/** Strips of `stripMm` that these lengths come out of, longest first, first fit. */
function stripsNeeded(lengths: number[], stripMm: number): number {
  const used: number[] = []
  for (const length of [...lengths].sort((a, b) => b - a)) {
    const room = used.findIndex(u => u + SAW_KERF_MM + length <= stripMm + 1e-9)
    if (room >= 0) used[room] += SAW_KERF_MM + length
    else used.push(length)
  }
  return used.length
}

/** Sheets that these strip widths rip out of, first fit across the sheet. */
function sheetsFor(stripWidths: number[]): number {
  const used: number[] = []
  for (const w of [...stripWidths].sort((a, b) => b - a)) {
    const room = used.findIndex(u => u + SAW_KERF_MM + w <= SHEET_MM.widthMm + 1e-9)
    if (room >= 0) used[room] += SAW_KERF_MM + w
    else used.push(w)
  }
  return used.length
}

/** Saw setups per thickness: one fence setting at a time, then the stop-block cuts. */
export function cuttingOrder(rows: RoughRow[]): ThicknessOrder[] {
  const thicknesses: number[] = []
  for (const r of rows) if (!thicknesses.some(t => same(t, r.thicknessMm))) thicknesses.push(r.thicknessMm)
  return thicknesses.sort((a, b) => b - a).map(thicknessMm => {
    const ofThickness = rows.filter(r => same(r.thicknessMm, thicknessMm))
    const widths: number[] = []
    for (const r of ofThickness) if (!widths.some(w => same(w, r.roughWidthMm))) widths.push(r.roughWidthMm)
    const rips = widths.sort((a, b) => b - a).map(widthMm => {
      const atWidth = ofThickness.filter(r => same(r.roughWidthMm, widthMm))
      const crosscuts: CrosscutSetting[] = []
      for (const r of atWidth) {
        const c = crosscuts.find(x => same(x.lengthMm, r.roughLengthMm))
        if (c) { c.qty += r.count; c.parts.push(r.part) }
        else crosscuts.push({ lengthMm: r.roughLengthMm, qty: r.count, parts: [r.part] })
      }
      crosscuts.sort((a, b) => b.lengthMm - a.lengthMm)
      const lengths = atWidth.flatMap(r => Array.from({ length: r.count }, () => r.roughLengthMm))
      return { widthMm, strips: stripsNeeded(lengths, SHEET_MM.lengthMm), crosscuts }
    })
    const stripWidths = rips.flatMap(r => Array.from({ length: r.strips }, () => r.widthMm))
    return { thicknessMm, rips, sheets: sheetsFor(stripWidths) }
  })
}

export interface GuideStep {
  id: string
  title: string
  summary: string
  instructions: string[]
  cautions: string[]
}

export interface BuildGuide {
  steps: GuideStep[]
  hardware: { item: string; qty: string }[]
}

/**
 * The build, in order. `f` formats a length in the user's units so the text
 * matches the rest of the page.
 */
export function buildGuide(
  p: CabinetParams, marginMm: number, f: (mm: number) => string,
): BuildGuide {
  const d = cabinetDims(p)
  const rows = roughCutList(p, marginMm)
  const order = cuttingOrder(rows)
  const screws = screwPositionsMm(p)
  const back = d.cleat ? 'groove' : 'rabbet'

  const steps: GuideStep[] = []

  steps.push({
    id: 'breakdown',
    title: 'Break down the plywood',
    summary: `Saw the blanks the Origin will cut the panels from. Each is ${f(marginMm)} bigger than its panel, rounded up to ${f(ROUGH_STEP_MM)}.`,
    instructions: order.flatMap(g => g.rips.flatMap(rip => [
      `${f(g.thicknessMm)} stock: set the rip fence to ${f(rip.widthMm)} and rip ${rip.strips} strip${rip.strips === 1 ? '' : 's'}.`,
      ...rip.crosscuts.map(c =>
        `Set the stop to ${f(c.lengthMm)} and cut ${c.qty} (${c.parts.join(', ')}).`),
    ])),
    cautions: [
      'Rip widest first, so the offcuts can still give the narrower strips.',
      'Leave the blanks a little big rather than trimming them to fit: the Origin cuts the real outline.',
    ],
  })

  if (d.cleat) {
    steps.push({
      id: 'cleat',
      title: 'Rip the French cleats',
      summary: 'Both cleats and the spacer come from the same stock and are sawn, not routed.',
      instructions: [
        `Take the ${f(rows.find(r => r.part === 'French cleat strip')!.roughWidthMm)} wide strip, ${f(d.cleat.lengthMm)} long.`,
        `Tilt the blade to ${CLEAT_ANGLE_DEG}° and rip down the middle, leaving two halves with a long face of ${f(p.cleatHeightMm)}.`,
        `Cut the spacer ${f(d.cleat.spacerHeightMm)} wide and ${f(d.cleat.lengthMm)} long from the same stock, square on all edges.`,
      ],
      cautions: ['Keep the two halves together: seated back to back they are the original strip.'],
    })
  }

  steps.push({
    id: 'sides',
    title: 'Cut the sides on the Origin',
    summary: `Two sides, ${f(d.overallHeightMm)} × ${f(d.panelDepthMm)}, with ${d.dadoFloorsMm.length} dados and the back ${back}.`,
    instructions: [
      'Lay Shaper Tape across the blank, inner face up, and scan it in.',
      `Load the Side SVG and place it on the scan: front edge to the left, ${f(d.panelDepthMm)} deep.`,
      `Cut the ${d.dadoFloorsMm.length} dados ${f(p.dadoHeightMm)} wide and ${f(p.dadoDepthMm)} deep, then the back ${back} ${f(d.backRabbetMm)} deep, then the outline.`,
      'Cut the second side from the same file: both are cut inner face up, so they come out as a mirrored pair.',
    ],
    cautions: [
      `Test one dado with a spare tray: it should slide with about ${f(p.slideClearanceMm)} of total play.`,
      'Set the depth for each pocket layer before cutting. Dados and the back are different depths.',
    ],
  })

  steps.push({
    id: 'top-bottom',
    title: 'Cut the top and bottom',
    summary: `Two panels, ${f(d.interiorWidthMm)} × ${f(d.panelDepthMm)}, each with a back ${back} along the rear.`,
    instructions: [
      `Tape the blank, inner face up, and load the Top / bottom SVG with the rear edge toward you.`,
      `Cut the ${back} ${f(d.backRabbetMm)} deep${d.backInsetMm > 0 ? `, ${f(d.backInsetMm)} in from the rear edge` : ''}, then the outline.`,
      'Repeat for the second panel.',
    ],
    cautions: [],
  })

  steps.push({
    id: 'back',
    title: 'Cut the back',
    summary: `One panel, ${f(d.backWidthMm)} × ${f(d.backHeightMm)}, from ${f(p.backMm)} stock.`,
    instructions: [
      'Tape the blank and load the Back SVG. It is a plain outline cut.',
    ],
    cautions: [],
  })

  steps.push({
    id: 'dry-fit',
    title: 'Dry fit',
    summary: 'Check everything before any glue.',
    instructions: [
      'Stand the sides up and seat the top and bottom between them.',
      `Slide a tray into the lowest and the highest dado: each should be held ${f(d.engagementMm)} on each edge.`,
      `Slide the back into the ${back}s from the rear.`,
    ],
    cautions: ['If a tray binds, ease the dado with a sanding block now. It is a lot harder with glue in the joints.'],
  })

  steps.push({
    id: 'assemble',
    title: 'Glue and screw the case',
    summary: `Sides to top and bottom, with the back captured in the ${back}s.`,
    instructions: [
      `Glue the ends of the top and bottom, and set them between the sides, with the back ${back}s facing the rear.`,
      `Drive screws through each side into the top and bottom at ${screws.map(f).join(', ')} from the front edge, ${f(p.stockMm / 2)} in from each end: ${screws.length * 4} in all.`,
      d.cleat
        ? 'Slide the back into the grooves before the last joint closes. It cannot go in afterwards.'
        : 'Slide the back into the rabbets and fix it with glue or brads.',
      'Check the case for square by measuring the diagonals: they should match.',
    ],
    cautions: ['Wipe squeeze-out from the dados straight away: trays will not slide past dried glue.'],
  })

  if (d.cleat) {
    steps.push({
      id: 'cleat-fit',
      title: 'Fit the cleats and hang the case',
      summary: 'The case half goes in the pocket behind the back; the wall half goes on the wall.',
      instructions: [
        'Fix the case half under the top panel, behind the back, with its long face toward the wall and the bevel below.',
        'Fix the spacer on the bottom panel behind the back, so the case hangs plumb.',
        `Mark where the top of the case will be on the wall, then fix the wall half with its high edge ${f(d.cleat.wallCleatDropMm)} below that mark, bevel up, into studs.`,
        'Lift the case over the wall cleat and let it settle.',
      ],
      cautions: [`The case has to lift ${f(p.cleatThicknessMm)} to hook on and off: there is ${f(d.cleat.liftClearanceMm)} of clearance.`],
    })
  }

  const hardware = [
    { item: `Screws, through each side into the top and bottom`, qty: String(screws.length * 4) },
    { item: 'Wood glue', qty: '1 bottle' },
    ...(d.cleat ? [{ item: 'Screws, wall cleat into studs', qty: '2 per stud' }] : []),
  ]
  return { steps, hardware }
}
