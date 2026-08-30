import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { ShapeProgram } from './shapeProgram.ts'
import { PROGRAM_LIMITS, ShapeProgramError, validateShapeProgram } from './shapeProgram.ts'

const node = (over: Record<string, unknown> = {}) => ({
  id: 'body', name: 'Body', op: 'box',
  params: { widthMm: 10, depthMm: 10, heightMm: 10 },
  ...over,
})

const program = (parts: unknown[]): unknown => ({ version: 1, units: 'mm', parts })

const rejects = (value: unknown, field: string) => {
  assert.throws(() => validateShapeProgram(value), (e: unknown) => {
    assert.ok(e instanceof ShapeProgramError, `expected ShapeProgramError, got ${String(e)}`)
    assert.equal(e.field, field)
    return true
  })
}

test('accepts a minimal program and fills the identity transform', () => {
  const out: ShapeProgram = validateShapeProgram(program([node()]))
  assert.equal(out.parts.length, 1)
  assert.deepEqual(out.parts[0].transform, {
    position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1],
  })
})

test('rebuilds rather than passing input through', () => {
  const input = program([node()]) as Record<string, unknown>
  const out = validateShapeProgram(input)
  assert.notEqual(out, input)
  assert.notEqual(out.parts[0], (input.parts as unknown[])[0])
})

test('rejects unknown keys anywhere', () => {
  rejects({ ...(program([node()]) as object), extra: 1 }, 'program')
  rejects(program([node({ extra: 1 })]), 'program.parts[0]')
  rejects(program([node({ params: { widthMm: 1, depthMm: 1, heightMm: 1, nope: 2 } })]),
    'program.parts[0].params')
})

test('rejects a wrong version and wrong units', () => {
  rejects({ version: 2, units: 'mm', parts: [node()] }, 'program.version')
  rejects({ version: 1, units: 'in', parts: [node()] }, 'program.units')
})

test('requires the params each op actually needs', () => {
  rejects(program([node({ op: 'cylinder', params: { radiusMm: 5 } })]),
    'program.parts[0].params.heightMm')
  rejects(program([node({ op: 'sphere', params: {} })]),
    'program.parts[0].params.radiusMm')
  rejects(program([node({ op: 'extrude', params: { heightMm: 3 } })]),
    'program.parts[0].params.profile')
})

test('refuses numeric strings, NaN and Infinity', () => {
  rejects(program([node({ params: { widthMm: '10', depthMm: 10, heightMm: 10 } })]),
    'program.parts[0].params.widthMm')
  rejects(program([node({ params: { widthMm: NaN, depthMm: 10, heightMm: 10 } })]),
    'program.parts[0].params.widthMm')
  rejects(program([node({ params: { widthMm: Infinity, depthMm: 10, heightMm: 10 } })]),
    'program.parts[0].params.widthMm')
})

test('refuses a non-positive scale, which would invert or collapse the solid', () => {
  rejects(program([node({ transform: { scale: [1, 0, 1] } })]),
    'program.parts[0].transform.scale[1]')
  rejects(program([node({ transform: { scale: [1, -2, 1] } })]),
    'program.parts[0].transform.scale[1]')
})

test('refuses a self-intersecting torus', () => {
  rejects(program([node({ op: 'torus', params: { radiusMm: 5, tubeMm: 5 } })]),
    'program.parts[0].params.tubeMm')
})

test('validates boolean children recursively and refuses empty ones', () => {
  const ok = validateShapeProgram(program([{
    id: 'g', name: 'Stand', op: 'difference',
    children: [node(), node({ id: 'hole', name: 'Cable hole', op: 'cylinder', params: { radiusMm: 4, heightMm: 30 } })],
  }]))
  assert.equal(ok.parts[0].op, 'difference')
  rejects(program([{ id: 'g', name: 'G', op: 'union', children: [] }]), 'program.parts[0].children')
})

test('refuses duplicate ids, which would make an edit ambiguous', () => {
  rejects(program([node(), node()]), 'program.parts[1].id')
})

test('bounds node count and nesting depth', () => {
  const many = Array.from({ length: PROGRAM_LIMITS.maxParts + 1 }, (_, i) => node({ id: `n${i}` }))
  rejects(program(many), 'program.parts')

  let deep: Record<string, unknown> = node({ id: 'leaf' })
  for (let i = 0; i <= PROGRAM_LIMITS.maxDepth; i++) {
    deep = { id: `g${i}`, name: 'G', op: 'union', children: [deep] }
  }
  assert.throws(() => validateShapeProgram(program([deep])), ShapeProgramError)
})

test('bounds profile size for extrude', () => {
  const profile = Array.from({ length: PROGRAM_LIMITS.maxProfilePoints + 1 }, (_, i) => [i, 0])
  rejects(program([node({ op: 'extrude', params: { profile, heightMm: 2 } })]),
    'program.parts[0].params.profile')
  rejects(program([node({ op: 'extrude', params: { profile: [[0, 0], [1, 0]], heightMm: 2 } })]),
    'program.parts[0].params.profile')
})
