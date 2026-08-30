import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createShape2D, createSolid, groupObjects } from '../model/scene.ts'
import type { SceneObject } from '../model/document.ts'
import { multiArea, multiBBox } from './vec.ts'
import { compileObject, compileObjects, compileScene } from './sceneShapes.ts'

const near = (a: number, b: number, tol = 0.5) =>
  assert.ok(Math.abs(a - b) < tol, `expected ~${b}, got ${a}`)

test('a rectangle compiles to its own area, centred on its position', () => {
  const rect = createShape2D('rect', [10, 5, 0], { widthMm: 40, heightMm: 20, cornerRadiusMm: 0 })
  const mp = compileObject(rect)
  near(multiArea(mp), 800)
  const b = multiBBox(mp)
  near(b.minX, -10); near(b.maxX, 30); near(b.minY, -5); near(b.maxY, 15)
})

test('a circle compiles to the inscribed 64-gon, not the ideal disc', () => {
  const mp = compileObject(createShape2D('circle', [0, 0, 0], { radiusMm: 20 }))
  // The default 64 segments inscribe the circle, so the area is short by
  // 0.16% -- about 2 mm^2 at r = 20. Asserting the polygon area rather than
  // pi r^2 is what catches a real change in segment count or winding.
  const inscribed = (64 / 2) * 400 * Math.sin((2 * Math.PI) / 64)
  near(multiArea(mp), inscribed, 0.05)
  assert.ok(multiArea(mp) < Math.PI * 400, 'an inscribed polygon must under-fill the circle')
})

test('a square uses its width for both sides', () => {
  const mp = compileObject(createShape2D('square', [0, 0, 0], { widthMm: 12 }))
  near(multiArea(mp), 144)
})

test('a hexagon has the right area', () => {
  const mp = compileObject(createShape2D('polygon', [0, 0, 0], { radiusMm: 10, sides: 6 }))
  near(multiArea(mp), (3 * Math.sqrt(3) / 2) * 100, 0.5)
})

test('rotation preserves area and turns the bounds', () => {
  const rect = createShape2D('rect', [0, 0, 0], { widthMm: 40, heightMm: 10, cornerRadiusMm: 0 })
  const turned: SceneObject = { ...rect, transform: { ...rect.transform, rotationDeg: [0, 0, 90] } }
  const mp = compileObject(turned)
  near(multiArea(mp), 400)
  const b = multiBBox(mp)
  near(b.maxX - b.minX, 10)
  near(b.maxY - b.minY, 40)
})

test('scale multiplies area', () => {
  const rect = createShape2D('rect', [0, 0, 0], { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 })
  const scaled: SceneObject = { ...rect, transform: { ...rect.transform, scale: [2, 3, 1] } }
  near(multiArea(compileObject(scaled)), 600)
})

test('a group subtracts its hole children from its solid children', () => {
  const plate = createShape2D('rect', [0, 0, 0], { widthMm: 40, heightMm: 40, cornerRadiusMm: 0 })
  const hole = { ...createShape2D('circle', [0, 0, 0], { radiusMm: 5 }), mode: 'hole' as const }
  const { objects } = groupObjects([plate, hole], new Set([plate.id, hole.id]))
  near(multiArea(compileObject(objects[0])), 1600 - Math.PI * 25, 1)
})

test('a hole outside a group is inert', () => {
  const hole = { ...createShape2D('circle', [0, 0, 0], { radiusMm: 5 }), mode: 'hole' as const }
  // Compiled on its own it is still a shape; it is grouping that gives the mode
  // meaning, which is exactly Tinkercad's rule.
  assert.ok(multiArea(compileObject(hole)) > 0)
  assert.equal(compileObjects([hole]).length, 1)
})

test('invisible objects contribute nothing', () => {
  const rect = { ...createShape2D('rect'), visible: false }
  assert.deepEqual(compileObject(rect), [])
  assert.deepEqual(compileObjects([rect]), [])
})

test('a 3D primitive in a 2D document contributes no outline', () => {
  assert.deepEqual(compileObject(createSolid('box')), [])
})

test('compileScene merges overlapping objects into one region', () => {
  const a = createShape2D('rect', [0, 0, 0], { widthMm: 20, heightMm: 20, cornerRadiusMm: 0 })
  const b = createShape2D('rect', [10, 0, 0], { widthMm: 20, heightMm: 20, cornerRadiusMm: 0 })
  const merged = compileScene([a, b])
  assert.equal(merged.length, 1, 'overlapping rectangles should union into one polygon')
  near(multiArea(merged), 30 * 20)
})
