import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { Bounds } from './align.ts'
import { dropToPlateDeltas, objectAtPoint } from './align.ts'

const box = (minZ: number, maxZ: number): Bounds => ({ min: [0, 0, minZ], max: [10, 10, maxZ] })

test('a floating part drops, a sunken part rises, a seated part is left alone', () => {
  const bounds = new Map([
    ['floating', box(12, 20)],
    ['sunken', box(-3, 5)],
    ['seated', box(0, 8)],
  ])
  const deltas = dropToPlateDeltas(bounds, ['floating', 'sunken', 'seated'])
  assert.deepEqual([...deltas], [['floating', -12], ['sunken', 3]])
})

test('together, the parts move as one body and keep their arrangement', () => {
  const bounds = new Map([['base', box(-4, 2)], ['peg', box(2, 12)]])
  const deltas = dropToPlateDeltas(bounds, ['base', 'peg'], true)
  assert.deepEqual([...deltas], [['base', 4], ['peg', 4]])
})

test('together, a model already on the plate does not move', () => {
  const bounds = new Map([['base', box(0, 2)], ['peg', box(2, 12)]])
  assert.equal(dropToPlateDeltas(bounds, ['base', 'peg'], true).size, 0)
})

test('ids without measured bounds are skipped', () => {
  assert.equal(dropToPlateDeltas(new Map(), ['unbuilt']).size, 0)
})

test('a point picks the part it falls in, and otherwise the nearest one', () => {
  const bounds = new Map([
    ['left', { min: [0, 0, 0], max: [10, 10, 10] } as Bounds],
    ['right', { min: [50, 0, 0], max: [60, 10, 10] } as Bounds],
  ])
  assert.equal(objectAtPoint(bounds, [5, 5, 5]), 'left')
  assert.equal(objectAtPoint(bounds, [55, 5, 5]), 'right')
  assert.equal(objectAtPoint(bounds, [48, 5, 5]), 'right')
  assert.equal(objectAtPoint(new Map(), [0, 0, 0]), null)
})
