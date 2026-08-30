import assert from 'node:assert/strict'
import { test } from 'vitest'
import { circleRing, rectRing } from './primitives.ts'
import { multiArea, signedArea, translateRing } from './vec.ts'
import { nestRings } from './nest.ts'

test('a ring inside another becomes its hole', () => {
  const mp = nestRings([rectRing(100, 100), translateRing(circleRing(10), 50, 50)])
  assert.equal(mp.length, 1, 'one polygon')
  assert.equal(mp[0].length, 2, 'outer plus one hole')
  assert.ok(signedArea(mp[0][0]) > 0, 'outer must be CCW')
  assert.ok(signedArea(mp[0][1]) < 0, 'hole must be CW')
  assert.ok(multiArea(mp) < 100 * 100)
})

test('disjoint rings stay separate polygons', () => {
  const mp = nestRings([rectRing(20, 20), translateRing(rectRing(20, 20), 50, 0)])
  assert.equal(mp.length, 2)
  assert.ok(mp.every(p => p.length === 1))
  assert.ok(Math.abs(multiArea(mp) - 800) < 1e-6)
})

test('an island inside a hole starts a new polygon', () => {
  // Depth 0 outer, depth 1 hole, depth 2 island: a washer sitting in a bore.
  const mp = nestRings([
    rectRing(100, 100),
    translateRing(circleRing(30), 50, 50),
    translateRing(circleRing(10), 50, 50),
  ])
  assert.equal(mp.length, 2, 'the island is its own polygon')
  const outer = mp.find(p => p.length === 2)
  assert.ok(outer, 'the plate keeps its hole')
})

test('winding in the input does not matter', () => {
  const reversed = nestRings([
    [...rectRing(100, 100)].reverse(),
    translateRing(circleRing(10), 50, 50),
  ])
  assert.equal(reversed[0].length, 2)
  assert.ok(signedArea(reversed[0][0]) > 0)
})

test('degenerate rings are dropped', () => {
  const mp = nestRings([rectRing(20, 20), [[0, 0], [1, 0]], [[5, 5], [5, 5], [5, 5]]])
  assert.equal(mp.length, 1)
})
