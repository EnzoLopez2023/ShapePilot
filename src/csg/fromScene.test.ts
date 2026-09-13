import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'vitest'
import { parse } from 'opentype.js'
import { createShape2D, createSolid, createText, groupObjects } from '../model/scene.ts'
import { validateShapeProgram } from '../../lib/contracts/shapeProgram.ts'
import { checkManifold } from '../geometry/mesh.ts'
import { compileObject } from '../geometry/sceneShapes.ts'
import { textOutlines } from '../text/fonts.ts'
import type { Vec2 } from '../geometry/vec.ts'
import { multiArea, signedArea } from '../geometry/vec.ts'
import { evaluateNode, evaluateProgram } from './evaluate.ts'
import { objectNode, programFromScene } from './fromScene.ts'
import { programToObjects } from './toScene.ts'

test('a solid maps straight onto its primitive op', () => {
  const box = createSolid('box', [1, 2, 3], { widthMm: 5, depthMm: 6, heightMm: 7 })
  const node = objectNode(box)!
  assert.equal(node.op, 'box')
  assert.equal(node.id, box.id)
  assert.deepEqual(node.transform.position, [1, 2, 3])
})

test('a 2D shape becomes an extrusion of its thickness', () => {
  const circle = createShape2D('circle', [0, 0, 0], { radiusMm: 8 })
  const node = objectNode({ ...circle, thicknessMm: 3 })!
  assert.equal(node.op, 'extrude')
  assert.ok('params' in node && node.params.profile!.length > 8)
  assert.ok('params' in node && node.params.heightMm === 3)
})

test('a group of solids and holes becomes a difference', () => {
  const plate = createSolid('box', [0, 0, 0], { widthMm: 40, depthMm: 40, heightMm: 5 })
  const hole = { ...createSolid('cylinder', [0, 0, 0], { radiusMm: 4, heightMm: 20 }), mode: 'hole' as const }
  const { objects } = groupObjects([plate, hole], new Set([plate.id, hole.id]))

  const node = objectNode(objects[0])!
  assert.equal(node.op, 'difference')
  assert.ok('children' in node && node.children.length === 2)
})

test('a group with no holes collapses to the solid itself', () => {
  const a = createSolid('box')
  const b = createSolid('cylinder')
  const { objects, groupId } = groupObjects([a, b], new Set([a.id, b.id]))
  const node = objectNode(objects[0])!
  assert.equal(node.op, 'union')
  assert.equal(node.id, groupId)
})

test('a group of only holes compiles away', () => {
  const a = { ...createSolid('box'), mode: 'hole' as const }
  const b = { ...createSolid('cylinder'), mode: 'hole' as const }
  const { objects } = groupObjects([a, b], new Set([a.id, b.id]))
  assert.equal(objectNode(objects[0]), null)
})

test('invisible objects and top-level holes are dropped from the program', () => {
  const visible = createSolid('box')
  const hidden = { ...createSolid('sphere'), visible: false }
  const looseHole = { ...createSolid('cylinder'), mode: 'hole' as const }

  const program = programFromScene([visible, hidden, looseHole])
  assert.deepEqual(program.parts.map(p => p.id), [visible.id])
})

test('a scene compiles to a program the shared validator accepts', () => {
  const plate = createSolid('box', [0, 0, 0], { widthMm: 40, depthMm: 40, heightMm: 5 })
  const hole = { ...createSolid('cylinder', [5, 0, 0], { radiusMm: 4, heightMm: 20 }), mode: 'hole' as const }
  const { objects } = groupObjects([plate, hole], new Set([plate.id, hole.id]))
  const shape = createShape2D('triangle', [60, 0, 0])

  const program = programFromScene([...objects, shape])
  // The round trip matters: anything the UI can build, the server must accept.
  assert.doesNotThrow(() => validateShapeProgram(JSON.parse(JSON.stringify(program))))
})

test('a compiled group evaluates to a watertight solid with the hole removed', async () => {
  const plate = createSolid('box', [0, 0, 0], { widthMm: 40, depthMm: 40, heightMm: 6 })
  const hole = {
    ...createSolid('cylinder', [0, 0, -5], { radiusMm: 5, heightMm: 30, segments: 48 }),
    mode: 'hole' as const,
  }
  const { objects } = groupObjects([plate, hole], new Set([plate.id, hole.id]))

  const mesh = await evaluateProgram(programFromScene(objects))
  const report = checkManifold(mesh)
  assert.ok(report.ok, `not watertight: ${report.danglingEdges} dangling edges`)
  // 40 * 40 * 6 minus a 48-gon prism of r = 5 through the full 6 mm.
  const bore = (48 / 2) * 25 * Math.sin((2 * Math.PI) / 48) * 6
  assert.ok(Math.abs(report.volume - (9600 - bore)) < 1, `unexpected volume ${report.volume}`)
})

test('a rounded box survives the round trip as one editable solid', () => {
  // What an assistant proposal has to land as: a single box the inspector can
  // still drive, not a group of a core and four corner cylinders.
  const box = createSolid('box', [0, 0, 0], {
    widthMm: 10, depthMm: 10, heightMm: 16.8, cornerRadiusMm: 2,
  })
  const program = validateShapeProgram(programFromScene([box]))
  const node = program.parts[0]
  assert.ok('params' in node && node.params.cornerRadiusMm === 2)

  const [back] = programToObjects(program)
  assert.equal(back.type, 'solid')
  assert.ok(back.type === 'solid' && back.primitive === 'box')
  assert.ok(back.type === 'solid' && back.params.cornerRadiusMm === 2)
})

// -- Text counters -----------------------------------------------------------
//
// Glyph outlines arrive as a flat bag of contours. Extruding each as its own
// solid hands manifold a clockwise counter ring, which is not a solid at all,
// so a word with an "o" in it did not build -- it threw InvalidConstruction.

const font = parse(readFileSync('public/fonts/archivo-medium.ttf').buffer as ArrayBuffer)

/** One text object lowered and evaluated, with the areas to measure it by. */
async function buildText(text: string, thicknessMm = 2) {
  const object = { ...createText(text), sizeMm: 20, thicknessMm }
  const rings = textOutlines(font, object).map(c => c.map(([x, y]) => [x, y] as const))
  const node = objectNode(object, { textOutlines: new Map([[object.id, rings]]) })
  assert.ok(node, `${text} produced no node`)
  return {
    node,
    report: checkManifold(await evaluateNode(node)),
    /** Counters subtracted -- the outlines are already wound for it. */
    netMm3: rings.reduce((sum, r) => sum + signedArea(r as Vec2[]), 0) * thicknessMm,
    /** Every contour as material, which is what a filled counter would give. */
    filledMm3: rings.reduce((sum, r) => sum + Math.abs(signedArea(r as Vec2[])), 0) * thicknessMm,
  }
}

test('a glyph with a counter builds, and builds hollow', async () => {
  const { report, netMm3, filledMm3 } = await buildText('o')
  assert.ok(report.ok, `"o" is not watertight: ${report.danglingEdges} dangling edges`)
  assert.ok(Math.abs(report.volume - netMm3) < 0.01, `expected ${netMm3}, got ${report.volume}`)
  // Worth stating outright: the filled figure is what the old shape would have
  // been if extruding contours separately had merely filled instead of failing.
  assert.ok(report.volume < filledMm3 * 0.9, 'the counter must be missing material')
})

test('every counter in a word is a hole, not just the first', async () => {
  const { report, netMm3 } = await buildText('Hello 8')
  assert.ok(report.ok, `"Hello 8" is not watertight: ${report.danglingEdges} dangling edges`)
  assert.ok(Math.abs(report.volume - netMm3) < 0.05, `expected ${netMm3}, got ${report.volume}`)
})

test('a glyph without a counter is unchanged', async () => {
  const { node, report, netMm3 } = await buildText('l')
  // One contour, so no union wrapper: the object stays a single extrusion the
  // inspector can still drive.
  assert.equal(node.op, 'extrude')
  assert.ok(Math.abs(report.volume - netMm3) < 0.01)
})

test('separate glyphs stay separate solids under one union', async () => {
  const { node, report, netMm3 } = await buildText('ll')
  assert.equal(node.op, 'union')
  assert.ok('children' in node && node.children.length === 2, 'two stems, two extrusions')
  assert.ok(Math.abs(report.volume - netMm3) < 0.01)
})

test('the 3D lowering agrees with the 2D compile on what is solid', async () => {
  // The canvas and the mesher must not disagree about a counter; they read the
  // same contours, and after this they nest them the same way.
  const object = { ...createText('o'), sizeMm: 20, thicknessMm: 2 }
  const rings = textOutlines(font, object).map(c => c.map(([x, y]) => [x, y] as const))
  const opts = { textOutlines: new Map([[object.id, rings]]) }
  const flat = multiArea(compileObject(object, opts))
  const { report } = await buildText('o')
  assert.ok(Math.abs(report.volume - flat * 2) < 0.01, `2D says ${flat * 2}, 3D says ${report.volume}`)
})
