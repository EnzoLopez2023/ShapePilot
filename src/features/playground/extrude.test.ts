import assert from 'node:assert/strict'
import { test } from 'vitest'
import { evaluateProgram } from '../../csg/evaluate.ts'
import { programFromScene } from '../../csg/fromScene.ts'
import { checkManifold } from '../../geometry/mesh.ts'
import type { PathObject, SceneObject } from '../../model/document.ts'
import { IDENTITY_TRANSFORM, newId } from '../../model/scene.ts'
import { artworkBounds, extrudeToBadge } from './extrude.ts'

const square = (size: number, at: [number, number] = [0, 0]): PathObject => ({
  id: newId(), name: 'Mark', type: 'path',
  rings: [[[0, 0], [size, 0], [size, size], [0, size]]],
  thicknessMm: 1,
  transform: { ...IDENTITY_TRANSFORM, position: [at[0], at[1], 0] },
  mode: 'solid', visible: true, locked: false,
})

test('bounds include each path\'s own offset', () => {
  assert.deepEqual(artworkBounds([square(10), square(10, [5, 5])]),
    { min: [0, 0], max: [15, 15] })
  assert.equal(artworkBounds([]), null)
})

test('extruding gives the artwork its thickness and leaves it where it was', () => {
  const [mark] = extrudeToBadge([square(10)], { thicknessMm: 3 }) as PathObject[]
  assert.equal(mark.thicknessMm, 3)
  assert.deepEqual(mark.transform.position, [0, 0, 0])
})

test('a plate goes under the artwork, margin all round, and the artwork sits on it', () => {
  const objects = extrudeToBadge([square(10)], {
    thicknessMm: 2, plate: { marginMm: 2, thicknessMm: 1.5 },
  }) as PathObject[]
  const [plate, mark] = objects
  assert.equal(plate.name, 'Backing plate')
  assert.deepEqual(plate.rings[0], [[-2, -2], [12, -2], [12, 12], [-2, 12]])
  assert.equal(plate.thicknessMm, 1.5)
  // Lifted by the plate's thickness, so the two meet rather than overlap.
  assert.deepEqual(mark.transform.position, [0, 0, 1.5])
})

test('the badge builds as one watertight solid of the expected volume', async () => {
  const objects: SceneObject[] = extrudeToBadge([square(10)], {
    thicknessMm: 2, plate: { marginMm: 2, thicknessMm: 1.5 },
  })
  const mesh = await evaluateProgram(programFromScene(objects))
  const report = checkManifold(mesh)
  assert.ok(report.ok, 'the badge is not watertight')
  // 14 x 14 x 1.5 plate plus a 10 x 10 x 2 mark standing on it.
  assert.ok(Math.abs(report.volume - (14 * 14 * 1.5 + 10 * 10 * 2)) < 1)
})
