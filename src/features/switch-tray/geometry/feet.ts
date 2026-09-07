// Where the posts under the plate can actually stand.
//
// Feet are placed against the *outline alone*, before any cell exists, and the
// fill then treats their footprints as occupied. That ordering is what keeps
// the two from depending on each other: a post never lands under a switch, and
// a switch never lands on a post.
import type { MultiPolygon, Polygon, Vec2 } from '../../../geometry/vec.ts'
import { multiArea, multiBBox, translateRing } from '../../../geometry/vec.ts'
import { difference } from '../../../geometry/boolean.ts'
import { rectRing } from '../../../geometry/primitives.ts'
import { profileToMulti } from '../../../model/trayProfile.ts'
import type { FeetSettings, TrayProfile } from '../model/types.ts'

// Gap from the tray's outer edge to a post, and how far the search will walk
// inward looking for solid material. The Systainer notched preset chamfers all
// four corners, so a fixed inset lands in the notch; the same progressive
// search the keycap tray's corner spacers use fixes it here too.
const INSET_MM = 2
const INSET_STEP_MM = 1
const INSET_MAX_MM = 40

/** How far a post dips up into the plate, so a slicer welds the two solids. */
export const FOOT_WELD_MM = 0.05

const fitsOn = (rect: Polygon, region: MultiPolygon): boolean =>
  multiArea(difference([rect], region)) < 1e-6

/**
 * The post footprints that fit. Corners search diagonally inward; edge posts
 * search straight in from the middle of each side. A position that never finds
 * solid material inside `INSET_MAX_MM` is dropped, and `validate.ts` says so.
 */
export function feetRects(profile: TrayProfile, feet: FeetSettings | undefined): Polygon[] {
  if (!feet || feet.heightMm <= 0 || feet.sizeMm <= 0) return []
  const region = profileToMulti(profile)
  const bb = multiBBox(region)
  const s = feet.sizeMm
  const midX = (bb.minX + bb.maxX) / 2 - s / 2
  const midY = (bb.minY + bb.maxY) / 2 - s / 2

  // [x at inset, y at inset] for each seat. `null` on an axis means "stay in
  // the middle of that axis and only walk in along the other one".
  const seats: ((inset: number) => Vec2)[] = [
    inset => [bb.minX + inset, bb.minY + inset],
    inset => [bb.maxX - inset - s, bb.minY + inset],
    inset => [bb.maxX - inset - s, bb.maxY - inset - s],
    inset => [bb.minX + inset, bb.maxY - inset - s],
  ]
  if (feet.pattern === 'corners+edges') {
    seats.push(
      inset => [midX, bb.minY + inset],
      inset => [midX, bb.maxY - inset - s],
      inset => [bb.minX + inset, midY],
      inset => [bb.maxX - inset - s, midY],
    )
  }

  const rects: Polygon[] = []
  for (const seat of seats) {
    for (let inset = INSET_MM; inset <= INSET_MAX_MM; inset += INSET_STEP_MM) {
      const [x, y] = seat(inset)
      const rect: Polygon = [translateRing(rectRing(s, s), x, y)]
      if (fitsOn(rect, region)) { rects.push(rect); break }
    }
  }
  return rects
}

/** How many posts the chosen pattern asks for, fitted or not. */
export const feetWanted = (feet: FeetSettings | undefined): number =>
  !feet ? 0 : feet.pattern === 'corners+edges' ? 8 : 4
