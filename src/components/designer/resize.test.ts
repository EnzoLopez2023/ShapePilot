import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { Transform } from '../../model/document.ts'
import { localAxisFor, resizedScale } from './resize.ts'

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
