// The filament swatch card: a printed tag that carries a 50 x 30 mm label, a
// thickness ladder, and a slot to hang it by.
//
// A redraw of the widely-printed "Swatch 48" card (48 x 24 x 2, a 30.25 x 20.1
// label pocket) for a label maker that prints 50 x 30 mm. The pocket has to grow
// to the label, and everything else on the card is measured from the pocket, so
// the card grows with it -- there is no way to keep the 48 mm outline and still
// seat the label.
//
// Everything the original says about the filament is preserved: the same hang
// slot, the same 0.5 mm label recess, and the same thickness ladder (0.2 / 0.4 /
// 0.6 / 0.8 mm windows) that shows how the colour reads when the light comes
// through it. Only the ladder's BANDS get taller, so the four numbers you can
// compare between two cards stay the same numbers.
//
// This module is the card's numbers. The mesh is in cardGeometry.ts and the CLI
// is scripts/build-filament-swatch.ts -- the same split as src/rack/.
import { SKADIS } from '../geometry/skadis.ts'

/** Corner arcs. 24 a quarter is past what a 0.4 nozzle can resolve at r=3. */
export const ARC_SEGS = 24

export interface CardConfig {
  /** The label as the label maker prints it, before any clearance. */
  labelWidthMm: number
  labelHeightMm: number
  /**
   * Added to each label dimension, halved on each side. The original card ran
   * 0.25 wide and 0.1 tall on a 30 x 20 label, which is tighter than a peeled
   * label wants to be placed by hand -- 0.4 is one extrusion of slack and
   * still reads as a seated label rather than a floating one.
   */
  labelClearanceMm: number
  /** Recess depth. Deep enough to trap the edges, shallow enough to stay flush. */
  labelDepthMm: number
  cardThicknessMm: number
  cardCornerRadiusMm: number
  /**
   * The frame: card edge to the nearest pocket. The original ran it at 1.6 mm
   * on the right and 1.8 mm top and bottom, which is a card you hold by its
   * pockets. The slot edge is the exception -- see `slotWallMm`.
   */
  borderMm: number
  /** Label pocket to ladder pocket. Interior, so the border does not set it. */
  dividerMm: number
  slotWidthMm: number
  /**
   * Material each side of the hang slot. This, not the border, sets the slot
   * edge's width: at a 3 mm border a 2 mm slot would leave 0.5 mm walls, which
   * is under one extrusion pair. 1 mm is what the original card used and held.
   */
  slotWallMm: number
  ladderWidthMm: number
  ladderCornerRadiusMm: number
  /** Window thicknesses, thinnest first. Each gets an equal band of the pocket. */
  ladderStepsMm: readonly number[]
}

/** Everything but the label, which is whatever your label maker prints. */
export const CARD: Omit<CardConfig, 'labelWidthMm' | 'labelHeightMm'> = {
  labelClearanceMm: 0.4,
  labelDepthMm: 0.5,
  cardThicknessMm: 2,
  cardCornerRadiusMm: 3,
  borderMm: 3,
  dividerMm: 2,
  slotWidthMm: 2,
  slotWallMm: 1,
  ladderWidthMm: 10,
  ladderCornerRadiusMm: 1,
  ladderStepsMm: [0.2, 0.4, 0.6, 0.8],
}

/** The shipped card: the one in models/, and the one every holder is cut for. */
export const CARD_50x30: CardConfig = { ...CARD, labelWidthMm: 50, labelHeightMm: 30 }

/** More windows keep the original's 0.2 mm rung and carry on up. */
export const ladderSteps = (count: number): number[] =>
  Array.from({ length: count }, (_, i) => Number(((i + 1) * 0.2).toFixed(2)))

export interface CardDerived {
  /** The slot edge, which is the border unless the slot needs more than that. */
  slotZoneMm: number
  cardWidthMm: number
  cardHeightMm: number
  pocketWidthMm: number
  pocketHeightMm: number
  ladderX0: number
  ladderHeightMm: number
}

/**
 * The card is laid out from the pocket outwards, so the label is what sets
 * every outside dimension. x runs along the card, y across it.
 */
export function derive(cfg: CardConfig): CardDerived {
  const pocketWidthMm = cfg.labelWidthMm + cfg.labelClearanceMm
  const pocketHeightMm = cfg.labelHeightMm + cfg.labelClearanceMm
  const slotZoneMm = Math.max(cfg.borderMm, cfg.slotWidthMm + 2 * cfg.slotWallMm)
  const ladderX0 = slotZoneMm + pocketWidthMm + cfg.dividerMm
  return {
    slotZoneMm,
    cardWidthMm: ladderX0 + cfg.ladderWidthMm + cfg.borderMm,
    cardHeightMm: pocketHeightMm + 2 * cfg.borderMm,
    pocketWidthMm,
    pocketHeightMm,
    ladderX0,
    // The ladder squares up with the label pocket, so the two read as one row
    // across the card rather than two features that nearly line up.
    ladderHeightMm: pocketHeightMm,
  }
}

export function checkConfig(cfg: CardConfig): string[] {
  const issues: string[] = []
  const d = derive(cfg)
  if (cfg.labelWidthMm <= 0 || cfg.labelHeightMm <= 0) issues.push('the label has no size')
  if (cfg.labelDepthMm >= cfg.cardThicknessMm) {
    issues.push(`a ${cfg.labelDepthMm} mm recess goes through a ${cfg.cardThicknessMm} mm card`)
  }
  const thickest = Math.max(...cfg.ladderStepsMm)
  if (thickest >= cfg.cardThicknessMm - cfg.labelDepthMm) {
    issues.push(`the ${thickest} mm ladder step is thicker than the card's floor under the label`)
  }
  if (cfg.borderMm < 0.8) issues.push(`a ${cfg.borderMm} mm border is under two extrusions`)
  if (d.cardHeightMm < 2 * cfg.borderMm + cfg.slotWidthMm) {
    issues.push('the card is too narrow for its own hang slot')
  }
  return issues
}

/**
 * How the card hangs -- the published interface between a card and anything
 * that holds one, and the ONLY place a holder may read these numbers from.
 *
 * The slot runs parallel to the card's short axis, near one short edge, so a
 * card hung from it hangs PORTRAIT, like a luggage tag: 36.4 wide, 69.4 tall,
 * with the label reading sideways.
 */
export interface CardHang {
  /**
   * The slot's narrow dimension -- and so the WHOLE thickness budget for
   * anything that passes through it. A blade plus whatever stands above it
   * plus clearance has to come in under this number.
   */
  slotWidthMm: number
  slotLengthMm: number
  /** Half the width: the slot is a true stadium, so its ends are semicircles. */
  slotRadiusMm: number
  /** Hanging edge to the slot's centreline. */
  slotCentreOffsetMm: number
  /**
   * The material between the slot and the card's edge -- 1.0 x 2.0 mm of PLA,
   * two or three extrusion lines, and the weakest member in the whole system.
   * Nothing that holds a card may need force to engage, and nothing may load
   * this strap on a corner.
   */
  strapMm: number
  cardThicknessMm: number
  portraitWidthMm: number
  portraitHeightMm: number
  /**
   * Where the thickness ladder lands below the hanging edge. The ladder is the
   * only thing on the card that is not also printed on the label, so a holder
   * that overlaps cards must not cover this.
   */
  ladderTopBelowHangMm: number
  ladderBottomBelowHangMm: number
}

export function cardHang(cfg: CardConfig): CardHang {
  const d = derive(cfg)
  return {
    slotWidthMm: cfg.slotWidthMm,
    slotLengthMm: d.cardHeightMm - 2 * cfg.borderMm,
    slotRadiusMm: cfg.slotWidthMm / 2,
    slotCentreOffsetMm: d.slotZoneMm / 2,
    strapMm: (d.slotZoneMm - cfg.slotWidthMm) / 2,
    cardThicknessMm: cfg.cardThicknessMm,
    // Hung from the slot, the card's long axis points down.
    portraitWidthMm: d.cardHeightMm,
    portraitHeightMm: d.cardWidthMm,
    ladderTopBelowHangMm: d.ladderX0,
    ladderBottomBelowHangMm: d.ladderX0 + cfg.ladderWidthMm,
  }
}

/**
 * Cards hang one per Skadis column. Re-exported here so a holder never has to
 * decide it: the board's own 40 mm pitch is the pitch, and the only question a
 * holder gets to ask is whether a card actually fits inside it.
 */
export const CARD_PITCH_MM = SKADIS.columnPitchMm
