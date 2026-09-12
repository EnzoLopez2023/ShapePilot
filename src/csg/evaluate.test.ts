import assert from 'node:assert/strict'
import { test } from 'vitest'
import { checkManifold } from '../geometry/mesh.ts'
import type { PartNode } from '../../lib/contracts/shapeProgram.ts'
import { validateShapeProgram } from '../../lib/contracts/shapeProgram.ts'
import { evaluateNode, evaluateProgram } from './evaluate.ts'

const IDENTITY = { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] } as const

const prim = (op: string, params: Record<string, number>, id = op): PartNode =>
  ({ id, name: id, op, params, transform: IDENTITY } as PartNode)

const PRIMITIVES: PartNode[] = [
  prim('box', { widthMm: 20, depthMm: 14, heightMm: 8 }),
  prim('box', { widthMm: 20, depthMm: 14, heightMm: 8, cornerRadiusMm: 3 }, 'rounded-box'),
  prim('cylinder', { radiusMm: 6, heightMm: 15, segments: 48 }),
  prim('sphere', { radiusMm: 7, segments: 32 }),
  prim('cone', { radiusMm: 8, topRadiusMm: 2, heightMm: 12, segments: 48 }),
  prim('torus', { radiusMm: 12, tubeMm: 3, segments: 32 }),
  prim('wedge', { widthMm: 18, depthMm: 10, heightMm: 9 }),
]

test('every primitive evaluates to a watertight solid', async () => {
  for (const node of PRIMITIVES) {
    const mesh = await evaluateNode(node)
    const report = checkManifold(mesh)
    assert.ok(mesh.triangleCount > 0, `${node.op} produced no triangles`)
    assert.ok(report.ok, `${node.op} is not watertight: ${report.danglingEdges} dangling edges`)
    assert.ok(report.volume > 0, `${node.op} has non-positive volume ${report.volume}`)
  }
})

test('primitives sit on the workplane', async () => {
  for (const node of PRIMITIVES) {
    const mesh = await evaluateNode(node)
    assert.ok(Math.abs(mesh.bbox[2]) < 1e-4, `${node.op} does not start at z = 0 (${mesh.bbox[2]})`)
  }
})

test('a difference stays watertight and loses volume', async () => {
  const solid = await evaluateNode(prim('box', { widthMm: 30, depthMm: 30, heightMm: 10 }, 'body'))
  const cut: PartNode = {
    id: 'g', name: 'Plate with hole', op: 'difference',
    transform: IDENTITY,
    children: [
      prim('box', { widthMm: 30, depthMm: 30, heightMm: 10 }, 'body'),
      prim('cylinder', { radiusMm: 4, heightMm: 40, segments: 48 }, 'hole'),
    ],
  }
  const mesh = await evaluateNode(cut)
  const report = checkManifold(mesh)
  assert.ok(report.ok, `difference is not watertight: ${report.danglingEdges} dangling edges`)
  assert.ok(report.volume > 0)
  assert.ok(report.volume < checkManifold(solid).volume, 'subtraction should remove material')
})

test('union and intersection stay watertight', async () => {
  for (const op of ['union', 'intersection'] as const) {
    const node: PartNode = {
      id: op, name: op, op, transform: IDENTITY,
      children: [
        prim('box', { widthMm: 20, depthMm: 20, heightMm: 20 }, 'a'),
        prim('sphere', { radiusMm: 12, segments: 32 }, 'b'),
      ],
    }
    const report = checkManifold(await evaluateNode(node))
    assert.ok(report.ok, `${op} is not watertight`)
    assert.ok(report.volume > 0, `${op} has no volume`)
  }
})

test('a transform moves the solid without breaking it', async () => {
  const node: PartNode = {
    ...(prim('box', { widthMm: 10, depthMm: 10, heightMm: 10 }) as PartNode),
    transform: { position: [50, -20, 5], rotationDeg: [0, 0, 45], scale: [2, 1, 1] },
  }
  const mesh = await evaluateNode(node)
  assert.ok(checkManifold(mesh).ok)
  // Centre of the bbox tracks the translation; the box was centred in x/y and
  // sat on z = 0, so its own centre was (0, 0, 5) before the transform.
  assert.ok(Math.abs((mesh.bbox[0] + mesh.bbox[3]) / 2 - 50) < 1e-3)
  assert.ok(Math.abs((mesh.bbox[1] + mesh.bbox[4]) / 2 + 20) < 1e-3)
})

test('extrude accepts a profile with a hole', async () => {
  const outer = [[0, 0], [40, 0], [40, 30], [0, 30]]
  const hole = [[10, 10], [10, 20], [20, 20], [20, 10]]
  const node = {
    id: 'plate', name: 'Plate', op: 'extrude',
    params: { profile: outer, holes: [hole], heightMm: 4 },
    transform: IDENTITY,
  } as unknown as PartNode
  const report = checkManifold(await evaluateNode(node))
  assert.ok(report.ok, 'extrusion with a hole must stay watertight')
  // 40*30 - 10*10 = 1100 mm^2 at 4 mm thick.
  assert.ok(Math.abs(report.volume - 4400) < 1, `unexpected volume ${report.volume}`)
})

test('evaluateProgram unions the top-level parts', async () => {
  const program = validateShapeProgram({
    version: 1, units: 'mm',
    parts: [
      { id: 'a', name: 'A', op: 'box', params: { widthMm: 10, depthMm: 10, heightMm: 10 } },
      {
        id: 'b', name: 'B', op: 'box', params: { widthMm: 10, depthMm: 10, heightMm: 10 },
        transform: { position: [30, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
      },
    ],
  })
  const mesh = await evaluateProgram(program)
  assert.ok(checkManifold(mesh).ok)
  assert.ok(Math.abs(mesh.bbox[0] - -5) < 1e-4)
  assert.ok(Math.abs(mesh.bbox[3] - 35) < 1e-4)
})

test('a text node is refused rather than silently dropped', async () => {
  const node = {
    id: 't', name: 'T', op: 'text',
    params: { text: 'hi', heightMm: 3 }, transform: IDENTITY,
  } as unknown as PartNode
  await assert.rejects(() => evaluateNode(node), /expanded to extrusions/)
})

test('a box corner radius rounds the vertical edges only', async () => {
  const size = { widthMm: 20, depthMm: 14, heightMm: 8 }
  const square = await evaluateNode(prim('box', size, 'square'))
  const rounded = await evaluateNode(prim('box', { ...size, cornerRadiusMm: 3 }, 'rounded'))

  // Same footprint and same height: the rounding eats into the corners, it does
  // not shrink the part or chamfer the faces the plate and the nozzle see.
  assert.deepEqual(rounded.bbox.map(v => Math.round(v * 1e4) / 1e4), square.bbox)
  assert.ok(
    checkManifold(rounded).volume < checkManifold(square).volume,
    'rounding the corners should remove material',
  )
})

test('a box corner radius clamps to half the shorter side', async () => {
  const size = { widthMm: 20, depthMm: 14, heightMm: 8 }
  const asked = await evaluateNode(prim('box', { ...size, cornerRadiusMm: 500 }, 'asked'))
  const half = await evaluateNode(prim('box', { ...size, cornerRadiusMm: 7 }, 'half'))
  assert.ok(checkManifold(asked).ok, 'an over-large radius must still be watertight')
  assert.ok(
    Math.abs(checkManifold(asked).volume - checkManifold(half).volume) < 1e-6,
    'an over-large radius should settle at the obround',
  )
})
