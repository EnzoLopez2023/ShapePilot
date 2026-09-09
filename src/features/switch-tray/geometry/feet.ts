// Where the posts under the plate can actually stand.
//
// Corner posts are placed against the *outline alone*, before any cell exists,
// and the fill then treats their footprints as occupied. Simple, and it costs
// nothing: on every outline shipped, the four corners already sit outside the
// lattice's reach.
//
// EDGE POSTS ARE DIFFERENT, and are the reason this file knows about the fill.
// Seated at the middle of each side they landed in the middle of the cell
// field, and each one cost a switch -- 112 down to 108 on the notched S 76.
// There is nowhere on the two SHORT edges for a post that does not cost a cell,
// so the four extra posts go two-per-LONG-edge instead, seeded at a third and
// two thirds of the width and sliding along until they find material the
// lattice did not claim. On the notched outline that puts them in the pockets
// beside the edge notches, which the cells cannot use anyway.
//
// That means the ordering is: corners -> fill -> edge posts -> fill again. The
// second fill is the authoritative one. It is not iterated: the edge posts are
// seated once, against the first pass, and if one had to fall back onto a cell
// the second pass simply drops that cell.
//
// What edge posts do NOT avoid is the nameplate. The name is an inlay in the
// plate's TOP face and the posts weld to its underside -- they never meet in z,
// so a post under the name is fine. The name is still a blocker for the *fill*,
// because a cell is a hole and the letters need solid plate behind them.
import type { MultiPolygon, Polygon } from '../../../geometry/vec.ts'
import { multiBBox } from '../../../geometry/vec.ts'
import { difference } from '../../../geometry/boolean.ts'
import { cornerSeats, findSeats, firstSeat, type Seat } from '../../../geometry/seats.ts'
import { profileToMulti } from '../../../model/trayProfile.ts'
import { cellKeepoutMm, feetHeightMm } from '../model/defaults.ts'
import type { FeetSettings, SwitchTrayDesign, TrayProfile } from '../model/types.ts'
import { cellRects, fillRequestFor, planFill } from './fill.ts'

/** How far a post dips up into the plate, so a slicer welds the two solids. */
export const FOOT_WELD_MM = 0.05

/** Where along a long edge each of its two posts starts looking. */
const EDGE_FRACTIONS = [1 / 3, 2 / 3] as const

/** How far a post may slide from its seed. A sixth of the width keeps the two
 *  posts on an edge inside their own halves, so they cannot meet. */
const SLIDE_FRACTION = 1 / 6

/** Step along the edge while sliding. Finer than this buys nothing visible. */
const SLIDE_STEP_MM = 1

/**
 * The four corner posts. Each searches diagonally inward from its bounding-box
 * corner until it finds solid material -- the notched preset chamfers all four,
 * so a fixed inset lands in the chamfer. Search is in `src/geometry/seats.ts`.
 */
export function cornerRects(profile: TrayProfile, feet: FeetSettings | undefined): Polygon[] {
  if (!feet || feetHeightMm(feet) <= 0 || feet.sizeMm <= 0) return []
  const region = profileToMulti(profile)
  return findSeats(region, feet.sizeMm, cornerSeats(multiBBox(region), feet.sizeMm))
}

/**
 * Candidate seats for one edge post: the seed first, then alternating outward
 * along the edge. Each candidate still walks inward on its own.
 */
function slidingSeats(
  region: MultiPolygon, sizeMm: number, edge: 'bottom' | 'top', fraction: number,
): Seat[] {
  const bb = multiBBox(region)
  const width = bb.maxX - bb.minX
  const seedX = bb.minX + fraction * width - sizeMm / 2
  const at = (t: number): Seat => edge === 'bottom'
    ? inset => [seedX + t, bb.minY + inset]
    : inset => [seedX + t, bb.maxY - inset - sizeMm]

  const seats: Seat[] = [at(0)]
  for (let t = SLIDE_STEP_MM; t <= width * SLIDE_FRACTION; t += SLIDE_STEP_MM) {
    seats.push(at(-t), at(t))
  }
  return seats
}

/**
 * The two posts on each long edge, preferring material no cell claimed.
 *
 * `free` is the outline with the cells (and the corner posts) taken out of it.
 * A post that finds nothing there falls back to `region`, so the post still
 * exists and the count still reads 8/8 -- the fill's second pass then drops
 * whichever cell it landed on, exactly as it always did.
 */
function edgeRects(region: MultiPolygon, free: MultiPolygon, sizeMm: number): Polygon[] {
  const out: Polygon[] = []
  for (const edge of ['bottom', 'top'] as const) {
    for (const fraction of EDGE_FRACTIONS) {
      const seats = slidingSeats(region, sizeMm, edge, fraction)
      const rect = firstSeat(free, sizeMm, seats) ?? firstSeat(region, sizeMm, seats)
      if (rect) out.push(rect)
    }
  }
  return out
}

/**
 * Every post footprint for a design.
 *
 * `reserved` is anything else the FILL has to keep off -- in practice the
 * nameplate box. It is passed through to the first fill pass so that pass sees
 * the same lattice the final one will, but it is deliberately not something the
 * posts themselves avoid; see the note at the top of this file.
 *
 * Deterministic in its arguments, so the canvas, the mesher and the validator
 * all get the same answer without having to agree on an order of operations.
 */
export function seatFeet(
  design: SwitchTrayDesign, reserved: readonly Polygon[] = [],
): Polygon[] {
  const feet = design.feet
  if (!feet || feetHeightMm(feet) <= 0 || feet.sizeMm <= 0) return []

  const corners = cornerRects(design.profile, feet)
  if (feet.pattern !== 'corners+edges') return corners

  const region = profileToMulti(design.profile)
  const first = planFill(fillRequestFor(design, [...corners, ...reserved]))
  // Grown by the fill's own margin, because a cell needs that much clear
  // material around its keep-out to be planned at all. A post merely touching
  // the margin invalidates the cell just as surely as sitting on it -- which is
  // what left one switch on the floor before this was allowed for.
  //
  // Only this one arrangement, deliberately. Also avoiding the un-spread layout
  // was tried and came out WORSE: the extra keep-out crowds the posts into
  // poorer pockets and costs more than it saves.
  const claimed = cellKeepoutMm(design.plate, design.switch) + 2 * design.fill.marginMm
  const free = difference(region, [...corners, ...cellRects(first, claimed)])

  return [...corners, ...edgeRects(region, free, feet.sizeMm)]
}

/** How many posts the chosen pattern asks for, fitted or not. */
export const feetWanted = (feet: FeetSettings | undefined): number =>
  !feet ? 0 : feet.pattern === 'corners+edges' ? 8 : 4
