import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { VectorDrawing } from '../../../lib/contracts/vectorDrawing.ts'
import { validateVectorDrawing } from '../../../lib/contracts/vectorDrawing.ts'
import { signedArea } from '../../geometry/vec.ts'
import { pathToRings, vectorDrawingToPathObjects } from './vectorToPaths.ts'

const squareWithHole: unknown = {
  version: 1, units: 'mm', widthMm: 20, heightMm: 20,
  paths: [{
    id: 'frame', name: 'Frame', fill: '#123456',
    commands: [
      // outer, counter-clockwise
      { cmd: 'M', to: [0, 0] },
      { cmd: 'L', to: [20, 0] },
      { cmd: 'L', to: [20, 20] },
      { cmd: 'L', to: [0, 20] },
      { cmd: 'Z' },
      // hole, clockwise
      { cmd: 'M', to: [5, 5] },
      { cmd: 'L', to: [5, 15] },
      { cmd: 'L', to: [15, 15] },
      { cmd: 'L', to: [15, 5] },
      { cmd: 'Z' },
    ],
  }],
}

test('a path with a hole becomes one object carrying outer + inner ring', () => {
  const drawing: VectorDrawing = validateVectorDrawing(squareWithHole)
  const objects = vectorDrawingToPathObjects(drawing)

  assert.equal(objects.length, 1)
  const [object] = objects
  assert.equal(object.type, 'path')
  assert.equal(object.name, 'Frame')
  assert.equal(object.color, '#123456')
  assert.equal(object.source?.format, 'svg')
  assert.equal(object.rings.length, 2)

  // normalizeMulti (inside nestRings) leaves the outer CCW and the hole CW.
  assert.ok(signedArea(object.rings[0] as [number, number][]) > 0, 'outer CCW')
  assert.ok(signedArea(object.rings[1] as [number, number][]) < 0, 'hole CW')

  // Coordinates are carried straight through: mm, y-up, no flip.
  const xs = object.rings[0].map(([x]) => x)
  const ys = object.rings[0].map(([, y]) => y)
  assert.equal(Math.min(...xs), 0)
  assert.equal(Math.max(...xs), 20)
  assert.equal(Math.min(...ys), 0)
  assert.equal(Math.max(...ys), 20)
})

test('a cubic bezier is flattened to a polyline', () => {
  const rings = pathToRings([
    { cmd: 'M', to: [0, 0] },
    { cmd: 'C', c1: [0, 10], c2: [10, 10], to: [10, 0] },
    { cmd: 'L', to: [0, 0] },
    { cmd: 'Z' },
  ])
  assert.equal(rings.length, 1)
  // Far more than the four control points: the curve was sampled.
  assert.ok(rings[0].length > 10)
})

test('two separate paths become two objects', () => {
  const drawing = validateVectorDrawing({
    version: 1, units: 'mm', widthMm: 40, heightMm: 20,
    paths: [
      {
        id: 'a', name: 'A',
        commands: [
          { cmd: 'M', to: [0, 0] }, { cmd: 'L', to: [10, 0] },
          { cmd: 'L', to: [10, 10] }, { cmd: 'Z' },
        ],
      },
      {
        id: 'b', name: 'B',
        commands: [
          { cmd: 'M', to: [20, 0] }, { cmd: 'L', to: [30, 0] },
          { cmd: 'L', to: [30, 10] }, { cmd: 'Z' },
        ],
      },
    ],
  })
  const objects = vectorDrawingToPathObjects(drawing)
  assert.deepEqual(objects.map(o => o.name), ['A', 'B'])
})
