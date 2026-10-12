// The pocket's mesh. Numbers live in pocket.ts.
//
// Frame: z is out of the face the sleeve is mounted on, z = 0 is the back of
// the back plate. x runs along the sleeve, y is up, origin at the lower-left
// of the back plate. Three bands, all prisms along z:
//
//   [0, back]                 the back plate, solid
//   [back, +cavity]           walls and floor, cavity open at the front and top
//   [+lipRun]                 the same, with the front rails reaching in
//
// The cavity is open at the TOP in every band, which is how the card drops in
// and also what makes this printable with the back plate on the bed: nothing
// ever has to bridge across the opening.
import { difference } from '../geometry/boolean.ts'
import type { Band } from '../geometry/bands.ts'
import { meshFromBands } from '../geometry/bands.ts'
import { roundedRectRing } from '../geometry/primitives.ts'
import type { Mesh } from '../geometry/mesh.ts'
import type { MultiPolygon } from '../geometry/vec.ts'
import { CARD_50x30 } from './card.ts'
import type { CardConfig } from './card.ts'
import { derive } from './pocket.ts'
import type { PocketConfig } from './pocket.ts'

const ARC_SEGS = 16
const ring = (x: number, y: number, w: number, h: number, r: number): MultiPolygon =>
  [[roundedRectRing(x, y, w, h, r, ARC_SEGS)]]

/**
 * A cavity open at the top: drawn taller than the sleeve and clipped by the
 * outline, so the opening really is an opening and not a 0.1 mm lid.
 */
const openCavity = (
  cfg: PocketConfig, x0: number, w: number, top: number,
): MultiPolygon => ring(x0, cfg.wallMm, w, top, 0.6)

export function bandsFor(cfg: PocketConfig, card: CardConfig = CARD_50x30): Band[] {
  const d = derive(cfg, card)
  const outline = ring(0, 0, d.widthMm, d.heightMm, 2)
  // Past the top of the sleeve, so the difference leaves the mouth open.
  const over = d.heightMm
  const cavity = openCavity(cfg, cfg.wallMm, d.cavityWidthMm, over)
  const window = openCavity(cfg, cfg.wallMm + cfg.lipMm, d.windowWidthMm, over)

  const z1 = cfg.backMm
  const z2 = z1 + d.cavityDepthMm
  return [
    { z0: 0, z1, region: outline },
    { z0: z1, z1: z2, region: difference(outline, cavity) },
    { z0: z2, z1: z2 + cfg.lipRunMm, region: difference(outline, window) },
  ]
}

export const buildPocket = (cfg: PocketConfig, card: CardConfig = CARD_50x30): Mesh =>
  meshFromBands(bandsFor(cfg, card))

/** Where a seated card sits, for checking it clears what it is mounted on. */
export function cardSeat(
  cfg: PocketConfig, card: CardConfig = CARD_50x30,
): { x0: number; y0: number; z0: number; widthMm: number; heightMm: number } {
  const d = derive(cfg, card)
  return {
    x0: cfg.wallMm + cfg.fitMm / 2,
    y0: cfg.wallMm,
    z0: cfg.backMm,
    widthMm: d.cavityWidthMm - cfg.fitMm,
    // The card's full height, most of it inside the sleeve and `tabMm` proud.
    heightMm: d.gripMm + d.tabMm,
  }
}
