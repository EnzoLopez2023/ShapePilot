import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { openRingBetween } from './openPath.ts'
import type { Ring } from './vec.ts'

const square: Ring = [[0, 0], [10, 0], [10, 10], [0, 10]]

describe('openRingBetween', () => {
  it('removes the shorter arc and keeps the long way round', () => {
    // From the middle of the bottom edge to the middle of the right edge: the
    // corner at (10, 0) goes, the other three corners stay.
    const open = openRingBetween(square, [5, 0], [10, 5])!
    assert.deepEqual(open.map(p => [...p]), [[10, 5], [10, 10], [0, 10], [0, 0], [5, 0]])
  })

  it('does not care which point was clicked first', () => {
    const a = openRingBetween(square, [5, 0], [10, 5])!
    const b = openRingBetween(square, [10, 5], [5, 0])!
    assert.deepEqual(a, b)
  })

  it('keeps the removed section out of the result', () => {
    const open = openRingBetween(square, [5, 0], [10, 5])!
    assert.ok(!open.some(([x, y]) => x === 10 && y === 0))
  })

  it('refuses two clicks on the same spot', () => {
    assert.equal(openRingBetween(square, [5, 0], [5, 0]), null)
  })

  it('handles a removed arc that wraps past the ring start', () => {
    const open = openRingBetween(square, [0, 5], [5, 0])!
    assert.deepEqual(open.map(p => [...p]), [[5, 0], [10, 0], [10, 10], [0, 10], [0, 5]])
  })
})
