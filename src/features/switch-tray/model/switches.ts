// The switches a tray can be cut for.
//
// Every number here is read off a manufacturer drawing and is a *default*, not
// a constant: the panel exposes all of them, because third-party MX clones vary
// by a tenth or two and the only authority that matters is a caliper on the
// user's own switches.

export type SwitchProfileId = 'mx' | 'choc-v1'

export interface SwitchProfile {
  id: SwitchProfileId
  label: string
  /** Lower housing: the square the plate is cut to. */
  bodyMm: number
  /** Top housing: the widest part, and what a recess has to clear. */
  housingMm: number
  /** Flange underside up to the stem top -- what stands proud of the plate. */
  flangeToTopMm: number
  /** Flange underside down to the pin tips -- what hangs below the plate. */
  flangeToTipMm: number
  /** Plate thickness the switch's own clips are designed to latch onto. */
  clipPlateMm: number
  /** Keyboard spacing, for reference. */
  standardPitchMm: number
  /** Closest the manufacturer will stand two of them, centre to centre. */
  minPitchMm: number
  /** Where the numbers came from, shown under the picker. */
  source: string
}

/**
 * Cherry MX, from the MX1A-xxNA/NB drawing (sheet 2 of 2).
 *
 * The height chain on that drawing nests rather than stacks: `11.6` runs from
 * the plate's top face to the stem top and *contains* the `3.6` stem, so the
 * switch's whole envelope is 11.60 above the flange plus 5.00 of lower housing
 * plus 3.30 of pin = 19.90 mm. That envelope is what sets the stacking pitch,
 * and no plate design can beat it.
 */
export const MX: SwitchProfile = {
  id: 'mx',
  label: 'Cherry MX',
  bodyMm: 14.0,
  housingMm: 15.6,
  flangeToTopMm: 11.6,
  flangeToTipMm: 8.3,
  clipPlateMm: 1.5,
  standardPitchMm: 19.05,
  minPitchMm: 16.0,
  source: 'Cherry MX1A-xxNA/NB drawing — 19.05 mm standard, 16 mm minimum lead spacing',
}

/**
 * Kailh Choc v1, from the PG1350 / CPG135001D01 drawing.
 *
 * The dimension chain sums to the drawing's stated 14.50 overall: 2.20 of leg,
 * 3.00 of body below the flange, 0.50 of flange, 5.80 of housing, 3.00 of stem.
 * Half the height of an MX, which is worth a whole extra tier in a Systainer.
 */
export const CHOC_V1: SwitchProfile = {
  id: 'choc-v1',
  label: 'Kailh Choc v1',
  bodyMm: 13.8,
  housingMm: 15.0,
  flangeToTopMm: 9.3,
  flangeToTipMm: 5.2,
  clipPlateMm: 1.25,
  standardPitchMm: 18.0,
  minPitchMm: 15.5,
  source: 'Kailh PG1350 drawing — 14.50 mm overall, 13.80 mm plate cutout',
}

export const SWITCH_PROFILES: SwitchProfile[] = [MX, CHOC_V1]

export const getSwitchProfile = (id: SwitchProfileId): SwitchProfile => {
  const p = SWITCH_PROFILES.find(s => s.id === id)
  if (!p) throw new Error(`unknown switch profile: ${id}`)
  return p
}

/** The whole switch, pin tips to stem top. Sets the minimum stacking pitch. */
export const switchEnvelopeMm = (s: SwitchProfile): number =>
  s.flangeToTopMm + s.flangeToTipMm
