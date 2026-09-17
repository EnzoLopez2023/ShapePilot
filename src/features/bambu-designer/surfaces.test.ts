import assert from 'node:assert/strict'
import { test } from 'vitest'
import { evaluateNode, evaluateProgram } from '../../csg/evaluate.ts'
import type { PartNode, ShapeProgram } from '../../../lib/contracts/shapeProgram.ts'
import {
  TIPPY_RATIO, averageThicknessMm, overhangSurface, surfaceReport, tippiness,
} from './surfaces.ts'
import { measure } from './estimate.ts'

/** The drawn shell's own area, measured the same way the report measures. */
const surfaceArea = (mesh: Parameters<typeof measure>[0]): number => measure(mesh).area

const transform = (position: [number, number, number] = [0, 0, 0]) =>
  ({ position, rotationDeg: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] })

const box = (w: number, d: number, h: number, at: [number, number, number] = [0, 0, 0], id = 'b'): PartNode => ({
  id, name: id, op: 'box', params: { widthMm: w, depthMm: d, heightMm: h }, transform: transform(at),
})

const program = (parts: PartNode[]): ShapeProgram => ({ version: 1, units: 'mm', parts })

test('a box on the plate has no overhang and a footprint of its base', async () => {
  const report = surfaceReport(await evaluateNode(box(20, 20, 10)))
  assert.equal(report.overhangArea, 0)
  assert.ok(Math.abs(report.footprintArea - 400) < 1e-3)
})

test('a shelf sticking out over nothing is measured as an overhang', async () => {
  // A post with a slab on top, wider than the post: the slab's underside hangs.
  const mesh = await evaluateProgram(program([
    box(10, 10, 20, [0, 0, 0], 'post'),
    box(40, 40, 4, [0, 0, 20], 'shelf'),
  ]))
  const report = surfaceReport(mesh)
  // 40 x 40 underside, less the 10 x 10 the post holds up.
  assert.ok(Math.abs(report.overhangArea - (1600 - 100)) < 1, `got ${report.overhangArea}`)
  assert.ok(report.overhangAt !== null)
  assert.ok(report.overhangAt![2] > 19, 'the overhang is reported at the height it happens')
  // The post is what touches the plate.
  assert.ok(Math.abs(report.footprintArea - 100) < 1e-3)
})

test('a 45 degree slope is not an overhang, a steeper one is', async () => {
  const cone = (topRadiusMm: number) => evaluateNode({
    id: 'c', name: 'c', op: 'cone',
    params: { radiusMm: 10, topRadiusMm, heightMm: 10, segments: 64 },
    transform: transform(),
  })
  // Radius shrinking 10 mm over 10 mm of height is exactly 45 degrees.
  assert.equal(surfaceReport(await cone(0)).overhangArea, 0)
  // Upside down: a cone standing on its point overhangs all the way round.
  const inverted = surfaceReport(await evaluateNode({
    id: 'c', name: 'c', op: 'cone',
    params: { radiusMm: 0.5, topRadiusMm: 10, heightMm: 5, segments: 64 },
    transform: transform(),
  }))
  assert.ok(inverted.overhangArea > 100, `got ${inverted.overhangArea}`)
})

test('average thickness is the slab thickness for a slab', async () => {
  const report = surfaceReport(await evaluateNode(box(50, 50, 2)))
  const thickness = averageThicknessMm(report)!
  // 2V/A for a 50 x 50 x 2 slab: 10000 / 5400 x 2 = 1.85, near its 2 mm.
  assert.ok(thickness > 1.8 && thickness < 2.01, `got ${thickness}`)
})

test('tippiness rises as the footprint shrinks under the same height', () => {
  assert.equal(tippiness(40, 0), null)
  // A 40 mm tall model on a 9 x 9 mm footprint; exactly 4 is the threshold.
  assert.ok(tippiness(40, 81)! > TIPPY_RATIO)
  assert.equal(tippiness(40, 100), TIPPY_RATIO)
  assert.ok(tippiness(40, 10_000)! < TIPPY_RATIO)
})

test('the overhanging faces come back as their own shell, in front of the surface', async () => {
  const mesh = await evaluateProgram(program([
    box(10, 10, 20, [0, 0, 0], 'post'),
    box(40, 40, 4, [0, 0, 20], 'shelf'),
  ]))
  const shell = overhangSurface(mesh)!
  assert.ok(shell.triangleCount > 0)
  // The same area the report measured, drawn rather than summed.
  const area = surfaceArea(shell)
  assert.ok(Math.abs(area - surfaceReport(mesh).overhangArea) < 1, `got ${area}`)
  // Pushed clear of the surface it came from, so it is not fighting for pixels.
  assert.ok(shell.bbox[2] < 20, `got ${shell.bbox[2]}`)
})

test('a model with nothing overhanging has no shell to draw', async () => {
  assert.equal(overhangSurface(await evaluateNode(box(20, 20, 10))), null)
})
