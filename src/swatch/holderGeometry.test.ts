import assert from 'node:assert/strict'
import { test } from 'vitest'
import { bandVolume } from '../geometry/bands.ts'
import { difference, intersection } from '../geometry/boolean.ts'
import { checkManifold } from '../geometry/mesh.ts'
import { roundedRectRing } from '../geometry/primitives.ts'
import { SKADIS, skadisSlotCentres } from '../geometry/skadis.ts'
import { multiArea } from '../geometry/vec.ts'
import type { MultiPolygon } from '../geometry/vec.ts'
import { BAMBU_X2D } from '../model/machines.ts'
import { CARD_50x30, cardHang } from './card.ts'
import { HOLDER, derive, holderList, holderName } from './holder.ts'
import type { HolderSpec } from './holder.ts'
import {
  bandsFor, bladeBands, buildBladeLadder, buildHolder, cardOutlineAt, cardSlotAt,
} from './holderGeometry.ts'

const BAR: HolderSpec = { back: 'skadis', count: 5 }
const PAD: HolderSpec = { back: 'pad', count: 1 }

const area = (mp: MultiPolygon): number => Math.abs(multiArea(mp))

test('every holder is watertight', () => {
  for (const spec of holderList()) {
    const report = checkManifold(buildHolder(HOLDER, spec).mesh)
    assert.equal(report.danglingEdges, 0, `${holderName(spec)} leaks`)
    assert.ok(report.volume > 0, `${holderName(spec)} is inside out`)
  }
})

test('every holder volume equals its band areas times their depths', () => {
  for (const spec of holderList()) {
    const holder = buildHolder(HOLDER, spec)
    const fromBands = bandVolume(holder.bands)
    const fromMesh = checkManifold(holder.mesh).volume
    assert.ok(
      Math.abs(fromBands - fromMesh) / fromMesh < 1e-6,
      `${holderName(spec)}: bands ${fromBands.toFixed(3)} vs mesh ${fromMesh.toFixed(3)}`,
    )
  }
})

test('every holder fits the plate', () => {
  const [x, y, z] = BAMBU_X2D.buildMm
  for (const spec of holderList()) {
    const [x0, y0, z0, x1, y1, z1] = buildHolder(HOLDER, spec).mesh.bbox
    // Printed standing, the bar's length lies along the plate and its height
    // becomes the print's Z -- which is the shallowest of the three.
    const dims = [x1 - x0, y1 - y0, z1 - z0].sort((a, b) => b - a)
    const plate = [x!, y!, z!].sort((a, b) => b - a)
    for (let i = 0; i < 3; i++) assert.ok(dims[i]! <= plate[i]!, holderName(spec))
  }
})

test('every back emits the identical blade', () => {
  // The design's whole promise: a card comes off one mount and goes onto
  // another with the same motion, because the thing it engages is the same
  // thing. Normalise each blade to its own origin and they must agree.
  const round = (mp: MultiPolygon) =>
    mp.map(p => p.map(r => r.map(([px, py]) => [
      Math.round(px * 1e4) / 1e4, Math.round(py * 1e4) / 1e4,
    ])))
  const normalise = (spec: HolderSpec) => {
    const d = derive(HOLDER, spec)
    const { trough, lip } = bladeBands(HOLDER, spec)
    const cx = d.bladeCentresMm[0]!
    const shift = (mp: MultiPolygon): MultiPolygon =>
      mp.slice(0, 1).map(p => p.map(r => r.map(([px, py]) =>
        [px - cx, py - d.bladeTopMm] as const)))
    return { trough: round(shift(trough)), lip: round(shift(lip)) }
  }
  const bar = normalise(BAR)
  const pad = normalise(PAD)
  assert.deepEqual(bar.trough, pad.trough)
  assert.deepEqual(bar.lip, pad.lip)
})

test('a blade passes through the card own hang slot', () => {
  // Against the real slot from cardHang(), not a number repeated here.
  for (const spec of holderList()) {
    const { trough } = bladeBands(HOLDER, spec)
    const slot = cardSlotAt(HOLDER, spec, 0)
    const blade0: MultiPolygon = [trough[0]!]
    assert.ok(
      area(difference(blade0, slot)) < 1e-6,
      `${holderName(spec)}: the blade does not fit the card's slot`,
    )
  }
})

test('a seated card cannot come off without lifting', () => {
  // The lip stands above the slot's top edge, so pulling straight forward
  // fouls it. This is the other half of the same geometry: if it ever became
  // empty, the blade would still fit but nothing would hold a card on.
  for (const spec of holderList()) {
    const { lip } = bladeBands(HOLDER, spec)
    const slot = cardSlotAt(HOLDER, spec, 0)
    const proud = difference([lip[0]!], slot)
    assert.ok(area(proud) > 0.5, `${holderName(spec)}: nothing retains a card`)
  }
})

test('the blade clears the slot once the card is lifted', () => {
  // Lift the card by exactly the release lift and the whole blade, lip and all,
  // has to sit inside the slot -- otherwise it jams rather than releasing.
  const d = derive(HOLDER, BAR)
  const hang = cardHang(CARD_50x30)
  const { lip } = bladeBands(HOLDER, BAR)
  const cx = d.bladeCentresMm[0]!
  const lifted: MultiPolygon = [[roundedRectRing(
    cx - hang.slotLengthMm / 2, d.bladeTopMm - hang.slotWidthMm + d.releaseLiftMm,
    hang.slotLengthMm, hang.slotWidthMm, hang.slotRadiusMm, 16,
  )]]
  assert.ok(area(difference([lip[0]!], lifted)) < 1e-6, 'the lifted card still fouls the lip')
})

test('nothing on the bar stands above its top edge', () => {
  // The print-orientation rule as a test. The bar is stood on its top edge, so
  // every lip starts ON the bed; anything proud of that plane would be an
  // island in mid-air instead.
  for (const spec of holderList()) {
    const d = derive(HOLDER, spec)
    let top = -Infinity
    for (const band of bandsFor(HOLDER, spec)) {
      for (const poly of band.region) for (const ring of poly) {
        for (const [, y] of ring) top = Math.max(top, y)
      }
    }
    assert.ok(Math.abs(top - d.heightMm) < 1e-6, `${holderName(spec)} reaches ${top}`)
  }
})

test('every prong starts on the bed, not part way up the print', () => {
  // The bar is printed standing on its top edge, so a feature whose top is
  // below the body's is a ledge hanging in mid-air. The first coupon had the
  // prongs 4 mm down and they printed drooped -- which is what made the hook
  // weak, not its thickness alone. Only the blade may start late: its 2.3 mm
  // run is a bridge from the body to the lip, anchored at both ends.
  const d = derive(HOLDER, BAR)
  const bands = bandsFor(HOLDER, BAR)
  const behind = bands.filter(b => b.z1 <= 0)
  assert.equal(behind.length, 2, 'expected a shank band and a catch band')
  for (const band of behind) {
    let top = -Infinity
    for (const poly of band.region) for (const ring of poly) {
      for (const [, y] of ring) top = Math.max(top, y)
    }
    assert.ok(
      Math.abs(top - d.heightMm) < 1e-6,
      `a prong band starts ${(d.heightMm - top).toFixed(1)} mm up the print`,
    )
  }
})

test('the catch has more section than the slot would ever allow across its width', () => {
  // The catch is a cantilever bending about its own thickness. Width cannot
  // help it -- the catch has to pass through a 5 mm Skadis slot on the way in,
  // so it is capped at slotWidth - 2 x fit. Thickness is the only axis left.
  const d = derive(HOLDER, BAR)
  assert.ok(d.prongWidthMm <= SKADIS.slotWidthMm - 2 * HOLDER.fitMm)
  assert.ok(
    HOLDER.prongCatchThicknessMm > d.prongWidthMm / 2,
    'the catch is thinner than half the only width it is allowed',
  )
})

test('every prong lands on the board own slot grid', () => {
  const d = derive(HOLDER, BAR)
  // A bar hung with its left edge on the board's left edge: its prongs must
  // coincide with slots the board actually has.
  const columns = new Set(skadisSlotCentres(360, 560).map(([x]) => x))
  for (const cx of d.bladeCentresMm) {
    assert.ok(columns.has(cx), `no Skadis slot at x = ${cx}`)
  }
  assert.equal(d.prongWidthMm, SKADIS.slotWidthMm - 2 * HOLDER.fitMm)
})

test('a prong fits the slot it goes into', () => {
  const d = derive(HOLDER, BAR)
  const cx = d.bladeCentresMm[0]!
  const bottom = d.prongTopMm - HOLDER.prongHeightMm
  const prong: MultiPolygon = [[roundedRectRing(
    cx - d.prongWidthMm / 2, bottom, d.prongWidthMm, HOLDER.prongHeightMm,
    d.prongWidthMm / 2, 16,
  )]]
  // The real slot, seated: the shank's bottom rests on the slot's lower edge.
  const slot: MultiPolygon = [[roundedRectRing(
    cx - SKADIS.slotWidthMm / 2, bottom, SKADIS.slotWidthMm, SKADIS.slotHeightMm,
    SKADIS.slotRadiusMm, 16,
  )]]
  assert.ok(area(difference(prong, slot)) < 1e-6, 'the prong does not fit a Skadis slot')
})

test('two cards hanging shoulder to shoulder do not touch', () => {
  const a = cardOutlineAt(HOLDER, BAR, 0)
  const b = cardOutlineAt(HOLDER, BAR, 1)
  assert.equal(area(intersection(a, b)), 0)
})

test('a hanging card does not cover its own thickness ladder', () => {
  // The ladder is the only thing on a card that is not also printed on the
  // label, and it lives in the bottom 13 mm. Nothing may overlap cards.
  const hang = cardHang(CARD_50x30)
  const d = derive(HOLDER, BAR)
  const ladderTop = d.bladeTopMm - hang.slotWidthMm / 2 - hang.ladderTopBelowHangMm
  assert.ok(ladderTop < 0, 'the ladder should hang clear below the bar')
  assert.ok(hang.ladderBottomBelowHangMm - hang.ladderTopBelowHangMm > 9)
})

test('the blade ladder coupon carries one blade per variant and is watertight', () => {
  const variants = [
    { bladeThicknessMm: 1.6, bladeLipMm: 0.0 },
    { bladeThicknessMm: 1.4, bladeLipMm: 0.2 },
    { bladeThicknessMm: 1.2, bladeLipMm: 0.5 },
    { bladeThicknessMm: 1.0, bladeLipMm: 0.7 },
  ]
  const coupon = buildBladeLadder(HOLDER, variants)
  const report = checkManifold(coupon.mesh)
  assert.equal(report.danglingEdges, 0)
  assert.ok(report.volume > 0)
  // Each variant spends the card's 2 mm slot differently, and one of them is
  // over -- 1.6 + 0.0 + 0.3 is 1.9, 1.0 + 0.7 + 0.3 is 2.0.
  const hang = cardHang(CARD_50x30)
  for (const v of variants) {
    assert.ok(v.bladeThicknessMm + v.bladeLipMm + HOLDER.fitMm <= hang.slotWidthMm + 1e-9)
  }
})
