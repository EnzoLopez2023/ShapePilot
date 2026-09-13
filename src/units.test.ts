import assert from 'node:assert/strict'
import { test } from 'vitest'
import { formatImperial, formatLength, formatMeasure, formatSize, parseLength } from './units.ts'

test('formatImperial reduces to the simplest fraction at 1/32 resolution', () => {
  assert.equal(formatImperial(9.525), '3/8"')
  assert.equal(formatImperial(25.4), '1"')
  assert.equal(formatImperial(31.75), '1-1/4"')
  assert.equal(formatImperial(0), '0"')
})

test('formatImperial handles negative lengths', () => {
  assert.equal(formatImperial(-9.525), '-3/8"')
})

test('parseLength reads whole-and-fraction, bare fraction, and decimal-as-inches', () => {
  assert.ok(Math.abs((parseLength('3/8', true) ?? NaN) - 9.525) < 1e-6)
  assert.ok(Math.abs((parseLength('1-3/8', true) ?? NaN) - 34.925) < 1e-6)
  assert.ok(Math.abs((parseLength('1.25', true) ?? NaN) - 31.75) < 1e-6)
})

test('parseLength preserves the sign of bare negative fractions', () => {
  assert.ok(Math.abs((parseLength('-1/32', true) ?? NaN) + 0.79375) < 1e-6)
  assert.ok(Math.abs((parseLength('-1/2"', true) ?? NaN) + 12.7) < 1e-6)
  assert.ok(Math.abs((parseLength('-3/8', true) ?? NaN) + 9.525) < 1e-6)
})

test('parseLength in mm mode reads a plain decimal as millimetres', () => {
  assert.equal(parseLength('12.5', false), 12.5)
})

test('parseLength returns null for unparseable input, letting the caller keep the old value', () => {
  assert.equal(parseLength('not a number', true), null)
  assert.equal(parseLength('', true), null)
})

test('formatLength and parseLength round-trip through both unit modes', () => {
  for (const mm of [0, 1, 18.6, 100, 248]) {
    for (const imperial of [false, true]) {
      const roundTripped = parseLength(formatLength(mm, imperial), imperial)
      assert.ok(roundTripped != null && Math.abs(roundTripped - mm) < 0.4,  // half of 1/32" in mm
        `${mm}mm imperial=${imperial}: round-trip got ${roundTripped}`)
    }
  }
})

test('a measured length is a readout, not a field: two decimals, unit once', () => {
  assert.equal(formatMeasure(31.17691, false), '31.18 mm')
  assert.equal(formatMeasure(40, false), '40 mm')
  assert.equal(formatSize([40, 25], false), '40 × 25 mm')
  assert.equal(formatSize([47.4499, 20, 20], false), '47.45 × 20 × 20 mm')
  // Inches carry their own mark, so each figure keeps it.
  assert.equal(formatSize([25.4, 12.7], true), '1" × 1/2"')
})
