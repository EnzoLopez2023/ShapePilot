// How a stack of switch trays adds up inside a case.
//
// The arithmetic is short but not obvious, and it is the answer to the only
// question that matters when you are filling a Systainer, so it lives on its
// own where the panel and the validator can both read it.
import { profileInternalClearHeight } from '../../../model/trayProfile.ts'
import {
  STACK_CLEARANCE_MM, bottomTierFeetHeightMm, feetHeightMm, requiredFeetHeightMm,
} from './defaults.ts'
import type { SwitchTrayDesign } from './types.ts'

export interface StackBudget {
  /** Height of one tray on its own: feet + shelf + recess. */
  trayHeightMm: number
  /**
   * Plate-top to plate-top once stacked. Works out to the switch's whole
   * envelope plus clearance, whatever the plate does -- a thinner plate saves
   * filament, never height, because the tray above hangs its pins into the
   * same air this tray's switch tops stand in.
   */
  tierPitchMm: number
  /** Feet the tray needs to sit on another one, and to sit at the bottom. */
  requiredFeetMm: number
  bottomTierFeetMm: number
  /** Clear height available, from the profile preset or the user's override. */
  clearHeightMm: number | null
  /** Trays that fit, and how tall that stack is. Null without a clear height. */
  tiers: number | null
  stackHeightMm: number | null
  /** How tall one more tier would make it -- what "5th overflows" is measured on. */
  nextTierHeightMm: number | null
  /** True when the feet as configured are too short for the tier being built. */
  feetTooShort: boolean
  /** Which build this design currently is. */
  tier: 'stacked' | 'bottom'
}

/**
 * Height of a stack of `n` trays: a short-footed tray at the bottom, then
 * `n - 1` at the full tier pitch, plus whatever the top tray's switches stand
 * proud of it.
 */
export function stackHeightMm(design: SwitchTrayDesign, n: number): number {
  const { shelfMm, recessMm } = design.plate
  const bottomFeet = design.feet?.bottomTierHeightMm
    ?? design.feet?.heightMm
    ?? bottomTierFeetHeightMm(design.plate, design.switch)
  const pitch = design.switch.flangeToTopMm + design.switch.flangeToTipMm + STACK_CLEARANCE_MM
  return bottomFeet + shelfMm + recessMm
    + Math.max(0, n - 1) * pitch
    + design.switch.flangeToTopMm
}

export function stackBudget(design: SwitchTrayDesign): StackBudget {
  const { shelfMm, recessMm } = design.plate
  const feetMm = feetHeightMm(design.feet)
  const tier = design.feet?.tier ?? 'stacked'
  const requiredFeetMm = requiredFeetHeightMm(design.plate, design.switch)
  const bottomTierFeetMm = bottomTierFeetHeightMm(design.plate, design.switch)
  const tierPitchMm =
    design.switch.flangeToTopMm + design.switch.flangeToTipMm + STACK_CLEARANCE_MM

  const clearHeightMm =
    design.caseClearHeightMm ?? profileInternalClearHeight(design.profile)

  let tiers: number | null = null
  let height: number | null = null
  let next: number | null = null
  if (clearHeightMm !== null && clearHeightMm > 0) {
    tiers = 0
    for (let n = 1; n <= 32; n++) {
      if (stackHeightMm(design, n) > clearHeightMm) break
      tiers = n
    }
    height = tiers > 0 ? stackHeightMm(design, tiers) : null
    next = stackHeightMm(design, (tiers ?? 0) + 1)
  }

  return {
    trayHeightMm: feetMm + shelfMm + recessMm,
    tierPitchMm,
    requiredFeetMm,
    bottomTierFeetMm,
    clearHeightMm,
    tiers,
    stackHeightMm: height,
    nextTierHeightMm: next,
    // Each tier is judged against its own job: a bottom tray that only lifts
    // its pins is correct, not short.
    feetTooShort: feetMm + 1e-9 < (tier === 'bottom' ? bottomTierFeetMm : requiredFeetMm),
    tier,
  }
}
