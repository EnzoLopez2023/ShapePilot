import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { VectorDrawing } from './vectorDrawing.ts'
import { VECTOR_LIMITS, VectorDrawingError, validateVectorDrawing } from './vectorDrawing.ts'

const square = (over: Record<string, unknown> = {}) => ({
  id: 'mark',
  name: 'Mark',
  commands: [
    { cmd: 'M', to: [0, 0] },
    { cmd: 'L', to: [10, 0] },
    { cmd: 'C', c1: [12, 3], c2: [12, 7], to: [10, 10] },
    { cmd: 'L', to: [0, 10] },
    { cmd: 'Z' },
  ],
  ...over,
})

const drawing = (paths: unknown[], over: Record<string, unknown> = {}): unknown => ({
  version: 1, units: 'mm', widthMm: 40, heightMm: 30, paths, ...over,
})

const rejects = (value: unknown, field: string) => {
  assert.throws(() => validateVectorDrawing(value), (e: unknown) => {
    assert.ok(e instanceof VectorDrawingError, `expected VectorDrawingError, got ${String(e)}`)
    assert.equal(e.field, field)
    return true
  })
}

test('accepts a minimal drawing and rebuilds rather than passing input through', () => {
  const input = drawing([square()]) as Record<string, unknown>
  const out: VectorDrawing = validateVectorDrawing(input)
  assert.equal(out.paths.length, 1)
  assert.equal(out.units, 'mm')
  assert.notEqual(out, input)
  assert.notEqual(out.paths[0], (input.paths as unknown[])[0])
})

test('rejects unknown keys anywhere', () => {
  rejects({ ...(drawing([square()]) as object), extra: 1 }, 'drawing')
  rejects(drawing([square({ extra: 1 })]), 'drawing.paths[0]')
  rejects(drawing([square({ commands: [{ cmd: 'M', to: [0, 0], nope: 1 }] })]),
    'drawing.paths[0].commands[0]')
})

test('rejects a wrong version and wrong units', () => {
  rejects(drawing([square()], { version: 2 }), 'drawing.version')
  rejects(drawing([square()], { units: 'in' }), 'drawing.units')
})

test('rejects a non-positive or oversize artwork box', () => {
  rejects(drawing([square()], { widthMm: 0 }), 'drawing.widthMm')
  rejects(drawing([square()], { heightMm: VECTOR_LIMITS.maxDimensionMm + 1 }), 'drawing.heightMm')
})

test('refuses numeric strings, NaN and Infinity in a coordinate', () => {
  rejects(drawing([square({ commands: [{ cmd: 'M', to: ['0', 0] }] })]),
    'drawing.paths[0].commands[0].to[0]')
  rejects(drawing([square({ commands: [{ cmd: 'M', to: [NaN, 0] }] })]),
    'drawing.paths[0].commands[0].to[0]')
  rejects(drawing([square({ commands: [{ cmd: 'M', to: [0, Infinity] }] })]),
    'drawing.paths[0].commands[0].to[1]')
})

test('bounds a coordinate to the sanity envelope', () => {
  rejects(drawing([square({ commands: [{ cmd: 'M', to: [VECTOR_LIMITS.maxCoordMm + 1, 0] }] })]),
    'drawing.paths[0].commands[0].to[0]')
})

test('rejects an unknown command', () => {
  rejects(drawing([square({ commands: [{ cmd: 'M', to: [0, 0] }, { cmd: 'Q', to: [1, 1] }] })]),
    'drawing.paths[0].commands[1].cmd')
})

test('a subpath must open with M before any line, curve or close', () => {
  rejects(drawing([square({ commands: [{ cmd: 'L', to: [1, 1] }] })]),
    'drawing.paths[0].commands[0]')
  rejects(drawing([square({ commands: [{ cmd: 'M', to: [0, 0] }, { cmd: 'Z' }, { cmd: 'Z' }] })]),
    'drawing.paths[0].commands[2]')
})

test('rejects a bad fill colour', () => {
  rejects(drawing([square({ fill: 'black' })]), 'drawing.paths[0].fill')
  rejects(drawing([square({ fill: '#abc' })]), 'drawing.paths[0].fill')
})

test('lowercases an accepted fill colour', () => {
  const out = validateVectorDrawing(drawing([square({ fill: '#AABBCC' })]))
  assert.equal(out.paths[0].fill, '#aabbcc')
})

test('refuses duplicate path ids, which would make an edit ambiguous', () => {
  rejects(drawing([square(), square()]), 'drawing.paths[1].id')
})

test('bounds the path count and the total command count', () => {
  const many = Array.from({ length: VECTOR_LIMITS.maxPaths + 1 },
    (_, i) => square({ id: `p${i}` }))
  rejects(drawing(many), 'drawing.paths')

  const longRun = [
    { cmd: 'M', to: [0, 0] },
    ...Array.from({ length: VECTOR_LIMITS.maxCommandsPerPath }, () => ({ cmd: 'L', to: [1, 1] })),
  ]
  rejects(drawing([square({ commands: longRun })]), 'drawing.paths[0].commands')
})
