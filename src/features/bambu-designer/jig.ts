// Plywood alignment jigs: a printed cap that slips over the front edges of two
// panels and holds them square while the glue or screws go in.
//
// Seen from the front of the cabinet, the jig is a floor with walls standing
// on it, and the gaps between the walls are slots the panel edges drop into.
// A T jig holds a shelf against the face of a side panel, mid-height; a corner
// jig holds two panels meeting at a butt corner, its outer walls closed so the
// joint comes out flush; a cross jig holds a divider square to the shelves
// either side of it -- the inside of a cubby unit, where every joint is a +. The slots are open at their ends, because the panels
// run on past the jig.
//
// Each slot has its own thickness. A shelf is often thinner than the carcass,
// and the same nominal sheet measures 18 or 19 mm depending on where it came
// from, so both are entered as measured, plus a clearance per side.
//
// Like the hardware cutters, a jig is a group of ordinary path objects -- a
// floor and its walls -- so the inspector and the 3MF export need nothing new.
import type { Contour, GroupObject, PathObject, Triple } from '../../model/document.ts'
import { IDENTITY_TRANSFORM, newId } from '../../model/scene.ts'

export type JigKind = 'tee' | 'corner' | 'cross'

export const JIG_LABELS: Readonly<Record<JigKind, string>> = {
  tee: 'T alignment jig',
  corner: 'Corner alignment jig',
  cross: '+ alignment jig',
}

export interface JigSpec {
  kind: JigKind
  /** The side panel, as measured. */
  carcassMm: number
  /** The shelf, or for a corner the panel that butts into the side. */
  shelfMm: number
  /** Added to each side of each slot. */
  clearanceMm: number
  /** Outside length along the side panel. */
  carcassLengthMm: number
  /** Outside length along the shelf, from the far wall of the side slot. */
  shelfLengthMm: number
  wallMm: number
  /** How far the panel edges sit in the slots. */
  depthMm: number
  floorMm: number
  /** Two holes through the floor, to tack the jig in place with a brad or screw. */
  holes: boolean
}

export const DEFAULT_JIG_SPEC: JigSpec = {
  kind: 'tee',
  carcassMm: 18,
  shelfMm: 12,
  clearanceMm: 0.05,
  carcassLengthMm: 60,
  shelfLengthMm: 50,
  wallMm: 2,
  depthMm: 10,
  floorMm: 4,
  holes: true,
}

export const JIG_HOLE_MM = 4
const HOLE_SEGMENTS = 32

const rect = (x0: number, y0: number, x1: number, y1: number): Contour =>
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

/** Clockwise, as a hole ring must be. */
const circle = (cx: number, cy: number, r: number): Contour =>
  Array.from({ length: HOLE_SEGMENTS }, (_, i) => {
    const a = (-2 * Math.PI * i) / HOLE_SEGMENTS
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const
  })

interface Outline {
  floor: Contour
  walls: Contour[]
  holes: [number, number][]
  /** The shortest stretch of slot floor a hole sits in, along its slot. */
  holeRoom: number
  /** Width of a slot, clearance included. */
  carcassSlot: number
  shelfSlot: number
}

/**
 * The jig's footprint, x along the shelf and y along the side panel, with the
 * outside corner at the origin. Every contour is counter-clockwise.
 */
function outline(spec: JigSpec): Outline {
  const w = spec.wallMm
  const C = spec.carcassMm + 2 * spec.clearanceMm
  const S = spec.shelfMm + 2 * spec.clearanceMm
  const H = spec.carcassLengthMm
  const X = spec.shelfLengthMm
  // The outer face of the wall on the far side of the side slot.
  const A = 2 * w + C

  if (spec.kind === 'tee') {
    // The shelf slot is centred along the side panel.
    const ys = (H - S) / 2
    return {
      floor: [[0, 0], [A, 0], [A, ys - w], [X, ys - w], [X, ys + S + w], [A, ys + S + w], [A, H], [0, H]],
      walls: [
        rect(0, 0, w, H),
        [[w + C, 0], [A, 0], [A, ys - w], [X, ys - w], [X, ys], [w + C, ys]],
        [[w + C, ys + S], [X, ys + S], [X, ys + S + w], [A, ys + S + w], [A, H], [w + C, H]],
      ],
      // One in the side slot either side of the shelf.
      holes: [[w + C / 2, ys / 2], [w + C / 2, H - ys / 2]],
      holeRoom: ys,
      carcassSlot: C,
      shelfSlot: S,
    }
  }

  if (spec.kind === 'cross') {
    // The divider slot runs the full length in y, the shelf slot the full
    // width in x, both centred: four L-shaped walls, one in each quadrant.
    const xs = (X - C) / 2
    const ys = (H - S) / 2
    const a0 = xs - w, a1 = xs + C + w, b0 = ys - w, b1 = ys + S + w
    /** The front-left wall, then its mirror images, each kept counter-clockwise. */
    const quadrant: [number, number][] = [[xs - w, 0], [xs, 0], [xs, ys], [0, ys], [0, ys - w], [xs - w, ys - w]]
    const mirror = (mx: boolean, my: boolean): Contour => {
      const ring = quadrant.map(([x, y]) => [mx ? X - x : x, my ? H - y : y] as const)
      return mx !== my ? ring.reverse() : ring
    }
    return {
      floor: [[a0, 0], [a1, 0], [a1, b0], [X, b0], [X, b1], [a1, b1], [a1, H], [a0, H], [a0, b1], [0, b1], [0, b0], [a0, b0]],
      walls: [mirror(false, false), mirror(true, false), mirror(true, true), mirror(false, true)],
      // One in the divider slot either side of the shelves.
      holes: [[xs + C / 2, ys / 2], [xs + C / 2, H - ys / 2]],
      holeRoom: ys,
      carcassSlot: C,
      shelfSlot: S,
    }
  }

  const B = 2 * w + S
  return {
    floor: [[0, 0], [X, 0], [X, B], [A, B], [A, H], [0, H]],
    walls: [
      [[0, 0], [X, 0], [X, w], [w, w], [w, H], [0, H]],
      [[w + C, w + S], [X, w + S], [X, B], [A, B], [A, H], [w + C, H]],
    ],
    // One in each arm, clear of where the two slots cross.
    holes: [[w + C / 2, (w + S + H) / 2], [(w + C + X) / 2, w + S / 2]],
    holeRoom: Math.min(H - (w + S), X - (w + C)),
    carcassSlot: C,
    shelfSlot: S,
  }
}

/** The shortest each length may be for the walls to still close around the slots. */
export function jigMinimums(spec: JigSpec): { carcassLengthMm: number; shelfLengthMm: number } {
  const w = spec.wallMm
  const C = spec.carcassMm + 2 * spec.clearanceMm
  const S = spec.shelfMm + 2 * spec.clearanceMm
  if (spec.kind === 'cross') {
    // A wall either side of each slot, and some of the other slot beyond each.
    return { carcassLengthMm: S + 4 * w, shelfLengthMm: C + 4 * w }
  }
  return spec.kind === 'tee'
    // A wall either side of the shelf slot, and some side slot beyond each.
    ? { carcassLengthMm: S + 4 * w, shelfLengthMm: C + 3 * w }
    : { carcassLengthMm: S + 3 * w, shelfLengthMm: C + 3 * w }
}

/** Why a spec cannot be made, or null when it can. */
export function jigProblem(spec: JigSpec): string | null {
  const positive: [number, string][] = [
    [spec.carcassMm, 'Side panel thickness'], [spec.shelfMm, 'Shelf thickness'],
    [spec.wallMm, 'Wall'], [spec.depthMm, 'Slot depth'], [spec.floorMm, 'Floor'],
  ]
  for (const [value, label] of positive) {
    if (!Number.isFinite(value) || value <= 0) return `${label} must be above zero.`
  }
  if (!Number.isFinite(spec.clearanceMm) || spec.clearanceMm < 0 || spec.clearanceMm > 2) {
    return 'Clearance must be between 0 and 2 mm.'
  }
  const min = jigMinimums(spec)
  if (!(spec.carcassLengthMm >= min.carcassLengthMm)) {
    return `Length along the side panel must be at least ${round(min.carcassLengthMm)} mm.`
  }
  if (!(spec.shelfLengthMm >= min.shelfLengthMm)) {
    return `Length along the shelf must be at least ${round(min.shelfLengthMm)} mm.`
  }
  return null
}

const round = (mm: number) => Math.ceil(mm * 10) / 10

/** Whether each hole fits in the slot floor under it with a millimetre to spare. */
export const jigHolesFit = (spec: JigSpec): boolean => {
  const o = outline(spec)
  return Math.min(o.carcassSlot, o.shelfSlot, o.holeRoom) >= JIG_HOLE_MM + 1
}

const JIG_PREFIX: Record<JigKind, string> = { tee: 'T', corner: 'Corner', cross: '+' }

const fmt = (mm: number) => String(Math.round(mm * 100) / 100)

export const jigName = (spec: JigSpec): string =>
  `${JIG_PREFIX[spec.kind]} jig ${fmt(spec.shelfMm)} / ${fmt(spec.carcassMm)} mm`

/** One jig, flat on the plate with its outside corner at `at`. */
export function createJig(spec: JigSpec, at: Triple = [0, 0, 0]): GroupObject {
  const problem = jigProblem(spec)
  if (problem) throw new Error(problem)
  const o = outline(spec)
  const holeRings = spec.holes && jigHolesFit(spec)
    ? o.holes.map(([x, y]) => circle(x, y, JIG_HOLE_MM / 2))
    : []

  const floor: PathObject = {
    id: newId(), name: 'Floor', type: 'path',
    rings: [o.floor, ...holeRings], thicknessMm: spec.floorMm,
    transform: IDENTITY_TRANSFORM,
    mode: 'solid', visible: true, locked: false,
  }
  const walls: PathObject = {
    id: newId(), name: 'Walls', type: 'path',
    rings: o.walls, thicknessMm: spec.depthMm,
    transform: { ...IDENTITY_TRANSFORM, position: [0, 0, spec.floorMm] },
    mode: 'solid', visible: true, locked: false,
  }
  return {
    id: newId(),
    name: jigName(spec),
    type: 'group',
    children: [floor, walls],
    transform: { ...IDENTITY_TRANSFORM, position: at },
    mode: 'solid',
    visible: true,
    locked: false,
  }
}

/** Outside size on the plate, x by y. */
export function jigFootprint(spec: JigSpec): [number, number] {
  return [spec.shelfLengthMm, spec.carcassLengthMm]
}
