// A tray of pockets for tools, each pocket its own shape and its own depth.
//
// TWO DELIBERATE DEPARTURES from `keycap-tray/model/types.ts`, which is
// otherwise the closest relative -- worth knowing before reading the two side
// by side:
//
// 1. There is no `floorThicknessMm` + `pocketDepthMm` pair. With per-pocket
//    depth those two cannot both be authoritative: a tray whose deepest pocket
//    is 19 mm and whose shallowest is 8 mm has no single "pocket depth", and a
//    floor thickness derived from one of them would be wrong for the other.
//    Instead `heightMm` is the one number the user sets, every pocket says how
//    far down from the rim it reaches, and `minFloorMm` is a *validation bound*
//    rather than geometry.
//
// 2. A pocket is a list of extruded *steps*, not a single footprint. A Bambu
//    hotend bay is a deep pocket for the heatsink, a shallower channel for the
//    nozzle and a deeper relief at the tip -- one part, three depths. Steps are
//    what make that one pocket you can move and rotate as a unit rather than
//    three you have to keep in register by hand.
import type { MultiPolygon, Vec2 } from '../../../geometry/vec.ts'
import type { TrayProfile } from '../../../model/trayProfile.ts'

/** What a step's footprint is, in the pocket's own frame. */
export type StepShape =
  | { kind: 'rect'; widthMm: number; heightMm: number; cornerRadiusMm?: number }
  | { kind: 'ellipse'; rxMm: number; ryMm: number }
  | { kind: 'polygon'; sides: number; radiusMm: number; rotationDeg?: number }
  /**
   * A constant-width run along a polyline -- the only shape that can hold an
   * allen key, whose long arm and short arm meet at a right angle. `path` is in
   * the pocket's own frame; the run is the union of a rectangle per segment and
   * a disc at each interior vertex, so the corners come out round whatever the
   * angle.
   */
  | { kind: 'channel'; path: Vec2[]; widthMm: number }
  /** Traced from a real part. Phase 3; the mesher already handles it. */
  | { kind: 'outline'; rings: MultiPolygon; sourceName?: string }

export interface PocketStep {
  shape: StepShape
  /**
   * Lower-left of this step's footprint within the pocket's own frame. Absent
   * = the pocket's own origin.
   *
   * A tiered pocket needs this: a hotend bay is a deep heatsink pocket at one
   * end and a shallower nozzle channel at the other, and they are only one
   * pocket because they share a box and a transform.
   */
  offset?: Vec2
  /**
   * Depth measured DOWN from the rim, so a step's floor sits at
   * `heightMm - depthMm`. `null` cuts through the tray entirely.
   */
  depthMm: number | null
  /**
   * Hold this step's floor up above an underside lift recess, leaving a thin
   * roof over it, instead of refusing the placement. Off by default and per
   * step, because it puts a *step in the pocket floor* -- fine under a bin of
   * screws, a defect under an allen key.
   */
  liftOverKeepOut?: boolean
}

/**
 * A scoop or slot that breaks the pocket wall so the part can be lifted out.
 *
 * The keycap tray learned this the hard way: a 10 mm pocket swallows a Cherry
 * cap and there is no way to get a fingernail under it. A tool sitting flush in
 * a close-fitting pocket has the same problem.
 */
export interface FingerAccess {
  style: 'scallop' | 'slot'
  side: 'left' | 'right' | 'top' | 'bottom'
  widthMm: number
  /** How far it reaches beyond the pocket box, into the web. */
  reachMm: number
  /** Absent = as deep as the pocket's deepest step. */
  depthMm?: number
}

export type ToolPocketKind = 'bin' | 'channel' | 'cradle' | 'outline' | 'composite'

export interface ToolPocket {
  id: string
  kind: ToolPocketKind
  label?: string
  /**
   * Which part preset this came from, for provenance only. Free text, never
   * validated against the catalogue -- a tray built on a preset a later build
   * has never heard of still opens, because the steps were copied in.
   */
  presetId?: string
  /** Lower-left of the un-rotated footprint, mm, y-up. Same as the keycap tray. */
  x: number
  y: number
  /**
   * The un-rotated footprint box. Not derived from the steps: it is the
   * rotation pivot, and every step transforms about this same box so a tiered
   * pocket turns as one rigid body.
   */
  widthMm: number
  heightMm: number
  rotationDeg?: number
  mirrorX?: boolean
  flipY?: boolean
  steps: PocketStep[]
  fingerAccess?: FingerAccess
}

/** Posts under the tray, so a stack rests on them rather than on its contents. */
export interface TrayFeet {
  heightMm: number
  sizeMm: number
  pattern: 'corners' | 'corners+edges'
}

/** What to do about the case's own underside lift recesses. */
export type UndersideReliefMode =
  /** Pretend they are not there. Correct for a tray in a case that has none. */
  | 'ignore'
  /** Keep pockets clear of them, and say so when one is not. */
  | 'avoid'
  /** Keep clear AND cut them into this tray's underside. */
  | 'generate'

export interface ToolTrayDesign {
  id: string
  name: string
  notes?: string
  profile: TrayProfile
  /** Underside to rim. Every pocket depth is measured DOWN from this. */
  heightMm: number
  /** Pocket floors snap to whole multiples of this. 0.2 mm = one printed layer. */
  layerHeightMm: number
  /** Least material wanted under any pocket floor. A bound, not geometry. */
  minFloorMm: number
  pockets: ToolPocket[]
  feet?: TrayFeet
  undersideReliefs?: UndersideReliefMode
  /** Overrides the profile's own measured figure, for a different case. */
  caseClearHeightMm?: number
  /** Bumped on every mutation; what the geometry useMemos key on. */
  revision: number
}
