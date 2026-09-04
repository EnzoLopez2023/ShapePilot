// Filament profiles for the FDM (print) target. This is a *working* choice,
// like snap or the buffer guide -- which material the tray will be printed in,
// so the print checks can hold it to the right floor thickness and the panel
// can state the fit a cap will get. It rides in ViewSettings (per tray, per
// browser), not in the saved design: the geometry is material-agnostic, and a
// tray printed in PLA today and PETG tomorrow is the same tray.

export type MaterialId = 'generic' | 'pla-basic' | 'pla-matte' | 'petg'

export interface MaterialProfile {
  id: MaterialId
  label: string
  /**
   * Extra width an FDM pocket wants over the nominal so a cap drops in without
   * sanding -- inner walls print a hair proud (first-layer squish, elephant
   * foot). Informational for now; the pocket formula still sizes to nominal.
   */
  pocketClearanceMm: number
  /** Below this the floor flexes or warps for this material; drives the print check. */
  minFloorMm: number
  /** One line for the properties panel. */
  note: string
}

export const MATERIALS: Record<MaterialId, MaterialProfile> = {
  generic: {
    id: 'generic', label: 'Generic / unset', pocketClearanceMm: 0.15, minFloorMm: 0.8,
    note: 'Neutral tolerances — pick a material to tune the print checks.',
  },
  'pla-basic': {
    id: 'pla-basic', label: 'PLA Basic', pocketClearanceMm: 0.15, minFloorMm: 0.8,
    note: 'Stiff, low shrink. A 1.2 mm floor holds the pockets firm.',
  },
  'pla-matte': {
    id: 'pla-matte', label: 'PLA Matte', pocketClearanceMm: 0.15, minFloorMm: 1.0,
    note: 'Slightly more brittle than Basic — keep the floor a touch thicker.',
  },
  petg: {
    id: 'petg', label: 'PETG', pocketClearanceMm: 0.2, minFloorMm: 1.4,
    note: 'Shrinks and warps more — wider pocket clearance, 1.6 mm+ floor.',
  },
}

export const MATERIAL_IDS = Object.keys(MATERIALS) as MaterialId[]

export const isMaterialId = (value: unknown): value is MaterialId =>
  typeof value === 'string' && value in MATERIALS

export const materialOf = (id: string | undefined): MaterialProfile =>
  MATERIALS[id as MaterialId] ?? MATERIALS.generic
