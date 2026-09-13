import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'vitest'
import { parse } from 'opentype.js'
import { IDENTITY_TRANSFORM, createShape2D, createSolid, createText, groupObjects } from '../model/scene.ts'
import type { PathObject, SceneObject } from '../model/document.ts'
import { textOutlines } from '../text/fonts.ts'
import type { Vec2 } from './vec.ts'
import { multiArea, multiBBox, signedArea, translateRing } from './vec.ts'
import { circleRing, rectRing } from './primitives.ts'
import { compileObject, compileObjects, compileScene } from './sceneShapes.ts'

// Read the vendored binary directly: this suite is Node, and glyph counters are
// the case that matters here.
const font = parse(readFileSync('public/fonts/archivo-medium.ttf').buffer as ArrayBuffer)

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

// -- Holes -------------------------------------------------------------------
//
// A multi-ring object is a bag of rings with no parent/child marking: an
// imported SVG or DXF region, a glyph and its counters. Nesting has to come
// from containment, or every hole compiles as a solid island.

/** The rings the SVG importer hands `ImportButton` for a plate with a bore. */
const holedPlate = (): PathObject => ({
  id: 'plate', name: 'plate.svg', type: 'path', transform: IDENTITY_TRANSFORM,
  mode: 'solid', visible: true, locked: false, thicknessMm: 5,
  rings: [rectRing(60, 60), [...translateRing(circleRing(10), 30, 30)].reverse()],
  source: { format: 'svg', filename: 'plate.svg' },
})

test('an imported path with a hole compiles to one polygon with a hole', () => {
  const mp = compileObject(holedPlate())
  assert.equal(mp.length, 1, 'outer and hole belong to one polygon, not two islands')
  assert.equal(mp[0].length, 2, 'expected an outer ring and one hole')
  assert.ok(signedArea(mp[0][0]) > 0, 'outer must be CCW')
  assert.ok(signedArea(mp[0][1]) < 0, 'the hole must be CW')
  // The bore is really subtracted -- an island would have added its area instead.
  const bore = (64 / 2) * 100 * Math.sin((2 * Math.PI) / 64)
  near(multiArea(mp), 3600 - bore, 0.5)
})

test('a hole survives the union every cut layer runs', () => {
  // With one object `union` short-circuits, so a second object on the same
  // layer is what actually puts the clipper on the hole. This is the export
  // path: an island here is welded to its parent for good.
  const tag = createShape2D('rect', [200, 0, 0], { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 })
  const merged = compileScene([holedPlate(), tag])
  const bore = (64 / 2) * 100 * Math.sin((2 * Math.PI) / 64)
  near(multiArea(merged), 3600 - bore + 100, 0.5)
  const plate = merged.find(p => Math.abs(Math.abs(signedArea(p[0])) - 3600) < 1)
  assert.ok(plate, 'the plate should still be in the union')
  assert.equal(plate.length, 2, 'the bore must survive the union as a hole ring')
})

test('a text glyph keeps its counter as a hole', () => {
  // "o" is one outer contour and one counter; cut solid it is a filled disc.
  const object = { ...createText('o'), sizeMm: 20 }
  const outlines = new Map([[object.id, textOutlines(font, object).map(c => c.map(p => [...p] as Vec2))]])
  const mp = compileObject(object, { textOutlines: outlines })
  assert.equal(mp.length, 1)
  assert.equal(mp[0].length, 2, 'the counter must ride as a hole ring')
  assert.ok(multiArea(mp) < Math.abs(signedArea(mp[0][0])), 'the counter must reduce the cut area')
})

test('separate glyphs stay separate polygons', () => {
  // "ll" has no counters and no containment: two stems, two polygons. Nesting
  // must not collapse islands that merely sit near each other.
  const object = { ...createText('ll'), sizeMm: 20 }
  const outlines = new Map([[object.id, textOutlines(font, object).map(c => c.map(p => [...p] as Vec2))]])
  const mp = compileObject(object, { textOutlines: outlines })
  assert.equal(mp.length, 2)
  assert.ok(mp.every(poly => poly.length === 1))
})

test('an island inside a hole cuts as solid again', () => {
  // A washer sitting in a counterbore: three levels of containment, and the
  // innermost ring is material, not a second hole.
  const object: PathObject = {
    ...holedPlate(),
    rings: [
      rectRing(60, 60),
      [...translateRing(circleRing(20), 30, 30)].reverse(),
      translateRing(circleRing(5), 30, 30),
    ],
  }
  const mp = compileObject(object)
  assert.equal(mp.length, 2, 'the island is its own polygon, not a ring of the plate')
  const disc = (64 / 2) * 25 * Math.sin((2 * Math.PI) / 64)
  const bore = (64 / 2) * 400 * Math.sin((2 * Math.PI) / 64)
  near(multiArea(mp), 3600 - bore + disc, 0.5)
})

test('a mirrored import keeps its hole a hole', () => {
  // A negative scale reverses every ring's winding. Containment does not care,
  // so the hole stays a hole -- which ring order alone could not guarantee.
  const object = holedPlate()
  const mirrored: SceneObject = {
    ...object, transform: { ...object.transform, scale: [-1, 1, 1] },
  }
  const mp = compileObject(mirrored)
  assert.equal(mp.length, 1)
  assert.equal(mp[0].length, 2)
  assert.ok(signedArea(mp[0][0]) > 0, 'outer must be CCW after the mirror')
  assert.ok(signedArea(mp[0][1]) < 0, 'the hole must be CW after the mirror')
})
