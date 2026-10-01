// The holders' meshes. Numbers live in holder.ts.
//
// Frame: z is the board normal and z = 0 is the body's BACK face, so a Skadis
// bar's prongs run negative behind it and the whole part is shifted once on the
// way out -- the same trick src/rack/geometry.ts plays with `backReachMm`.
// x runs along the bar, y is up, and the origin is the body's lower-left corner.
//
// Every part here is a 2D region extruded along z. There is no CSG.
import type { Band } from '../geometry/bands.ts'
import { buildBands } from '../geometry/bands.ts'
import { union } from '../geometry/boolean.ts'
import type { Mesh } from '../geometry/mesh.ts'
import { roundedRectRing } from '../geometry/primitives.ts'
import type { MultiPolygon, Ring } from '../geometry/vec.ts'
import { CARD_50x30, cardHang } from './card.ts'
import type { CardConfig } from './card.ts'
import { derive } from './holder.ts'
import type { HolderConfig, HolderSpec } from './holder.ts'

const ARC_SEGS = 16

const rect = (x: number, y: number, w: number, h: number, r: number): Ring =>
  roundedRectRing(x, y, w, h, r, ARC_SEGS)

const multi = (rings: Ring[]): MultiPolygon => rings.map(r => [r])

export interface Holder {
  spec: HolderSpec
  mesh: Mesh
  bands: Band[]
}

/**
 * The two regions that carry a blade: the trough the card's own thickness sits
 * in, and the lip outboard of it. Published because "every back emits the
 * identical blade" is the design's whole promise, and a test proves it by
 * comparing these.
 */
export interface BladeBands {
  trough: MultiPolygon
  lip: MultiPolygon
}

export function bladeBands(
  cfg: HolderConfig, spec: HolderSpec, card: CardConfig = CARD_50x30,
): BladeBands {
  const d = derive(cfg, spec, card)
  const half = cfg.bladeLengthMm / 2
  // A stadium, so the blade's ends meet the slot's own rounded ends.
  const troughRings = d.bladeCentresMm.map(cx => rect(
    cx - half, d.bladeBottomMm, cfg.bladeLengthMm, cfg.bladeThicknessMm,
    cfg.bladeThicknessMm / 2,
  ))
  // The lip is the same blade made taller at the tip. Its corners take the
  // blade's radius so its TOP stays flat -- that face lies on the bed.
  const lipRings = d.bladeCentresMm.map(cx => rect(
    cx - half, d.bladeBottomMm, cfg.bladeLengthMm, d.lipTopMm - d.bladeBottomMm,
    cfg.bladeThicknessMm / 2,
  ))
  return { trough: multi(troughRings), lip: multi(lipRings) }
}

/**
 * The card's own hang slot, placed where a card hangs on blade `i`: the slot's
 * TOP edge rests on the blade's top, because that is what gravity does. Tests
 * use it to prove fit against the real card rather than restating its numbers.
 */
export function cardSlotAt(
  cfg: HolderConfig, spec: HolderSpec, i: number, card: CardConfig = CARD_50x30,
): MultiPolygon {
  const d = derive(cfg, spec, card)
  const hang = cardHang(card)
  const cx = d.bladeCentresMm[i]!
  return multi([rect(
    cx - hang.slotLengthMm / 2, d.bladeTopMm - hang.slotWidthMm,
    hang.slotLengthMm, hang.slotWidthMm, hang.slotRadiusMm,
  )])
}

/** A hanging card's outline, for checking that neighbours do not touch. */
export function cardOutlineAt(
  cfg: HolderConfig, spec: HolderSpec, i: number, card: CardConfig = CARD_50x30,
): MultiPolygon {
  const d = derive(cfg, spec, card)
  const hang = cardHang(card)
  const cx = d.bladeCentresMm[i]!
  // Hung from its slot: the slot's top sits on the blade, and the card's own
  // edge is `slotCentreOffsetMm` above the slot's centreline.
  const top = d.bladeTopMm + (hang.slotCentreOffsetMm - hang.slotWidthMm / 2)
  return multi([rect(
    cx - hang.portraitWidthMm / 2, top - hang.portraitHeightMm,
    hang.portraitWidthMm, hang.portraitHeightMm, 3,
  )])
}

export function bandsFor(
  cfg: HolderConfig, spec: HolderSpec, card: CardConfig = CARD_50x30,
): Band[] {
  const d = derive(cfg, spec, card)
  const body = multi([rect(0, 0, d.widthMm, d.heightMm, cfg.bodyCornerRadiusMm)])
  const blade = bladeBands(cfg, spec, card)
  const bands: Band[] = []

  if (spec.back === 'skadis') {
    const half = d.prongWidthMm / 2
    const r = d.prongWidthMm / 2
    const shank = multi(d.bladeCentresMm.map(cx => rect(
      cx - half, d.prongTopMm - cfg.prongHeightMm, d.prongWidthMm, cfg.prongHeightMm, r,
    )))
    // The catch is the shank carried on down, so the two are one solid and the
    // part that ends up behind the board is the drop.
    const catchTotal = cfg.prongHeightMm + cfg.prongCatchDropMm
    const catchRegion = multi(d.bladeCentresMm.map(cx => rect(
      cx - half, d.prongTopMm - catchTotal, d.prongWidthMm, catchTotal, r,
    )))
    bands.push({
      z0: -(cfg.boardThicknessMm + cfg.prongCatchThicknessMm),
      z1: -cfg.boardThicknessMm,
      region: catchRegion,
    })
    bands.push({ z0: -cfg.boardThicknessMm, z1: 0, region: shank })
  }

  bands.push({ z0: 0, z1: cfg.bodyThicknessMm, region: body })
  const troughZ0 = cfg.bodyThicknessMm
  bands.push({ z0: troughZ0, z1: troughZ0 + d.troughMm, region: blade.trough })
  bands.push({
    z0: troughZ0 + d.troughMm,
    z1: troughZ0 + d.troughMm + cfg.bladeLipRunMm,
    region: blade.lip,
  })
  return bands
}

export function buildHolder(
  cfg: HolderConfig, spec: HolderSpec, card: CardConfig = CARD_50x30,
): Holder {
  const d = derive(cfg, spec, card)
  const { mesh, bands } = buildBands(bandsFor(cfg, spec, card), d.backReachMm)
  return { spec, mesh, bands }
}

/** One blade variant on the ladder coupon: the pair the print has to settle. */
export interface BladeVariant {
  bladeThicknessMm: number
  bladeLipMm: number
}

/**
 * Four blades at four (thickness, lip) pairs on one small plate.
 *
 * This is the part that actually settles the design. A nominal 1.2 mm blade
 * often prints 1.3, and a nominal 2.0 mm card slot often prints 1.9 -- that is
 * 0.2 mm off a 0.3 mm clearance, and no test can see it. Print this, hang a
 * real card on each, and keep the one that engages positively and still
 * releases one-handed.
 */
export function buildBladeLadder(
  cfg: HolderConfig, variants: readonly BladeVariant[], card: CardConfig = CARD_50x30,
): Holder {
  const spec: HolderSpec = { back: 'pad', count: variants.length }
  const d = derive(cfg, spec, card)
  const body = multi([rect(0, 0, d.widthMm, d.heightMm, cfg.bodyCornerRadiusMm)])
  const half = cfg.bladeLengthMm / 2

  // Each variant keeps the lip's top flush with the body's, exactly as the real
  // parts do, so the ladder prints the same way they will.
  const troughs: Ring[] = []
  const lips: Ring[] = []
  variants.forEach((v, i) => {
    const cx = d.bladeCentresMm[i]!
    const bladeTop = d.lipTopMm - v.bladeLipMm
    const bottom = bladeTop - v.bladeThicknessMm
    troughs.push(rect(cx - half, bottom, cfg.bladeLengthMm, v.bladeThicknessMm,
      v.bladeThicknessMm / 2))
    lips.push(rect(cx - half, bottom, cfg.bladeLengthMm, d.lipTopMm - bottom,
      v.bladeThicknessMm / 2))
  })

  const troughZ0 = cfg.bodyThicknessMm
  const bands: Band[] = [
    { z0: 0, z1: cfg.bodyThicknessMm, region: body },
    { z0: troughZ0, z1: troughZ0 + d.troughMm, region: union(...multi(troughs).map(p => [p])) },
    {
      z0: troughZ0 + d.troughMm,
      z1: troughZ0 + d.troughMm + cfg.bladeLipRunMm,
      region: union(...multi(lips).map(p => [p])),
    },
  ]
  const { mesh, bands: out } = buildBands(bands)
  return { spec, mesh, bands: out }
}
