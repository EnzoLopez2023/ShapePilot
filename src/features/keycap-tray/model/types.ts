import type { MultiPolygon } from '../../../geometry/vec.ts'
import type { PocketSizing } from '../geometry/shapes.ts'

export type { PocketSizing }

export type TrayProfile =
  | { kind: 'rect'; widthMm: number; heightMm: number; cornerRadiusMm?: number }
  | { kind: 'preset'; id: PresetProfileId }
  | { kind: 'custom'; rings: MultiPolygon; sourceName?: string }

export type PresetProfileId = 'systainer-s76-plain' | 'systainer-s76-notched'

export interface Pocket {
  id: string
  /** Key width in u. 1, 1.25, 6.25 ... */
  units: number
  /** Lower-left corner, mm, y-up. */
  x: number
  y: number
  /** 2 for numpad Enter/Plus. Defaults to 1. */
  heightUnits?: number
  /**
   * Real rotation about the un-rotated footprint centre, degrees, canonical
   * [0, 360). 0 and 90 are also what the Tilt toggle sets.
   */
  rotationDeg?: number
  /** Reflect the geometry across its own vertical centreline, in place. */
  mirrorX?: boolean
  /** Reflect the geometry across its own horizontal centreline, in place. */
  flipY?: boolean
  /** Cuts clean through the floor instead of stopping at it. */
  isThrough?: boolean
  /** 'iso-enter' overrides the rectangular footprint with the ISO big-Enter L-shape. */
  shape?: 'rect' | 'iso-enter'
  depthMm?: number
  label?: string
  labelMode?: 'guide' | 'engrave' | 'none'
  /** Explicit overrides for a custom pocket; otherwise derived from sizing. */
  widthMm?: number
  heightMm?: number
  cornerRadiusMm?: number
}

/**
 * Square posts at the four corners of the tray rim. A tray stacked on top rests
 * on the posts, not on keycaps that stand proud of their pockets. Absent = no
 * spacers. A post that would overhang a notch or a corner-hugging pocket is
 * dropped, and `validate.ts` notes the shortfall.
 */
export interface CornerSpacers {
  /** Post height above the tray rim, mm. */
  heightMm: number
  /** Square post footprint, mm on a side. */
  sizeMm: number
}

export interface TrayDesign {
  id: string
  /** The keycap project this tray is cut for; null while it stands alone. */
  projectId?: string | null
  name: string
  notes?: string
  profile: TrayProfile
  sizing: PocketSizing
  floorThicknessMm: number
  pocketDepthMm: number
  engraveDepthMm: number
  cornerSpacers?: CornerSpacers
  pockets: Pocket[]
  /** Bumped on every mutation; the useMemo key for mesh rebuilds. */
  revision: number
}

export interface FabricationSettings {
  /** Router bit diameter, mm. 1/8" = 3.175. */
  toolDiameterMm: number
  /** CNC stock thickness, mm. */
  stockThicknessMm: number
  /** Printer build plate, mm. */
  plateWidthMm: number
  plateDepthMm: number
  /** Minimum wall between adjacent pockets, mm. */
  minWallMm: number
}

// DEFAULT_FABRICATION and the pocket palette data live in ./defaults.ts.
