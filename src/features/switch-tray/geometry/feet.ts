// Where the posts under the plate can actually stand.
//
// Feet are placed against the *outline alone*, before any cell exists, and the
// fill then treats their footprints as occupied. That ordering is what keeps
// the two from depending on each other: a post never lands under a switch, and
// a switch never lands on a post.
import type { Polygon } from '../../../geometry/vec.ts'
import { multiBBox } from '../../../geometry/vec.ts'
import { cornerSeats, edgeMidSeats, findSeats } from '../../../geometry/seats.ts'
import { profileToMulti } from '../../../model/trayProfile.ts'
import { feetHeightMm } from '../model/defaults.ts'
import type { FeetSettings, TrayProfile } from '../model/types.ts'

/** How far a post dips up into the plate, so a slicer welds the two solids. */
export const FOOT_WELD_MM = 0.05

/**
 * The post footprints that fit. Corners search diagonally inward; edge posts
 * search straight in from the middle of each side. A position that never finds
 * solid material is dropped, and `validate.ts` says so.
 *
 * Searched against the bare outline, not the plate after cells are cut -- see
 * the note at the top of this file on why that ordering matters.
 */
export function feetRects(profile: TrayProfile, feet: FeetSettings | undefined): Polygon[] {
  if (!feet || feetHeightMm(feet) <= 0 || feet.sizeMm <= 0) return []
  const region = profileToMulti(profile)
  const bb = multiBBox(region)
  const s = feet.sizeMm
  const seats = feet.pattern === 'corners+edges'
    ? [...cornerSeats(bb, s), ...edgeMidSeats(bb, s)]
    : cornerSeats(bb, s)
  return findSeats(region, s, seats)
}

/** How many posts the chosen pattern asks for, fitted or not. */
export const feetWanted = (feet: FeetSettings | undefined): number =>
  !feet ? 0 : feet.pattern === 'corners+edges' ? 8 : 4
