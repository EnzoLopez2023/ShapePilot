// Holders for filament swatch cards: somewhere to hang a card so that it
// follows its spool.
//
// A card lives on the Skadis bar by the shelf. When its spool goes into the
// AMS, the card moves to a pad stuck on the AMS; when the spool goes into a dry
// box, the card moves to a pad on that. So the thing that actually matters is
// not storage -- it is that lifting a card off one mount and dropping it on
// another is the SAME one-handed motion everywhere.
//
// That is why every back emits an IDENTICAL blade, and why `holderGeometry.ts`
// has a test comparing them rather than a comment promising it.
//
//   present the card, push back, release.      to remove: lift, pull forward.
//
// Two numbers from the card govern the whole design, and both come from
// `cardHang()` rather than being restated here:
//
//   * The slot is 2.0 mm wide, and that is the WHOLE budget for anything that
//     passes through it -- blade, plus whatever stands above the blade, plus
//     clearance. This is the rule most likely to be broken by a future tweak,
//     so `checkConfig` states the arithmetic in its message.
//   * The strap between the slot and the card's edge is 1.0 x 2.0 mm of PLA,
//     two or three extrusion lines. Nothing here may need force to engage, and
//     nothing may load that strap on a corner.
import { SKADIS } from '../geometry/skadis.ts'
import { BAMBU_X2D } from '../model/machines.ts'
import { CARD_50x30, cardHang } from './card.ts'
import type { CardConfig } from './card.ts'

/**
 * `skadis` hangs on the pegboard by the shelf and carries one card per column.
 * `pad` is a single mount that sticks to a FLAT face with a VHB pad -- the AMS,
 * a dryer's side, a tub's lid.
 *
 * There is deliberately no mount for a curved face yet: see the note on
 * `minFlatRadiusMm`.
 */
export type HolderBack = 'skadis' | 'pad'

export interface HolderSpec {
  back: HolderBack
  /** Skadis columns, or pad slots. One card each either way. */
  count: number
}

export interface HolderConfig {
  // ---- the shared interface: every back emits exactly this ----
  /**
   * The blade the card hangs on. Thin, because the card's slot is the budget.
   */
  bladeThicknessMm: number
  bladeLengthMm: number
  /**
   * How far the tip lip stands above the blade. This is what stops a card being
   * knocked off forwards, and the lift that releases one.
   */
  bladeLipMm: number
  /** How far the lip runs along the blade, outboard of the card's face. */
  bladeLipRunMm: number
  /** Clearance in the card's slot, and in the Skadis board's. */
  fitMm: number

  // ---- the body every back shares ----
  bodyThicknessMm: number
  bodyHeightMm: number
  bodyCornerRadiusMm: number

  // ---- skadis ----
  /**
   * NOT measured anywhere in this repo, and not published by IKEA either. 5.0
   * is the number everyone quotes; the coupon is what settles it. Too thick and
   * the bar rocks, too thin and the catch will not clear.
   */
  boardThicknessMm: number
  /** Shank, in the slot. Bears the load on the slot's lower edge. */
  prongHeightMm: number
  /** How far the catch drops behind the board. Also the install action. */
  prongCatchDropMm: number
  /**
   * The catch's thickness, behind the board. It is a cantilever bending about
   * its own thickness, so this is the number that makes the hook strong --
   * width cannot help, because the catch has to pass through a 5 mm slot on
   * the way in.
   */
  prongCatchThicknessMm: number
  /**
   * Body top to the top of the prongs. Zero, and that is a PRINT decision.
   *
   * The bar is printed standing on its top edge, so the bed is the body-top
   * plane. At zero the prongs start on the bed; at anything else they start
   * that far up as a 7 mm ledge hanging off the side of the body with nothing
   * under it, which prints drooped and is why the first coupon's hook was
   * weak. It also happens to be the strongest place for them: the couple that
   * resists a hanging card tipping the bar runs from the catch to the body's
   * lower edge, so putting the prongs at the very top makes that arm the
   * body's whole height.
   */
  prongTopBelowTopMm: number

  // ---- pad ----
  /** Body edge to the end of the outermost blade. */
  padSideMm: number
  padHeightMm: number
  /**
   * How far VHB foam takes up before its edges live in permanent peel. It is
   * what turns the pad's width into the flattest surface the pad is honest
   * about -- see `minFlatRadiusMm` on the derived values, which is reported
   * rather than enforced: a pad is not wrong for being flat, it is only wrong
   * on a drum tighter than it can sit on.
   */
  padConformMm: number

  layerHeightMm: number
}

export const HOLDER: HolderConfig = {
  // 1.0 + 0.7 + 0.3 = 2.0, which is the card's slot exactly. Settled on the
  // bench: the ladder coupon's fourth blade won, and it is also the limit --
  // a bigger lip has to come out of the blade or out of the clearance, and
  // the blade is already down to two and a half extrusions.
  bladeThicknessMm: 1.0,
  bladeLengthMm: 24,
  bladeLipMm: 0.7,
  bladeLipRunMm: 1.2,
  fitMm: 0.3,

  bodyThicknessMm: 3.2,
  bodyHeightMm: 22,
  bodyCornerRadiusMm: 2,

  boardThicknessMm: 5,
  prongHeightMm: 9.5,
  prongCatchDropMm: 5,
  prongCatchThicknessMm: 3.2,
  prongTopBelowTopMm: 0,

  padSideMm: 3,
  padHeightMm: 24,
  padConformMm: 0.35,

  layerHeightMm: 0.2,
}

export interface HolderDerived {
  widthMm: number
  heightMm: number
  /** x centres of the blades, which on a Skadis bar are also the prongs'. */
  bladeCentresMm: number[]
  cardPitchMm: number
  /** Blade top, measured up from the body's bottom edge. */
  bladeTopMm: number
  bladeBottomMm: number
  /** The lip's top, which is flush with the body's -- see `printNote`. */
  lipTopMm: number
  /** The gap the card's own thickness sits in, between body face and lip. */
  troughMm: number
  bladeProjectionMm: number
  /** How far a card lifts before it clears the lip. */
  releaseLiftMm: number
  /** The deepest the part reaches behind the body's back face. */
  backReachMm: number
  prongWidthMm: number
  prongTopMm: number
  /** Clear air between a hanging card's bottom and the next bar down. */
  stackPitchMm: number
  cardGapMm: number
  /**
   * The tightest drum this pad can sit on and still have its edges inside the
   * foam's reach. Flat faces are always fine; anything rounder than this wants
   * a different mount.
   */
  minFlatRadiusMm: number
}

const hangOf = (card: CardConfig) => cardHang(card)

export function derive(
  cfg: HolderConfig, spec: HolderSpec, card: CardConfig = CARD_50x30,
): HolderDerived {
  const hang = hangOf(card)
  const cardPitchMm = SKADIS.columnPitchMm
  const troughMm = hang.cardThicknessMm + cfg.fitMm
  const bladeProjectionMm = troughMm + cfg.bladeLipRunMm

  const skadis = spec.back === 'skadis'
  // On a Skadis bar the board sets everything: the bar spans whole columns and
  // a blade stands at each column's centre, so a card always hangs over a slot.
  const widthMm = skadis
    ? spec.count * cardPitchMm
    : (spec.count - 1) * cardPitchMm + cfg.bladeLengthMm + 2 * cfg.padSideMm
  const heightMm = skadis ? cfg.bodyHeightMm : cfg.padHeightMm

  const first = skadis ? cardPitchMm / 2 : widthMm / 2 - ((spec.count - 1) * cardPitchMm) / 2
  const bladeCentresMm = Array.from({ length: spec.count }, (_, i) => first + i * cardPitchMm)

  // The lip's top is FLUSH with the body's top, and that is a print decision
  // rather than a styling one -- see `printNote`.
  const lipTopMm = heightMm
  const bladeTopMm = lipTopMm - cfg.bladeLipMm
  const bladeBottomMm = bladeTopMm - cfg.bladeThicknessMm

  return {
    widthMm,
    heightMm,
    bladeCentresMm,
    cardPitchMm,
    bladeTopMm,
    bladeBottomMm,
    lipTopMm,
    troughMm,
    bladeProjectionMm,
    // A card rides up until its slot's top clears the lip's.
    releaseLiftMm: cfg.bladeLipMm,
    backReachMm: skadis ? cfg.boardThicknessMm + cfg.prongCatchThicknessMm : 0,
    prongWidthMm: SKADIS.slotWidthMm - 2 * cfg.fitMm,
    prongTopMm: heightMm - cfg.prongTopBelowTopMm,
    // Two column steps, so every bar's prongs land on a real same-column slot.
    stackPitchMm: 2 * SKADIS.columnPitchMm,
    cardGapMm: cardPitchMm - hang.portraitWidthMm,
    // Invert the sagitta: the R at which a pad this wide stands off by exactly
    // what the foam takes up.
    minFlatRadiusMm: (widthMm * widthMm / 4 + cfg.padConformMm ** 2) / (2 * cfg.padConformMm),
  }
}

/**
 * Why the Skadis bar prints standing on its top edge: it has features on BOTH
 * faces -- blades forward, prongs back -- so neither face can lie on the bed.
 * Stood on its top edge, the bed plane is the body-top/lip-top plane, every
 * lip starts ON the bed rather than as an island in mid-air, and from there
 * material only ever ends as the print rises. That is the same rule the rack's
 * cleat bevel is cut to.
 */
export const printNote = (spec: HolderSpec): string => spec.back === 'skadis'
  ? 'stand it on its top edge (the face the lips are flush with), brim on, no supports'
  : 'back face down on the bed, so the adhesive face is the bed face. No supports.'

export const holderName = (spec: HolderSpec): string =>
  spec.back === 'skadis' ? `swatch_bar_${spec.count}col` : `swatch_pad_${spec.count}up`

export function checkConfig(
  cfg: HolderConfig, spec: HolderSpec, card: CardConfig = CARD_50x30,
): string[] {
  const issues: string[] = []
  const hang = hangOf(card)
  const d = derive(cfg, spec, card)

  if (!Number.isInteger(spec.count) || spec.count < 1) {
    issues.push('a holder carries a whole number of cards, at least one')
    return issues
  }

  // THE rule. The card's slot is the entire budget for anything through it.
  const stack = cfg.bladeThicknessMm + cfg.bladeLipMm + cfg.fitMm
  if (stack > hang.slotWidthMm + 1e-9) {
    issues.push(
      `a ${cfg.bladeThicknessMm} mm blade with a ${cfg.bladeLipMm} mm lip and `
      + `${cfg.fitMm} mm of fit needs ${stack.toFixed(2)} mm to pass the card's `
      + `${hang.slotWidthMm} mm slot -- the card would have to be bent on and off`,
    )
  }
  if (cfg.bladeLipMm <= 0) {
    issues.push('with no lip a card slides off the blade forwards, and rattles until it does')
  }
  if (cfg.bladeThicknessMm < 0.8) {
    issues.push(`a ${cfg.bladeThicknessMm} mm blade is under two extrusions`)
  }
  if (cfg.bladeLengthMm + 2 * cfg.fitMm > hang.slotLengthMm) {
    issues.push(
      `a ${cfg.bladeLengthMm} mm blade will not enter a ${hang.slotLengthMm} mm slot`,
    )
  }
  if (cfg.bladeLengthMm < 0.5 * hang.portraitWidthMm) {
    issues.push(
      `a ${cfg.bladeLengthMm} mm blade is too short to hold a `
      + `${hang.portraitWidthMm} mm card square`,
    )
  }
  if (cfg.bladeLipRunMm < 2 * cfg.layerHeightMm) {
    issues.push('the lip is thinner than two layers and will not survive a card going on')
  }
  if (d.bladeBottomMm < 0) {
    issues.push('the body is shorter than the blade it carries')
  }

  if (spec.back === 'skadis') {
    const entry = cfg.prongHeightMm + cfg.prongCatchDropMm
    if (entry > SKADIS.slotHeightMm - cfg.fitMm) {
      issues.push(
        `a ${cfg.prongHeightMm} mm shank and a ${cfg.prongCatchDropMm} mm catch are `
        + `${entry} mm, which will not enter a ${SKADIS.slotHeightMm} mm Skadis slot`,
      )
    }
    const solidBelow = SKADIS.columnPitchMm - SKADIS.slotHeightMm
    if (cfg.prongCatchDropMm > solidBelow) {
      issues.push(
        `a ${cfg.prongCatchDropMm} mm catch drops past the ${solidBelow} mm of solid `
        + 'board below the slot and fouls the slot beneath it',
      )
    }
    if (cfg.prongCatchDropMm < 2) {
      issues.push('a catch under 2 mm has too little board to hold on to')
    }
    if (d.prongWidthMm < 2) {
      issues.push(`a ${d.prongWidthMm} mm prong is too thin for the load path`)
    }
    if (cfg.bodyHeightMm < cfg.prongTopBelowTopMm + cfg.prongHeightMm + cfg.prongCatchDropMm + 2) {
      issues.push(
        'the body has no material below its prongs to bear on the board, so the bar '
        + 'will pivot on them',
      )
    }
    const [plateX] = BAMBU_X2D.buildMm
    const dual = BAMBU_X2D.dualNozzleBuildMm?.[0] ?? plateX
    if (d.widthMm > plateX! - 6) {
      issues.push(
        `a ${spec.count}-column bar is ${d.widthMm} mm and will not fit the `
        + `${plateX} mm plate`,
      )
    } else if (d.widthMm > dual - 6) {
      issues.push(
        `a ${spec.count}-column bar is ${d.widthMm} mm, which fits the ${plateX} mm `
        + `plate but not the ${dual} mm dual-nozzle one -- print it single-nozzle, `
        + 'or drop a column',
      )
    }
  }

  if (d.cardGapMm < 2) {
    issues.push(
      `cards ${hang.portraitWidthMm} mm wide on a ${d.cardPitchMm} mm pitch leave `
      + `${d.cardGapMm.toFixed(1)} mm between them -- too little to get a finger in`,
    )
  }

  return issues
}

/** How far a flat plate of width `w` stands off a drum of radius `r` at its edges. */
export function sagittaMm(w: number, r: number): number {
  if (r <= 0 || w / 2 >= r) return Infinity
  return r - Math.sqrt(r * r - (w / 2) * (w / 2))
}

/** What `--back all` builds: a bar for the shelf and a single for everything else. */
export const holderList = (): HolderSpec[] => [
  { back: 'skadis', count: 5 },
  { back: 'pad', count: 1 },
]
