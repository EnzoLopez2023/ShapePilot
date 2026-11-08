import assert from 'node:assert/strict'
import { test } from 'vitest'
import { evaluateNode } from '../../csg/evaluate.ts'
import { densityOf, formatGrams, formatMinutes, measure, printMinutes, printedGrams } from './estimate.ts'

const box = (widthMm: number, depthMm = widthMm, heightMm = widthMm) => evaluateNode({
  id: 'b', name: 'b', op: 'box',
  params: { widthMm, depthMm, heightMm },
  transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
})

test('a 20 mm cube measures 8000 mm³ and 2400 mm²', async () => {
  const { volume, area } = measure(await box(20))
  assert.ok(Math.abs(volume - 8000) < 1e-3)
  assert.ok(Math.abs(area - 2400) < 1e-3)
})

test('a 20 mm PLA calibration cube lands where Bambu Studio puts it, about 3-4 g', async () => {
  const grams = printedGrams(await box(20), densityOf('PLA'))
  assert.ok(grams > 3 && grams < 4.5, `got ${grams}`)
})

test('a part thinner than two walls is all shell, so it weighs its solid volume', async () => {
  const plate = await box(50, 50, 1)
  const solid = (measure(plate).volume / 1000) * densityOf('PLA')
  assert.ok(Math.abs(printedGrams(plate, densityOf('PLA')) - solid) < 1e-6)
})

test('density follows the reported material, and anything unknown is PLA', () => {
  assert.equal(densityOf('PETG'), 1.27)
  assert.equal(densityOf('PETG-CF'), 1.27)
  assert.equal(densityOf('asa'), 1.07)
  assert.equal(densityOf('Mystery'), 1.24)
  assert.equal(densityOf(null), 1.24)
})

test('grams read as whole numbers, and a crumb is never zero', () => {
  assert.equal(formatGrams(12.4), '12 g')
  assert.equal(formatGrams(0.3), '< 1 g')
  assert.equal(formatGrams(0), '0 g')
})

test('a 20 mm calibration cube takes about the quarter hour Bambu Studio quotes', async () => {
  const minutes = printMinutes(await box(20))
  assert.ok(minutes > 8 && minutes < 18, `got ${minutes}`)
})

test('times read as minutes, then hours and minutes', () => {
  assert.equal(formatMinutes(0.2), '1 min')
  assert.equal(formatMinutes(42.4), '42 min')
  assert.equal(formatMinutes(60), '1 h')
  assert.equal(formatMinutes(95), '1 h 35 min')
})
