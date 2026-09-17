import assert from 'node:assert/strict'
import { test } from 'vitest'
import { validateShapeProgram } from '../../../lib/contracts/shapeProgram.ts'
import { evaluateProgram } from '../../csg/evaluate.ts'
import { programFromScene } from '../../csg/fromScene.ts'
import { checkManifold } from '../../geometry/mesh.ts'
import type { SceneObject } from '../../model/document.ts'
import { createSolid, groupObjects } from '../../model/scene.ts'
import type { FastenerKind, MetricSize } from './hardware.ts'
import { METRIC, METRIC_SIZES, createFastenerCutter } from './hardware.ts'

const THICKNESS = 6
const KINDS: FastenerKind[] = ['clearance', 'countersunk', 'counterbored', 'insert', 'nut-trap']

const plate = (): SceneObject =>
  ({ ...createSolid('box', [0, 0, 0], { widthMm: 30, depthMm: 30, heightMm: THICKNESS }), id: 'plate' })

/** The plate with the cutter grouped into it, evaluated for real. */
async function cut(kind: FastenerKind, size: MetricSize = 'M3') {
  const cutter = createFastenerCutter(kind, size, THICKNESS)
  const { objects } = groupObjects([plate(), cutter], new Set(['plate', cutter.id]))
  const program = programFromScene(objects)
  return { mesh: await evaluateProgram(program), program }
}

test('every cutter, grouped with a part, cuts a watertight hole of plausible size', async () => {
  const solid = 30 * 30 * THICKNESS
  for (const kind of KINDS) {
    const { mesh } = await cut(kind)
    const report = checkManifold(mesh)
    assert.ok(report.ok, `${kind} left an open mesh`)
    const removed = solid - report.volume
    // At least the M3 clearance shaft, and nowhere near the whole plate.
    const shaft = Math.PI * (METRIC.M3.clearance / 2) ** 2 * THICKNESS * 0.95
    const floor = kind === 'insert' ? Math.PI * (METRIC.M3.insertHole / 2) ** 2 * THICKNESS * 0.95 : shaft
    assert.ok(removed > floor, `${kind} removed only ${removed.toFixed(1)} mm³`)
    assert.ok(removed < solid / 4, `${kind} removed ${removed.toFixed(1)} mm³`)
  }
})

test('recessed cutters remove more than the plain hole, and a larger size more still', async () => {
  const volume = async (kind: FastenerKind, size: MetricSize = 'M3') =>
    checkManifold((await cut(kind, size)).mesh).volume
  const plain = await volume('clearance')
  assert.ok(await volume('countersunk') < plain)
  assert.ok(await volume('counterbored') < plain)
  assert.ok(await volume('nut-trap') < plain)
  assert.ok(await volume('clearance', 'M5') < plain)
})

test('a cutter is a hole group; through holes pass the bottom, an insert pocket is blind', () => {
  for (const kind of KINDS) {
    const cutter = createFastenerCutter(kind, 'M4', 10)
    assert.equal(cutter.mode, 'hole')
    assert.ok(cutter.children.every(child => child.mode === 'solid'))
    const passesBottom = cutter.children.some(child => child.transform.position[2] < 0)
    assert.equal(passesBottom, kind !== 'insert', `${kind}`)
  }
})

test('the assistant can still be shown a design holding any cutter', () => {
  // The AI route validates the program it is sent; a 6-segment cylinder for the
  // nut would have been refused, which is why the nut is an extruded hexagon.
  for (const kind of KINDS) {
    for (const size of METRIC_SIZES) {
      const cutter = createFastenerCutter(kind, size, 5)
      const { objects } = groupObjects([plate(), cutter], new Set(['plate', cutter.id]))
      assert.doesNotThrow(() => validateShapeProgram(JSON.parse(JSON.stringify(programFromScene(objects)))))
    }
  }
})
