import assert from 'node:assert/strict'
import { test } from 'vitest'
import { bandVolume } from '../geometry/bands.ts'
import { checkManifold } from '../geometry/mesh.ts'
import { intersection } from '../geometry/boolean.ts'
import { rectRing } from '../geometry/primitives.ts'
import { multiArea } from '../geometry/vec.ts'
import type { MultiPolygon } from '../geometry/vec.ts'
import { CARD_50x30, cardHang } from './card.ts'
import { POCKET, checkConfig, derive } from './pocket.ts'
import { bandsFor, buildPocket, cardSeat } from './pocketGeometry.ts'

test('the shipped pocket is sound', () => {
  assert.deepEqual(checkConfig(POCKET), [])
})

test('the card lies the long way, label upright', () => {
  const hang = cardHang(CARD_50x30)
  const d = derive(POCKET)
  // Landscape: the cavity takes the card's LONG edge.
  assert.ok(d.cavityWidthMm > hang.portraitHeightMm)
  assert.ok(Math.abs(d.cavityWidthMm - hang.portraitHeightMm - POCKET.fitMm) < 1e-9)
  assert.equal(d.widthMm, 73.2)
  assert.equal(d.heightMm, 28)
})

test('the card drops in and still has something to pinch', () => {
  const hang = cardHang(CARD_50x30)
  const d = derive(POCKET)
  // Everything the sleeve does not hold is the tab.
  assert.ok(Math.abs(d.gripMm + d.tabMm - hang.portraitWidthMm) < 1e-9)
  assert.ok(d.tabMm >= 3, `${d.tabMm} mm is not enough to pinch`)
  assert.ok(d.gripMm > hang.portraitWidthMm / 2, 'less than half the card is held')
})

test('a sleeve that swallows the card whole is refused', () => {
  const issues = checkConfig({ ...POCKET, heightMm: 40 })
  assert.ok(issues.some(m => /not enough to pinch/.test(m)), issues.join('; '))
})

test('a sleeve too shallow to hold the card upright is refused', () => {
  const issues = checkConfig({ ...POCKET, heightMm: 14 })
  assert.ok(issues.some(m => /lean out of the sleeve/.test(m)), issues.join('; '))
})

test('lips that meet in the middle are refused', () => {
  const issues = checkConfig({ ...POCKET, lipMm: 36 })
  assert.ok(issues.some(m => /no window left/.test(m)), issues.join('; '))
})

test('a pocket with no lip, or walls under two extrusions, is refused', () => {
  assert.ok(checkConfig({ ...POCKET, lipMm: 0 }).some(m => /falls out of the front/.test(m)))
  assert.ok(checkConfig({ ...POCKET, wallMm: 0.5 }).some(m => /under two extrusions/.test(m)))
  assert.ok(checkConfig({ ...POCKET, backMm: 0.5 }).some(m => /under two extrusions/.test(m)))
})

test('the pocket is watertight and its bands add up', () => {
  const mesh = buildPocket(POCKET)
  const report = checkManifold(mesh)
  assert.equal(report.danglingEdges, 0)
  assert.ok(report.volume > 0)
  const fromBands = bandVolume(bandsFor(POCKET))
  assert.ok(Math.abs(fromBands - report.volume) / report.volume < 1e-6)
})

test('the mouth is open at the top, so a card can get in', () => {
  // Every band's region has to be missing material across the opening. If a
  // later band ever closed over it, the card would have nowhere to go and the
  // print would need a bridge it was never designed for.
  const d = derive(POCKET)
  const bands = bandsFor(POCKET)
  const outlineArea = Math.abs(multiArea(bands[0]!.region))
  for (const band of bands.slice(1)) {
    const open = outlineArea - Math.abs(multiArea(band.region))
    assert.ok(open > 100, `a band only opens ${open.toFixed(0)} mm2 of cavity`)
  }
  // And the mouth really is a mouth: probe the middle of the cavity just
  // under the top edge and there must be nothing there. Measuring the
  // topmost vertex instead would only find the rounded corners of the walls.
  const probe: MultiPolygon = [[rectRing(10, 0.4)].map(r =>
    r.map(([x, y]) => [x + d.widthMm / 2 - 5, y + d.heightMm - 0.5] as const))]
  for (const band of bands.slice(1)) {
    assert.ok(
      Math.abs(multiArea(intersection(band.region, probe))) < 1e-6,
      'something is spanning the top of the cavity',
    )
  }
})

test('a seated card clears the back plate and stands proud of the sleeve', () => {
  const seat = cardSeat(POCKET)
  const hang = cardHang(CARD_50x30)
  const d = derive(POCKET)
  assert.ok(Math.abs(seat.widthMm - hang.portraitHeightMm) < 1e-9, 'the seat is the card')
  assert.ok(Math.abs(seat.heightMm - hang.portraitWidthMm) < 1e-9)
  // It sits in front of the back plate, not inside it.
  assert.ok(seat.z0 >= POCKET.backMm)
  assert.ok(seat.z0 + hang.cardThicknessMm <= d.depthMm)
})
