// IKEA SKADIS pegboard geometry.
//
// The pattern is fixed by the hooks that hang in it, so none of these numbers
// are ours to choose: a 5 x 15 mm slot with fully rounded ends, slots every
// 40 mm across a row, rows every 20 mm, and every other row stepped half a
// column across. What makes a board *compatible* rather than merely
// pegboard-shaped is the margin -- the centre of an edge slot sits exactly
// 20 mm in from the edge, on all four sides.
//
// That margin is what forces the snapping below. Reading the rule off the
// drawing: the first and last slot of a row are at 20 and w - 20, spaced 40
// apart, so w - 40 must divide by 40; the first and last row are at 20 and
// h - 20, spaced 20 apart, so h - 40 must divide by 20.
import { roundedRectRing } from './primitives.ts'
import type { Ring } from './vec.ts'

export const SKADIS = {
  /** Slot opening, across. */
  slotWidthMm: 5,
  /** Slot opening, along -- including both rounded ends. */
  slotHeightMm: 15,
  /** Half the slot width, so the ends are true semicircles. */
  slotRadiusMm: 2.5,
  /** Board edge to the centre of the nearest slot. The compatibility rule. */
  edgeMarginMm: 20,
  /** Between slots within one row. */
  columnPitchMm: 40,
  /** Between rows. Alternate rows step half a column pitch across. */
  rowPitchMm: 20,
  /** Board corner. */
  cornerRadiusMm: 8,
} as const

/** The stock 36 x 56 cm board, sold as 14 1/4" x 22". */
export const SKADIS_DEFAULT_WIDTH_MM = 360
export const SKADIS_DEFAULT_HEIGHT_MM = 560

const CORNER_SEGS = 16
// r = 2.5 mm, so eight segments a quarter leaves ~0.012 mm of chord error --
// far below anything a router bit will notice, and 230 slots add up.
const SLOT_SEGS = 8

const snapTo = (mm: number, step: number, min: number): number =>
  Math.max(min, Math.round(mm / step) * step)

/** Nearest width that keeps an edge slot 20 mm from both the left and right. */
export const snapSkadisWidthMm = (mm: number): number =>
  snapTo(mm, SKADIS.columnPitchMm, SKADIS.columnPitchMm)

/** Nearest height that keeps an edge slot 20 mm from both the top and bottom. */
export const snapSkadisHeightMm = (mm: number): number =>
  snapTo(mm, SKADIS.rowPitchMm, 2 * SKADIS.rowPitchMm)

/** Slot centres for an already-snapped board, origin at its lower-left. */
export function skadisSlotCentres(widthMm: number, heightMm: number): [number, number][] {
  const { edgeMarginMm: m, columnPitchMm: cp, rowPitchMm: rp } = SKADIS
  const centres: [number, number][] = []
  const rows = Math.round((heightMm - 2 * m) / rp) + 1
  const lastX = widthMm - m
  for (let row = 0; row < rows; row++) {
    const y = m + row * rp
    // The stagger: odd rows start half a column in, which also means they hold
    // one slot fewer and sit 40 mm from the side edges rather than 20.
    const firstX = m + (row % 2) * (cp / 2)
    // +1e-6: lastX is built by repeated addition, so guard the final step.
    for (let x = firstX; x <= lastX + 1e-6; x += cp) centres.push([x, y])
  }
  return centres
}

/**
 * `[outline, ...slots]` -- one polygon's worth of rings, centred on the origin
 * like every other parametric shape. The caller must treat these as a single
 * polygon with holes; emitted as separate polygons the slots become islands and
 * a union fills them in.
 *
 * Sizes are snapped here rather than trusted, so geometry can never disagree
 * with the spec even if a stale document carries an off-grid number.
 */
export function skadisRings(widthMm: number, heightMm: number): Ring[] {
  const w = snapSkadisWidthMm(widthMm)
  const h = snapSkadisHeightMm(heightMm)
  const { slotWidthMm: sw, slotHeightMm: sh, slotRadiusMm: sr } = SKADIS

  const outline = roundedRectRing(-w / 2, -h / 2, w, h, SKADIS.cornerRadiusMm, CORNER_SEGS)
  const slots = skadisSlotCentres(w, h).map(([x, y]) =>
    roundedRectRing(x - w / 2 - sw / 2, y - h / 2 - sh / 2, sw, sh, sr, SLOT_SEGS))

  return [outline, ...slots]
}
