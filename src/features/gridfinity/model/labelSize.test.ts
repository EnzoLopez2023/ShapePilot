import assert from 'node:assert/strict'
import { test } from 'vitest'
import { labelLengthMm, suggestBinSize } from './labelSize.ts'

test('reads metric and inch lengths the label lists use', () => {
  assert.equal(labelLengthMm('M3 x 8'), 8)
  assert.equal(labelLengthMm('M2.5 × 12 Self-tap'), 12)
  assert.equal(labelLengthMm('1-1/4" Coarse'), 31.75)
  assert.equal(labelLengthMm('3/4" Fine Pan'), 19.05)
  assert.equal(labelLengthMm('#8 x 2"'), 50.8)
  assert.equal(labelLengthMm('Washers'), null)
  assert.equal(labelLengthMm('M3 nuts'), null)
})

test('short screws fit one cell; a 2-1/2" screw needs two across', () => {
  assert.deepEqual(suggestBinSize('M3 x 8'), { gridX: 1, gridY: 1, lengthMm: 8 })
  assert.equal(suggestBinSize('1-1/4" Coarse')?.gridX, 1)
  assert.equal(suggestBinSize('2-1/2" Coarse')?.gridX, 2)
  assert.equal(suggestBinSize('Spare bits'), null)
})
