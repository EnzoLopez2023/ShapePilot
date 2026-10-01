import assert from 'node:assert/strict'
import { test } from 'vitest'
import { CARD, CARD_50x30, cardHang, checkConfig, derive, ladderSteps } from './card.ts'

const near = (a: number, b: number, eps = 1e-9): void => {
  assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`)
}

test('the 50 x 30 card is 69.4 x 36.4 x 2 mm', () => {
  const d = derive(CARD_50x30)
  near(d.cardWidthMm, 69.4)
  near(d.cardHeightMm, 36.4)
  assert.equal(CARD_50x30.cardThicknessMm, 2)
  // The slot edge is wider than the border, because the slot sets it.
  near(d.slotZoneMm, 4)
  near(d.pocketWidthMm, 50.4)
  near(d.pocketHeightMm, 30.4)
})

test('the hang slot is a true stadium cut through the full thickness', () => {
  const hang = cardHang(CARD_50x30)
  near(hang.slotWidthMm, 2)
  near(hang.slotLengthMm, 30.4)
  // Radius is half the width, which is what makes both ends semicircles.
  near(hang.slotRadiusMm, hang.slotWidthMm / 2)
  near(hang.cardThicknessMm, 2)
})

test('the slot leaves a 1 mm strap on the edge the card hangs from', () => {
  const hang = cardHang(CARD_50x30)
  near(hang.strapMm, 1)
  near(hang.slotCentreOffsetMm, 2)
  // The strap plus the slot plus the strap is the whole slot edge.
  near(2 * hang.strapMm + hang.slotWidthMm, derive(CARD_50x30).slotZoneMm)
})

test('a card hangs portrait, 36.4 wide and 69.4 tall', () => {
  const hang = cardHang(CARD_50x30)
  const d = derive(CARD_50x30)
  near(hang.portraitWidthMm, 36.4)
  near(hang.portraitHeightMm, 69.4)
  // Portrait is the card turned a quarter turn, nothing more.
  near(hang.portraitWidthMm, d.cardHeightMm)
  near(hang.portraitHeightMm, d.cardWidthMm)
})

test('the thickness ladder reads across the bottom of a portrait card', () => {
  const hang = cardHang(CARD_50x30)
  near(hang.ladderTopBelowHangMm, 56.4)
  near(hang.ladderBottomBelowHangMm, 66.4)
  // It is the bottom 13 mm of a hanging card, and it is the only thing on the
  // card that is not also printed on the label. Anything that overlaps cards
  // has to clear it, which at these numbers means not overlapping them at all.
  assert.ok(hang.ladderTopBelowHangMm > hang.portraitHeightMm * 0.75)
  assert.ok(hang.ladderBottomBelowHangMm < hang.portraitHeightMm)
})

test('more ladder steps keep the 0.2 mm rung and carry on up', () => {
  assert.deepEqual(ladderSteps(4), [0.2, 0.4, 0.6, 0.8])
  assert.deepEqual(ladderSteps(6), [0.2, 0.4, 0.6, 0.8, 1, 1.2])
})

test('the shipped card is sound', () => {
  assert.deepEqual(checkConfig(CARD_50x30), [])
})

test('a recess deeper than the card is refused', () => {
  // It trips the ladder rule too -- at a 2 mm recess there is no floor left
  // under the label for a window to be thinner than.
  const issues = checkConfig({ ...CARD_50x30, labelDepthMm: 2 })
  assert.ok(issues.some(m => /goes through a 2 mm card/.test(m)), issues.join('; '))
})

test('a ladder step thicker than the floor under the label is refused', () => {
  const issues = checkConfig({ ...CARD_50x30, ladderStepsMm: [0.2, 1.6] })
  assert.ok(issues.some(m => /thicker than the card's floor/.test(m)))
})

test('a border under two extrusions is refused', () => {
  const issues = checkConfig({ ...CARD_50x30, borderMm: 0.4 })
  assert.ok(issues.some(m => /under two extrusions/.test(m)))
})

test('a label with no size is refused', () => {
  assert.ok(checkConfig({ ...CARD, labelWidthMm: 0, labelHeightMm: 30 }).length > 0)
})
