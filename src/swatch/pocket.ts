// A sleeve a swatch card drops into, landscape, label upright.
//
// The other two mounts hang a card from a blade through its slot, which needs
// the card portrait and a face for it to hang clear of. This one is for a face
// that is about the size of a card and has nothing below it to hang into -- the
// end of a desiccant box, say. The card slides down into a channel, its own
// weight holds it, and the label reads the right way up.
//
// It is deliberately NOT a third `HolderBack`. src/swatch/holder.ts promises
// that every back it builds emits the identical blade, which is what makes a
// card transfer between them with one motion; a pocket has no blade, and
// folding it in would make that promise untestable. Different family, own file,
// same card -- both read the card through `cardHang()`.
import { CARD_50x30, cardHang } from './card.ts'
import type { CardConfig } from './card.ts'

export interface PocketConfig {
  /** Added to the card's own size, halved on each side. */
  fitMm: number
  /** Side walls and floor. */
  wallMm: number
  /**
   * The sleeve's outside corners.
   *
   * It has to stay UNDER `wallMm`. The cavity's side runs up at x = wallMm, so
   * a bigger radius means that edge cuts through the corner arc instead of
   * meeting the straight top, which pinches each wall to a point and leaves an
   * edge shared by four faces. The mesh is still closed and still has positive
   * volume -- it just is not a manifold, and a slicer will say so.
   */
  cornerRadiusMm: number
  /**
   * The plate behind the card. On a perforated box this is also what gives the
   * card a flat seat instead of a row of slots to catch on.
   */
  backMm: number
  /** How far the front rails reach in over the card's edges. */
  lipMm: number
  lipRunMm: number
  /**
   * The sleeve's own height. Shorter than the card on purpose: what sticks out
   * of the top is the part you pinch to lift it.
   */
  heightMm: number
  layerHeightMm: number
}

export const POCKET: PocketConfig = {
  fitMm: 0.6,
  wallMm: 1.6,
  cornerRadiusMm: 1.2,
  backMm: 1.6,
  lipMm: 2,
  lipRunMm: 1.2,
  heightMm: 28,
  layerHeightMm: 0.2,
}

export interface PocketDerived {
  /** Outer size of the sleeve, seen from the front. */
  widthMm: number
  heightMm: number
  /** How far it stands off the face it is mounted on. */
  depthMm: number
  /** The card's own slot, widened by the fit. */
  cavityWidthMm: number
  cavityDepthMm: number
  /** Sleeve floor to the top of the sleeve: how much card is held. */
  gripMm: number
  /** How much card stands proud of the sleeve, to pinch. */
  tabMm: number
  /** The clear window the label reads through. */
  windowWidthMm: number
}

export function derive(cfg: PocketConfig, card: CardConfig = CARD_50x30): PocketDerived {
  const hang = cardHang(card)
  // Landscape: the card lies the long way, so its label reads upright.
  const cavityWidthMm = hang.portraitHeightMm + cfg.fitMm
  const cavityDepthMm = hang.cardThicknessMm + cfg.fitMm
  const gripMm = cfg.heightMm - cfg.wallMm
  return {
    widthMm: cavityWidthMm + 2 * cfg.wallMm,
    heightMm: cfg.heightMm,
    depthMm: cfg.backMm + cavityDepthMm + cfg.lipRunMm,
    cavityWidthMm,
    cavityDepthMm,
    gripMm,
    tabMm: hang.portraitWidthMm - gripMm,
    windowWidthMm: cavityWidthMm - 2 * cfg.lipMm,
  }
}

export function checkConfig(cfg: PocketConfig, card: CardConfig = CARD_50x30): string[] {
  const issues: string[] = []
  const hang = cardHang(card)
  const d = derive(cfg, card)

  if (cfg.fitMm <= 0) {
    issues.push('a card has to be able to drop in, so the cavity needs to be bigger than the card')
  }
  if (cfg.wallMm < 0.8) issues.push(`a ${cfg.wallMm} mm wall is under two extrusions`)
  if (cfg.cornerRadiusMm >= cfg.wallMm) {
    issues.push(
      `a ${cfg.cornerRadiusMm} mm corner on a ${cfg.wallMm} mm wall pinches the wall tops `
      + 'to a point -- the corner radius has to stay under the wall thickness',
    )
  }
  if (cfg.backMm < 0.8) issues.push(`a ${cfg.backMm} mm back is under two extrusions`)
  if (cfg.lipMm <= 0) issues.push('with no lip the card falls out of the front')
  if (cfg.lipRunMm < 2 * cfg.layerHeightMm) {
    issues.push('the lip is thinner than two layers and will break off')
  }
  // The lips are a bridge across the cavity in the print, so they cannot be so
  // deep that the card can no longer pass behind them.
  if (2 * cfg.lipMm >= d.cavityWidthMm) {
    issues.push('the lips meet in the middle -- there is no window left to read the label through')
  }
  if (d.gripMm <= 0) issues.push('the sleeve is shorter than its own floor')
  if (d.gripMm < hang.portraitWidthMm / 2) {
    issues.push(
      `${d.gripMm} mm of grip on a ${hang.portraitWidthMm} mm card is under half its `
      + 'height -- it will lean out of the sleeve',
    )
  }
  if (d.tabMm < 3) {
    issues.push(
      `only ${d.tabMm.toFixed(1)} mm of card stands proud, which is not enough to pinch`,
    )
  }
  if (d.tabMm > hang.portraitWidthMm / 2) {
    issues.push('more than half the card is out of the sleeve')
  }
  return issues
}
