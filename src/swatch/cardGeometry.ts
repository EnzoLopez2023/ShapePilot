// The swatch card's mesh. Numbers live in card.ts.
//
// Every feature is a 2D region extruded straight up, so the card is a stack of
// z-bands and there is no CSG -- the same pipeline as src/rack/ and the trays.
import { difference, intersection } from '../geometry/boolean.ts'
import type { Band } from '../geometry/bands.ts'
import { meshFromBands } from '../geometry/bands.ts'
import { roundedRectRing } from '../geometry/primitives.ts'
import type { Mesh } from '../geometry/mesh.ts'
import type { MultiPolygon } from '../geometry/vec.ts'
import { ARC_SEGS, derive } from './card.ts'
import type { CardConfig } from './card.ts'

const ring = (x: number, y: number, w: number, h: number, r: number): MultiPolygon =>
  [[roundedRectRing(x, y, w, h, r, ARC_SEGS)]]

/**
 * The card as a stack of z-bands, thinnest feature first. Each band is the
 * card's outline less every feature whose floor is at or below that band --
 * the ladder windows drop out one by one as z rises past their thickness, and
 * the label pocket drops out for the top band only.
 */
export function bandsFor(cfg: CardConfig): Band[] {
  const d = derive(cfg)
  const steps = [...cfg.ladderStepsMm].sort((a, b) => a - b)
  const bandHeight = d.ladderHeightMm / steps.length
  const ladderY0 = cfg.borderMm + (d.pocketHeightMm - d.ladderHeightMm) / 2

  const outline = ring(0, 0, d.cardWidthMm, d.cardHeightMm, cfg.cardCornerRadiusMm)
  // A stadium: a rounded rectangle whose radius is its own half-width.
  const slotHeight = d.cardHeightMm - 2 * cfg.borderMm
  const slot = ring(
    (d.slotZoneMm - cfg.slotWidthMm) / 2, cfg.borderMm,
    cfg.slotWidthMm, slotHeight, cfg.slotWidthMm / 2,
  )
  const label = ring(
    d.slotZoneMm, cfg.borderMm, d.pocketWidthMm, d.pocketHeightMm, 2,
  )
  // The ladder is ONE pocket with a stepped floor, not a row of separate slots:
  // only its outside corners are relieved, and the step edges run straight
  // across it. So each window is the pocket clipped to its own band, which
  // leaves the radius on the two ends of the ladder and nowhere else.
  const ladder = ring(
    d.ladderX0, ladderY0, cfg.ladderWidthMm, d.ladderHeightMm, cfg.ladderCornerRadiusMm,
  )
  const windows = steps.map((_, i) => intersection(ladder, ring(
    d.ladderX0, ladderY0 + i * bandHeight, cfg.ladderWidthMm, bandHeight, 0,
  )))

  const labelFloor = cfg.cardThicknessMm - cfg.labelDepthMm
  const levels = [...new Set([0, ...steps, labelFloor, cfg.cardThicknessMm])]
    .sort((a, b) => a - b)

  const bands: Band[] = []
  for (let i = 0; i < levels.length - 1; i++) {
    const z0 = levels[i]!, z1 = levels[i + 1]!
    let region = difference(outline, slot)
    // A window's material ends at its own thickness, so every band above it is
    // missing it. `>=` and not `>`: at z0 == t the window's floor is behind us.
    steps.forEach((t, w) => { if (z0 >= t - 1e-9) region = difference(region, windows[w]!) })
    if (z0 >= labelFloor - 1e-9) region = difference(region, label)
    bands.push({ z0, z1, region })
  }
  return bands
}

/** The card's hang slot as a region, for anything that has to pass through it. */
export function slotRegion(cfg: CardConfig): MultiPolygon {
  const d = derive(cfg)
  return ring(
    (d.slotZoneMm - cfg.slotWidthMm) / 2, cfg.borderMm,
    cfg.slotWidthMm, d.cardHeightMm - 2 * cfg.borderMm, cfg.slotWidthMm / 2,
  )
}

/** The card's outline, for laying cards out next to each other. */
export const outlineRegion = (cfg: CardConfig): MultiPolygon => {
  const d = derive(cfg)
  return ring(0, 0, d.cardWidthMm, d.cardHeightMm, cfg.cardCornerRadiusMm)
}

export const buildCard = (cfg: CardConfig): Mesh => meshFromBands(bandsFor(cfg))
