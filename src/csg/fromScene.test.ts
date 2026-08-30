import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createShape2D, createSolid, groupObjects } from '../model/scene.ts'
import { validateShapeProgram } from '../../lib/contracts/shapeProgram.ts'
import { checkManifold } from '../geometry/mesh.ts'
import { evaluateProgram } from './evaluate.ts'
import { objectNode, programFromScene } from './fromScene.ts'

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
