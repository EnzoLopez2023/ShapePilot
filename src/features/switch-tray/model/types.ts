import type { TrayProfile } from '../../../model/trayProfile.ts'
import type { SwitchProfile } from './switches.ts'

export type { TrayProfile, PresetProfileId } from '../../../model/trayProfile.ts'
export type { SwitchProfile, SwitchProfileId } from './switches.ts'

/**
 * How a switch is held.
 *
 * `shelf` — a recess for the top housing over a through-hole for the body. The
 *   switch drops in stem-up, seats on the shelf and lifts straight out. Least
 *   dense, because the recess has to clear the *housing*, not the body.
 * `clip`  — a true keyboard plate: the body hole in a plate the switch's own
 *   clips latch onto. Densest and thinnest; needs a puller to undo.
 * `plain` — a flat plate, body hole only, the housing resting on the face.
 *   Simplest and fastest to print; switches fall out if the tray is tipped.
 */
export type Retention = 'shelf' | 'clip' | 'plain'

export interface PlateSettings {
  retention: Retention
  /** `S` -- the band the body hole goes through. */
  shelfMm: number
  /** `R` -- the recess band above it. Zero for `clip` and `plain`. */
  recessMm: number
  /** Added to the body square. FDM prints holes undersize. */
  holeClearanceMm: number
  /** Added to the housing square for a `shelf` recess. */
  recessClearanceMm: number
  cornerRadiusMm: number
}

export interface FillSettings {
  pitchXMm: number
  pitchYMm: number
  /** Clear material between a cell's keep-out and the outline. */
  marginMm: number
  /** `brick` offsets alternate rows by half a pitch. */
  stagger: 'none' | 'brick'
  /**
   * `centred` puts the lattice on the profile's middle. `maximised` searches
   * the grid origin for whatever fits the most cells, which on a notched
   * outline is usually a row or a column more.
   */
  origin: 'centred' | 'maximised'
  /** Treat the pitch as a minimum and spread the cells across the real span. */
  spreadEvenly: boolean
}

/**
 * Posts under the plate. The tray above rests on them, and they are what keeps
 * this tray's own pins off whatever is below.
 *
 * A stack needs two builds of the same tray, because the two positions ask for
 * different posts. Everything above the bottom stands on the tray below and has
 * to clear a whole switch (`heightMm`); the bottom one rests on the case floor
 * and only has to lift its own pins (`bottomTierHeightMm`) -- which is what
 * buys the extra tier. `tier` says which one is being built, and the mesh, the
 * validator and the stack budget all read it through `feetHeightMm`, so the
 * tray previewed is the tray exported is the tray the budget counted.
 */
export interface FeetSettings {
  /** Which position this build is for. Absent on trays saved before it existed. */
  tier?: 'stacked' | 'bottom'
  /** Post height for a tray that stands on another tray. */
  heightMm: number
  sizeMm: number
  pattern: 'corners' | 'corners+edges'
  /** Post height for the tray at the bottom of the stack. */
  bottomTierHeightMm?: number
  /** Export the posts as their own body so a slicer can give them a colour. */
  separate?: boolean
}

/** Raised text of the tray name on the plate's top face. Absent = none. */
export interface Nameplate {
  heightMm: number
  fontSizeMm: number
  x: number
  y: number
}

/**
 * A switch tray is entirely parameters -- there is no cell array, because every
 * cell is identical and the layout is generated (see geometry/fill.ts). That is
 * what makes the undo history, the payload and the database row one small
 * object each, however many hundred switches the tray holds.
 */
export interface SwitchTrayDesign {
  id: string
  name: string
  notes?: string
  profile: TrayProfile
  /** Stored whole, not by id: the user may have measured their own switches. */
  switch: SwitchProfile
  plate: PlateSettings
  fill: FillSettings
  feet?: FeetSettings
  nameplate?: Nameplate
  /** `"col,row"` of cells the user clicked out of the generated grid. */
  skippedCells?: string[]
  /** Clear height of the case the stack lives in; null = use the profile's. */
  caseClearHeightMm?: number
  /** Bumped on every mutation; the useMemo key for mesh rebuilds. */
  revision: number
}
