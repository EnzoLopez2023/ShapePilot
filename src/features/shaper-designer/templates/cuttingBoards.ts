// Cutting boards with juice grooves, as Shaper Designer templates. After the
// Woodpeckers CBJG-SM (8 x 13 in, corner hang hole) and CBJG-LG (10.75 x
// 17.75 in, a slot handle at each end): Origin cuts the board directly, so these
// are the boards themselves, not the acrylic jigs. scripts/build-cutting-boards.ts
// writes the same boards to models/cutting-boards/ as ready-to-cut SVGs.
import type { Ring, Vec2 } from '../../../geometry/vec.ts'
import type { Pulley } from './outline.ts'
import { IN, belt, circle, corners, fillet, roundedRect, stadium } from './outline.ts'

export { IN, fmtIn } from './outline.ts'

export const SHOP = {
  /** The groove is an on-line cut, so its width is the core box bit's. */
  grooveBitIn: 3 / 8,
  grooveDepthIn: 1 / 4,
  /** Groove centreline in from the board edge. */
  grooveInsetIn: 1,
  /** Wood left between the groove's edge and a handle opening. */
  handleWallIn: 1 / 2,
  /** Radius of the S-curve where the groove leaves the edge to clear a handle.
   *  The large board's slots leave less room before the corner -- see there. */
  grooveFilletIn: 1,
  cornerRadiusIn: 1.5,
}

// -- The boards --------------------------------------------------------------

export interface CuttingBoard {
  /** Stable: the template key in the designer and the SVG's file name. */
  id: string
  name: string
  /** One line for the template menu. */
  summary: string
  lengthMm: number
  widthMm: number
  /** Board coordinates: millimetres, y-up, the board's bottom-left at 0,0. */
  profile: Ring
  handles: Ring[]
  groove: Ring
  notes: string[]
}

export const groove = {
  inset: SHOP.grooveInsetIn * IN,
  half: (SHOP.grooveBitIn * IN) / 2,
  fillet: SHOP.grooveFilletIn * IN,
  /** Groove corners stay concentric with the board's. */
  corner: (SHOP.cornerRadiusIn - SHOP.grooveInsetIn) * IN,
}
export const R = SHOP.cornerRadiusIn * IN
export const wall = SHOP.handleWallIn * IN

/** CBJG-SM: 8 x 13 in, a 1 in hang hole in one corner, the groove bending in
 *  around it. Length runs along x, the hole at bottom-left. */
function smallBoard(): CuttingBoard {
  const L = 13 * IN, W = 8 * IN
  const holeR = 0.5 * IN
  const hole: Vec2 = [1.25 * IN, 1.25 * IN]
  const g = groove.inset
  const keep: Pulley = { c: hole, r: holeR + wall + groove.half, turn: -1 }
  const [, br, tr, tl] = corners(g, g, L - g, W - g, groove.corner)
  const path: Pulley[] = [
    // Down the left run, in round the hole, back out onto the bottom run.
    fillet(keep, groove.fillet, 'x', g, 1, 1),
    keep,
    fillet(keep, groove.fillet, 'y', g, 1, 1),
    br!, tr!, tl!,
  ]
  return {
    id: 'cutting-board-small',
    name: 'Cutting board, small (8 x 13 in)',
    summary: '8 x 13 in, corner hang hole',
    lengthMm: L, widthMm: W,
    profile: roundedRect(0, 0, L, W, R),
    handles: [circle(hole, holeR)],
    groove: belt(path),
    notes: ['Hang hole: 1 in diameter, centred 1-1/4 in from both edges of one corner.'],
  }
}

/** CBJG-LG: 10.75 x 17.75 in, a 1 x 3-1/2 in slot handle across each end, the
 *  groove swinging in around both. */
function largeBoard(): CuttingBoard {
  const L = 17.75 * IN, W = 10.75 * IN
  const slotR = 0.5 * IN
  const slotHalf = (3.5 * IN) / 2 - slotR
  const slotX = 1.5 * IN
  const cy = W / 2
  const g = groove.inset
  const keepR = slotR + wall + groove.half
  // A 1 in fillet would start above where the groove's corner arc ends: the
  // slot leaves under 2 in of straight run before the corner.
  const rf = 0.5 * IN

  const slot = (x: number): Ring => stadium([x, cy - slotHalf], [x, cy + slotHalf], slotR)

  // Left end: travelling down x = g, the path meets the top of the slot first.
  const lTop: Pulley = { c: [slotX, cy + slotHalf], r: keepR, turn: -1 }
  const lBot: Pulley = { c: [slotX, cy - slotHalf], r: keepR, turn: -1 }
  // Right end: travelling up x = L - g, the bottom of the slot comes first.
  const rBot: Pulley = { c: [L - slotX, cy - slotHalf], r: keepR, turn: -1 }
  const rTop: Pulley = { c: [L - slotX, cy + slotHalf], r: keepR, turn: -1 }
  const [bl, br, tr, tl] = corners(g, g, L - g, W - g, groove.corner)

  const path: Pulley[] = [
    tl!,
    fillet(lTop, rf, 'x', g, 1, 1),
    lTop, lBot,
    fillet(lBot, rf, 'x', g, 1, -1),
    bl!, br!,
    fillet(rBot, rf, 'x', L - g, -1, -1),
    rBot, rTop,
    fillet(rTop, rf, 'x', L - g, -1, 1),
    tr!,
  ]
  return {
    id: 'cutting-board-large',
    name: 'Cutting board, large (10-3/4 x 17-3/4 in)',
    summary: '10-3/4 x 17-3/4 in, slot handles at both ends',
    lengthMm: L, widthMm: W,
    profile: roundedRect(0, 0, L, W, R),
    handles: [slot(slotX), slot(L - slotX)],
    groove: belt(path),
    notes: ['Handles: 1 x 3-1/2 in slots, centred across the width, 1-1/2 in from each end to their centreline.'],
  }
}

export const cuttingBoards = (): CuttingBoard[] => [smallBoard(), largeBoard()]
