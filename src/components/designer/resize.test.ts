import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { Transform } from '../../model/document.ts'
import { localAxisFor, rescaledByPercent, resizedScale } from './resize.ts'

const at = (rotationDeg: Transform['rotationDeg'], scale: Transform['scale'] = [1, 1, 1]): Transform =>
  ({ position: [0, 0, 0], rotationDeg, scale })

test('keeping proportions scales every axis by the typed factor', () => {
  assert.deepEqual(resizedScale(at([0, 0, 0]), [40, 20, 10], 0, 80, true), [2, 2, 2])
})

test('without proportions only the typed axis changes', () => {
  assert.deepEqual(resizedScale(at([0, 0, 0], [1, 2, 1]), [40, 20, 10], 1, 10, false), [1, 1, 1])
})

test('a quarter turn about Z maps width onto the local Y axis', () => {
  assert.equal(localAxisFor([0, 0, 90], 0), 1)
  assert.deepEqual(resizedScale(at([0, 0, 90]), [20, 40, 10], 0, 40, false), [1, 2, 1])
})

test('an odd angle falls back to scaling every axis', () => {
  assert.equal(localAxisFor([0, 0, 30], 0), null)
  assert.deepEqual(resizedScale(at([0, 0, 30]), [20, 40, 10], 0, 10, false), [0.5, 0.5, 0.5])
})

test('a size of zero or less is refused', () => {
  assert.equal(resizedScale(at([0, 0, 0]), [40, 20, 10], 0, 0, true), null)
})

test('a typed percentage is the scale, with 100% the part as imported', () => {
  assert.deepEqual(rescaledByPercent(at([0, 0, 0]), 0, 103, true), [1.03, 1.03, 1.03])
  assert.deepEqual(rescaledByPercent(at([0, 0, 0], [2, 2, 2]), 2, 100, true), [1, 1, 1])
})

test('keeping proportions keeps a stretched part stretched', () => {
  const next = rescaledByPercent(at([0, 0, 0], [1, 2, 1]), 1, 100, true)!
  assert.deepEqual(next.map(v => +v.toFixed(9)), [0.5, 1, 0.5])
})

test('without proportions only that axis takes the percentage', () => {
  assert.deepEqual(rescaledByPercent(at([0, 0, 90], [1, 1, 1]), 0, 50, false), [0.5, 1, 1])
})

test('zero, negative and absurd percentages are refused', () => {
  for (const p of [0, -10, Number.NaN, 2_000_000]) {
    assert.equal(rescaledByPercent(at([0, 0, 0]), 0, p, true), null, String(p))
  }
})
