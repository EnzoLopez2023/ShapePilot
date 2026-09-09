// Finding somewhere solid for a square post to stand.
//
// Both tray designers put posts under or on a tray -- the keycap tray's corner
// spacers, the switch tray's feet -- and both hit the same problem: a fixed
// inset from the bounding box lands in thin air. The Systainer notched preset
// chamfers all four corners, so a post seated 2 mm in from the bbox corner sits
// entirely in the notch and the tray reports "0/4 posts fit".
//
// The fix, arrived at once and then written twice, is to walk inward in small
// steps until the footprint sits wholly on solid material. This is that walk,
// once.
//
// Two things are deliberately left to the caller. The **region** is an
// argument, not a flag: the keycap tray searches against its rim (the profile
// after pockets are cut, so a post never overhangs a pocket) while the switch
// tray searches the bare outline (feet are placed before any cell exists, and
// the fill then treats their footprints as occupied). And the **seats** are
// closures, so "corner" and "middle of an edge" are the same kind of thing --
// a function from inset to origin.
import type { BBox, MultiPolygon, Polygon, Vec2 } from './vec.ts'
import { multiArea, translateRing } from './vec.ts'
import { difference } from './boolean.ts'
import { rectRing } from './primitives.ts'

/** Where a seat's lower-left corner sits for a given inset from the bbox. */
export type Seat = (inset: number) => Vec2

export interface SeatSearchOptions {
  /** Gap from the tray's outer edge to a post before the search starts. */
  insetMm?: number
  stepMm?: number
  /** Give up past this. A seat that never finds material is dropped, and each
   *  feature's validator says so rather than silently shipping three posts. */
  maxMm?: number
}

const DEFAULTS = { insetMm: 2, stepMm: 1, maxMm: 40 }

/** Does this footprint sit wholly on solid material? */
export const fitsOn = (rect: Polygon, region: MultiPolygon): boolean =>
  multiArea(difference([rect], region)) < 1e-6

/**
 * The first of several candidate seats that fits, or null if none does.
 *
 * Candidates are tried in order and each walks inward on its own, so "slide
 * along this edge looking for somewhere clear" is a list of candidates rather
 * than a special case in here.
 */
export function firstSeat(
  region: MultiPolygon,
  sizeMm: number,
  candidates: readonly Seat[],
  options: SeatSearchOptions = {},
): Polygon | null {
  const { insetMm, stepMm, maxMm } = { ...DEFAULTS, ...options }
  if (sizeMm <= 0) return null

  for (const seat of candidates) {
    for (let inset = insetMm; inset <= maxMm; inset += stepMm) {
      const [x, y] = seat(inset)
      const rect: Polygon = [translateRing(rectRing(sizeMm, sizeMm), x, y)]
      if (fitsOn(rect, region)) return rect
    }
  }
  return null
}

/**
 * The seat footprints that fit, in the order the seats were given. A seat that
 * finds nothing solid within `maxMm` contributes nothing, so the result can be
 * shorter than `seats` -- that shortfall is what a "2/4 posts fit" readout is
 * counting.
 */
export function findSeats(
  region: MultiPolygon,
  sizeMm: number,
  seats: readonly Seat[],
  options: SeatSearchOptions = {},
): Polygon[] {
  const rects: Polygon[] = []
  for (const seat of seats) {
    const rect = firstSeat(region, sizeMm, [seat], options)
    if (rect) rects.push(rect)
  }
  return rects
}

/** The four corners, each searching diagonally inward. */
export const cornerSeats = (bb: BBox, sizeMm: number): Seat[] => [
  inset => [bb.minX + inset, bb.minY + inset],
  inset => [bb.maxX - inset - sizeMm, bb.minY + inset],
  inset => [bb.maxX - inset - sizeMm, bb.maxY - inset - sizeMm],
  inset => [bb.minX + inset, bb.maxY - inset - sizeMm],
]

/**
 * The middle of each of the four sides, searching straight in. Held at the
 * midpoint on the axis it is not walking along, so an edge post stays centred
 * on its side however far in it has to go.
 */
export const edgeMidSeats = (bb: BBox, sizeMm: number): Seat[] => {
  const midX = (bb.minX + bb.maxX) / 2 - sizeMm / 2
  const midY = (bb.minY + bb.maxY) / 2 - sizeMm / 2
  return [
    inset => [midX, bb.minY + inset],
    inset => [midX, bb.maxY - inset - sizeMm],
    inset => [bb.minX + inset, midY],
    inset => [bb.maxX - inset - sizeMm, midY],
  ]
}
