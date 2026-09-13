// Text as a solid, counters included.
//
// `textOutlines` hands the compiler a flat list of contours -- the form the 2D
// canvas wants -- so every counter arrives as a sibling of its glyph rather
// than a child. Extruding that list ring by ring is not merely wrong, it does
// not build: a counter comes back wound clockwise, and a clockwise ring is not
// a solid Manifold can make. Every word containing an o, a, e, 8 failed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'vitest'
import { parse } from 'opentype.js'
import { nestRings } from '../geometry/nest.ts'
import { multiArea } from '../geometry/vec.ts'
import type { Ring } from '../geometry/vec.ts'
import { checkManifold } from '../geometry/mesh.ts'
import { createText } from '../model/scene.ts'
import { textOutlines } from '../text/fonts.ts'
import { evaluateProgram } from './evaluate.ts'
import { programFromScene } from './fromScene.ts'

// Read the vendored binary directly; this suite is Node, like fonts.test.ts.
const font = parse(
  readFileSync('public/fonts/archivo-medium.ttf').buffer as ArrayBuffer,
)

const THICKNESS = 4

/** A text object plus the outlines the app would have resolved for it. */
function textScene(text: string, sizeMm = 20) {
  const object = { ...createText(text), sizeMm, thicknessMm: THICKNESS }
  const rings: Ring[] = textOutlines(font, object).map(c => c.map(([x, y]) => [x, y] as const))
  return { object, rings }
}

const buildText = async (text: string, sizeMm = 20) => {
  const { object, rings } = textScene(text, sizeMm)
  const program = programFromScene([object], { textOutlines: new Map([[object.id, rings]]) })
  return evaluateProgram(program)
}

test('a letter with a counter builds, and the counter is a hole through it', async () => {
  const { rings } = textScene('o')
  const nested = nestRings(rings)
  assert.equal(nested.length, 1, 'an "o" is one polygon')
  assert.equal(nested[0].length, 2, 'with one counter')

  const mesh = await buildText('o')
  const report = checkManifold(mesh)
  assert.ok(report.ok, `not watertight: ${report.danglingEdges} dangling edges`)

  // The ring of the letter, not the disc it sits in: the counter is the
  // difference between the two, and it is what a filled "o" would lose.
  const [outer, counter] = nested[0]
  const ring = multiArea([[outer, counter]]) * THICKNESS
  const disc = multiArea([[outer]]) * THICKNESS
  assert.ok(disc - ring > 1, 'the test letter has no counter worth measuring')
  assert.ok(
    Math.abs(report.volume - ring) < 0.5,
    `expected the ring (${ring.toFixed(2)}), got ${report.volume.toFixed(2)} -- a filled "o" is ${disc.toFixed(2)}`,
  )
})

test('every letter builds, counter or not', async () => {
  // One glyph at a time so a failure names the letter. These are the ones with
  // counters plus a couple without, which always worked.
  for (const letter of [...'oabdegpqABDOPQR04689li']) {
    const mesh = await buildText(letter)
    assert.ok(mesh.triangleCount > 0, `"${letter}" produced no triangles`)
    assert.ok(checkManifold(mesh).volume > 0, `"${letter}" has no volume`)
  }
})

test('separate glyphs stay separate solids, and their counters stay open', async () => {
  // "lo" is the smallest case that mixes both: two glyphs, one counter. A
  // union across polygons is right; a union across rings is what filled it.
  const { rings } = textScene('lo')
  assert.equal(nestRings(rings).length, 2, 'two glyphs, two polygons')

  const mesh = await buildText('lo')
  const report = checkManifold(mesh)
  assert.ok(report.ok, `not watertight: ${report.danglingEdges} dangling edges`)

  const expected = multiArea(nestRings(rings)) * THICKNESS
  assert.ok(Math.abs(report.volume - expected) < 0.5, `unexpected volume ${report.volume}`)
})
