import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'vitest'
import { parse } from 'opentype.js'
import { multiArea, multiBBox, signedArea } from '../geometry/vec.ts'
import { createText } from '../model/scene.ts'
import { textOutlines } from './fonts.ts'

// Read the vendored file directly: this suite is Node, and the point is to
// prove the binary in the repo traces correctly.
const font = parse(
  readFileSync('public/fonts/archivo-medium.ttf').buffer as ArrayBuffer,
)

const rings = (text: string, sizeMm = 20) =>
  textOutlines(font, { ...createText(text), sizeMm })

/**
 * Bounds over every contour. Each is wrapped as its own polygon on purpose:
 * multiBBox measures only a polygon's outer ring, so handing it all the
 * contours as one polygon would measure the first letter alone.
 */
const boundsOf = (out: ReturnType<typeof rings>) =>
  multiBBox(out.map(r => [r.map(([x, y]) => [x, y] as const)]))

test('the vendored font parses and has glyphs', () => {
  assert.ok(font.unitsPerEm > 0)
  assert.ok(font.stringToGlyphs('A').length === 1)
})

test('a letter traces to a closed outline at the requested size', () => {
  const out = rings('H', 20)
  assert.ok(out.length >= 1)
  const b = boundsOf(out)
  // Cap height is well under the em size but not tiny; a capital H at 20 mm
  // should land in a believable band rather than at 0 or 200.
  const height = b.maxY - b.minY
  assert.ok(height > 10 && height < 20, `unexpected cap height ${height}`)
})

test('a counter comes back as a hole, not a solid disc', () => {
  // "o" has one outer contour and one counter. Without containment nesting it
  // would cut as a filled blob.
  const out = rings('o', 20)
  assert.equal(out.length, 2, 'expected an outer contour and a counter')
  const outer = out[0].map(([x, y]) => [x, y] as const)
  const inner = out[1].map(([x, y]) => [x, y] as const)
  assert.ok(signedArea(outer) > 0, 'outer must be counter-clockwise')
  assert.ok(signedArea(inner) < 0, 'the counter must be clockwise')
  // Net area is the ring of the letter, strictly less than the outer contour.
  assert.ok(multiArea([[outer, inner]]) < Math.abs(signedArea(outer)))
})

test('outlines are centred on the run, so rotation turns about the text', () => {
  const out = rings('ABC', 12)
  const b = boundsOf(out)
  assert.ok(Math.abs((b.minX + b.maxX) / 2) < 0.01, 'x should be centred')
  assert.ok(Math.abs((b.minY + b.maxY) / 2) < 0.01, 'y should be centred')
})

test('size scales the outlines linearly', () => {
  const small = boundsOf(rings('M', 10))
  const large = boundsOf(rings('M', 20))
  const ratio = (large.maxX - large.minX) / (small.maxX - small.minX)
  assert.ok(Math.abs(ratio - 2) < 0.02, `expected 2x, got ${ratio}`)
})

test('text reads left to right, y-up', () => {
  const one = boundsOf(rings('l', 20))
  const two = boundsOf(rings('ll', 20))
  // A second stem widens the run without changing its height.
  assert.ok(two.maxX - two.minX > one.maxX - one.minX, 'two "l"s should be wider than one')
  assert.ok(Math.abs((two.maxY - two.minY) - (one.maxY - one.minY)) < 0.01)
})

test('empty or whitespace text produces nothing rather than throwing', () => {
  assert.deepEqual(rings(''), [])
  assert.deepEqual(rings('   '), [])
})
