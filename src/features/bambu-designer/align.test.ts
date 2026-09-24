import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { Bounds } from './align.ts'
import { dropToPlateDeltas, objectAtPoint, ontoPlateDeltas } from './align.ts'

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

const at = (x0: number, y0: number, x1: number, y1: number, z0 = 0): Bounds =>
  ({ min: [x0, y0, z0], max: [x1, y1, z0 + 5] })

test('a part off the plate is pulled back across the edge it crossed', () => {
  const plate: [number, number, number] = [256, 256, 256]
  const bounds = new Map([
    ['right', at(120, 0, 150, 20)],
    ['front', at(0, -140, 20, -120)],
    ['sunk', at(0, 0, 10, 10, -2)],
    ['inside', at(-128, -128, 128, 128)],
  ])
  const deltas = ontoPlateDeltas(bounds, bounds.keys(), plate)
  assert.deepEqual([...deltas], [
    ['right', [-22, 0, 0]],
    ['front', [0, 12, 0]],
    ['sunk', [0, 0, 2]],
  ])
})

test('a part wider than the plate is centred on that axis', () => {
  const bounds = new Map([['long', at(0, 0, 300, 10)]])
  assert.deepEqual(ontoPlateDeltas(bounds, ['long'], [256, 256, 256]).get('long'), [-150, 0, 0])
})
