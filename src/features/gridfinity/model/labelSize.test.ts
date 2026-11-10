import assert from 'node:assert/strict'
import { test } from 'vitest'
import { labelLengthMm, lidLines, shortLabel, suggestBinSize } from './labelSize.ts'

test('reads metric and inch lengths the label lists use', () => {
  assert.equal(labelLengthMm('M3 x 8'), 8)
  assert.equal(labelLengthMm('M2.5 × 12 Self-tap'), 12)
  assert.equal(labelLengthMm('1-1/4" Coarse'), 31.75)
  assert.equal(labelLengthMm('3/4" Fine Pan'), 19.05)
  assert.equal(labelLengthMm('#8 x 2"'), 50.8)
  assert.equal(labelLengthMm('Washers'), null)
  assert.equal(labelLengthMm('M3 nuts'), null)
})

test('the tab keeps just the size', () => {
  assert.equal(shortLabel('M5 x 12 Button'), 'M5x12')
  assert.equal(shortLabel('M2.5 x 6 Self-tap'), 'M2.5x6')
  assert.equal(shortLabel('M5 Hex nuts'), 'M5')
  assert.equal(shortLabel('M5 Split washers'), 'M5')
  assert.equal(shortLabel('1-1/4" Coarse'), '1-1/4"')
  assert.equal(shortLabel('#8 x 2" Wood'), '#8x2"')
  assert.equal(shortLabel('Spare bits'), 'Spare bits')
})

test('the lid puts the size on its own line above what it is', () => {
  assert.deepEqual(lidLines('M5 x 30 Button'), ['M5x30', 'Button'])
  assert.deepEqual(lidLines('M5 Split Washers'), ['M5', 'Split Washers'])
  assert.deepEqual(lidLines('1-1/4" Coarse'), ['1-1/4"', 'Coarse'])
  assert.deepEqual(lidLines('M5'), ['M5'])
  assert.deepEqual(lidLines('Router bits'), ['Router', 'bits'])
  assert.deepEqual(lidLines('Bits'), ['Bits'])
})

test('short screws fit one cell; longer ones get a longer bin, label on its short side', () => {
  assert.deepEqual(suggestBinSize('M3 x 8'), { gridX: 1, gridY: 1, lengthMm: 8 })
  assert.equal(suggestBinSize('1-1/4" Coarse')?.gridY, 1)
  assert.deepEqual(suggestBinSize('M5 x 35 Socket cap'), { gridX: 1, gridY: 2, lengthMm: 35 })
  assert.deepEqual(suggestBinSize('2-1/2" Coarse'), { gridX: 1, gridY: 2, lengthMm: 63.5 })
  assert.equal(suggestBinSize('Spare bits'), null)
})
