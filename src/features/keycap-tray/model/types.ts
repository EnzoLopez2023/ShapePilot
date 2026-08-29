import type { MultiPolygon } from '../geometry/vec.ts'
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
  rotationDeg?: 0 | 90
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

export interface TrayDesign {
  id: string
  name: string
  notes?: string
  profile: TrayProfile
  sizing: PocketSizing
  floorThicknessMm: number
  pocketDepthMm: number
  engraveDepthMm: number
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
