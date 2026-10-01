import assert from 'node:assert/strict'
import { test } from 'vitest'
import { SKADIS } from '../geometry/skadis.ts'
import { BAMBU_X2D } from '../model/machines.ts'
import { cardHang, CARD_50x30 } from './card.ts'
import { HOLDER, checkConfig, derive, holderList, sagittaMm } from './holder.ts'
import type { HolderSpec } from './holder.ts'

const BAR: HolderSpec = { back: 'skadis', count: 5 }
const PAD: HolderSpec = { back: 'pad', count: 1 }

test('the shipped holders are sound', () => {
  for (const spec of holderList()) {
    assert.deepEqual(checkConfig(HOLDER, spec), [], `${spec.back} ${spec.count}`)
  }
})

test('a blade and its lip may not exceed what the card slot can pass', () => {
  // The rule that kills the obvious design. A 1.6 mm blade with a 3.5 mm lip
  // is what you reach for before doing the arithmetic, and the card would have
  // to be bent on and off.
  const issues = checkConfig(
    { ...HOLDER, bladeThicknessMm: 1.6, bladeLipMm: 3.5 }, BAR)
  const rule = issues.find(m => /bent on and off/.test(m))
  assert.ok(rule, issues.join('; '))
  // The message has to carry the arithmetic, or the next person re-derives it.
  assert.match(rule, /1\.6 mm blade/)
  assert.match(rule, /3\.5 mm lip/)
  assert.match(rule, /5\.40 mm/)
  assert.match(rule, /2 mm slot/)
})

test('the shipped blade spends the card slot exactly', () => {
  const hang = cardHang(CARD_50x30)
  const spent = HOLDER.bladeThicknessMm + HOLDER.bladeLipMm + HOLDER.fitMm
  assert.equal(spent, hang.slotWidthMm)
})

test('a blade with no lip is refused', () => {
  const issues = checkConfig({ ...HOLDER, bladeLipMm: 0 }, BAR)
  assert.ok(issues.some(m => /slides off the blade forwards/.test(m)), issues.join('; '))
})

test('a blade under two extrusions is refused', () => {
  assert.ok(checkConfig({ ...HOLDER, bladeThicknessMm: 0.6 }, BAR)
    .some(m => /under two extrusions/.test(m)))
})

test('a blade too long for the slot, or too short to hold a card square, is refused', () => {
  assert.ok(checkConfig({ ...HOLDER, bladeLengthMm: 31 }, BAR)
    .some(m => /will not enter a 30\.4 mm slot/.test(m)))
  assert.ok(checkConfig({ ...HOLDER, bladeLengthMm: 12 }, BAR)
    .some(m => /too short to hold a 36\.4 mm card square/.test(m)))
})

test('a prong that cannot enter a 15 mm Skadis slot is refused', () => {
  const issues = checkConfig({ ...HOLDER, prongHeightMm: 12 }, BAR)
  assert.ok(issues.some(m => /will not enter a 15 mm Skadis slot/.test(m)), issues.join('; '))
})

test('a catch that would foul the slot below is refused', () => {
  // There are 40 - 15 = 25 mm of solid board under each slot.
  const issues = checkConfig({ ...HOLDER, prongCatchDropMm: 30, prongHeightMm: 2 }, BAR)
  assert.ok(issues.some(m => /fouls the slot beneath it/.test(m)), issues.join('; '))
  assert.equal(SKADIS.columnPitchMm - SKADIS.slotHeightMm, 25)
})

test('a catch with too little board to hold on to is refused', () => {
  assert.ok(checkConfig({ ...HOLDER, prongCatchDropMm: 1 }, BAR)
    .some(m => /too little board/.test(m)))
})

test('a bar with no body below its prongs is refused', () => {
  // The prong reaches 14.5 mm down from the body's top (9.5 shank + 5 catch),
  // so a 15 mm body leaves half a millimetre to bear on the board.
  const issues = checkConfig({ ...HOLDER, bodyHeightMm: 15 }, BAR)
  assert.ok(issues.some(m => /pivot on them/.test(m)), issues.join('; '))
  // And the shipped body has real room below them.
  const reach = HOLDER.prongTopBelowTopMm + HOLDER.prongHeightMm + HOLDER.prongCatchDropMm
  assert.ok(HOLDER.bodyHeightMm - reach >= 5, 'too little body bearing on the board')
})

test('five columns fits the dual-nozzle plate, six warns and seven fits neither', () => {
  const [plateX] = BAMBU_X2D.buildMm
  const dual = BAMBU_X2D.dualNozzleBuildMm![0]!
  assert.deepEqual(checkConfig(HOLDER, { back: 'skadis', count: 5 }), [])
  assert.equal(derive(HOLDER, { back: 'skadis', count: 5 }).widthMm, 200)

  const six = checkConfig(HOLDER, { back: 'skadis', count: 6 })
  assert.ok(six.some(m => /dual-nozzle/.test(m)), six.join('; '))
  assert.equal(derive(HOLDER, { back: 'skadis', count: 6 }).widthMm, 240)
  // 240 really is the awkward middle: on the plate, off the dual-nozzle plate.
  assert.ok(240 < plateX! && 240 > dual)

  assert.ok(checkConfig(HOLDER, { back: 'skadis', count: 7 })
    .some(m => /will not fit the 256 mm plate/.test(m)))
})

test('a bar carries one card per Skadis column, on the board own pitch', () => {
  const d = derive(HOLDER, BAR)
  assert.equal(d.cardPitchMm, SKADIS.columnPitchMm)
  assert.deepEqual(d.bladeCentresMm, [20, 60, 100, 140, 180])
  assert.equal(d.widthMm, 5 * SKADIS.columnPitchMm)
})

test('the card pitch leaves a real gap between neighbours', () => {
  const d = derive(HOLDER, BAR)
  const hang = cardHang(CARD_50x30)
  assert.ok(Math.abs(d.cardGapMm - (SKADIS.columnPitchMm - hang.portraitWidthMm)) < 1e-9)
  assert.ok(d.cardGapMm >= 2, `${d.cardGapMm} mm between cards`)
  // And a card too wide for the pitch is refused rather than overlapped.
  const fat = { ...CARD_50x30, labelHeightMm: 38 }
  assert.ok(checkConfig(HOLDER, BAR, fat).some(m => /too little to get a finger in/.test(m)))
})

test('bars stack two column-steps apart, which is where the slots are', () => {
  const d = derive(HOLDER, BAR)
  const hang = cardHang(CARD_50x30)
  assert.equal(d.stackPitchMm, 80)
  // Same-column slots are 40 mm apart, so only a multiple of 40 lands on one.
  assert.equal(d.stackPitchMm % SKADIS.columnPitchMm, 0)
  // And a card hanging from one bar clears the next bar down.
  const cardBottom = (d.heightMm - d.bladeTopMm) + hang.portraitHeightMm
  assert.ok(cardBottom < d.stackPitchMm, `card reaches ${cardBottom} of ${d.stackPitchMm}`)
})

test('the lift that releases a card is under a millimetre', () => {
  const d = derive(HOLDER, BAR)
  assert.ok(d.releaseLiftMm > 0 && d.releaseLiftMm <= 1, `${d.releaseLiftMm} mm`)
  // It must also leave the blade inside the slot at full lift, or the card
  // jams instead of releasing.
  const hang = cardHang(CARD_50x30)
  assert.ok(d.releaseLiftMm <= hang.slotWidthMm - HOLDER.bladeThicknessMm)
})

test('the pad says how flat a face it needs rather than pretending', () => {
  const d = derive(HOLDER, PAD)
  // Invert it: at that radius the standoff is exactly what the foam takes up.
  assert.ok(Math.abs(sagittaMm(d.widthMm, d.minFlatRadiusMm) - HOLDER.padConformMm) < 1e-6)
  // A 30 mm pad is honest on a flat face and on very little else.
  assert.ok(d.minFlatRadiusMm > 300, `${d.minFlatRadiusMm} mm`)
  assert.ok(sagittaMm(30, 50) > 2, 'a 100 mm tub is hopeless for a flat pad')
})

test('a holder that carries no whole number of cards is refused', () => {
  assert.ok(checkConfig(HOLDER, { back: 'pad', count: 0 }).length > 0)
  assert.ok(checkConfig(HOLDER, { back: 'pad', count: 1.5 }).length > 0)
})
