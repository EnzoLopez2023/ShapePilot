// An AI proposal used to replace the whole scene, so anything the assistant
// could not see or could not write back -- an import, a top-level hole, a
// hidden part -- vanished on Apply, and every untouched part lost its colour.
import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { ShapeProgram } from '../../lib/contracts/shapeProgram.ts'
import { validateShapeProgram } from '../../lib/contracts/shapeProgram.ts'
import type { AssetRef, SceneObject } from '../model/document.ts'
import { IDENTITY_TRANSFORM, createSolid, createText, groupObjects } from '../model/scene.ts'
import { programFromScene } from './fromScene.ts'
import { mergeProposal } from './mergeProposal.ts'

const asset: AssetRef = { hash: 'a'.repeat(64), filename: 'badge.stl', byteLength: 1 }

const imported: SceneObject = {
  id: 'badge', name: 'Badge', type: 'imported', format: 'stl', asset,
  transform: IDENTITY_TRANSFORM, mode: 'solid', visible: true, locked: false,
}

const box = (id: string, over: Partial<SceneObject> = {}): SceneObject =>
  ({ ...createSolid('box'), id, name: id, ...over } as SceneObject)

/** What the server hands back: a validated copy, keys in its own order. */
const roundTrip = (program: ShapeProgram): ShapeProgram =>
  validateShapeProgram(JSON.parse(JSON.stringify(program)))

/** The model can only answer with ops it is allowed, so meshes drop out. */
const withoutMeshes = (program: ShapeProgram): ShapeProgram => ({
  ...program, parts: program.parts.filter(p => p.op !== 'mesh'),
})

test('an import survives a proposal that could not include it', () => {
  const objects = [box('base', { color: '#ff0000' }), imported]
  const sent = programFromScene(objects)
  const merged = mergeProposal(objects, sent, roundTrip(withoutMeshes(sent)))
  assert.deepEqual(merged.map(o => o.id), ['base', 'badge'])
  assert.equal(merged[1], imported)
})

test('an untouched part is the original object, colour and all', () => {
  const objects = [box('base', { color: '#ff0000', locked: true })]
  const sent = programFromScene(objects)
  const merged = mergeProposal(objects, sent, roundTrip(sent))
  assert.deepEqual(merged, objects)
})

test('text the model left alone stays editable text', () => {
  const text = { ...createText('Hi'), id: 'label' } as SceneObject
  const outlines = new Map([['label', [[[0, 0], [5, 0], [5, 5], [0, 5]] as [number, number][]]]])
  const sent = programFromScene([text], { textOutlines: outlines })
  const merged = mergeProposal([text], sent, roundTrip(sent))
  assert.equal(merged[0].type, 'text')
})

test('a changed part is rebuilt but keeps its colour and lock', () => {
  const objects = [box('base', { color: '#00ff00', locked: true })]
  const sent = programFromScene(objects)
  const proposed = roundTrip(sent)
  const part = proposed.parts[0]
  if (part.op !== 'box') throw new Error('expected a box')
  part.params.heightMm = 42
  const [merged] = mergeProposal(objects, sent, proposed)
  assert.equal(merged.type === 'solid' && merged.params.heightMm, 42)
  assert.equal(merged.color, '#00ff00')
  assert.equal(merged.locked, true)
})

test('what the model was never shown is kept: top-level holes and hidden parts', () => {
  const objects = [
    box('base'),
    box('loose-hole', { mode: 'hole' }),
    box('hidden', { visible: false }),
  ]
  const sent = programFromScene(objects)
  const merged = mergeProposal(objects, sent, roundTrip(sent))
  assert.deepEqual(merged.map(o => o.id), ['base', 'loose-hole', 'hidden'])
})

test('a part the model was shown and left out is removed; new parts append', () => {
  const objects = [box('base'), box('peg'), imported]
  const sent = programFromScene(objects)
  const proposed = roundTrip({
    ...sent,
    parts: [sent.parts[0], { ...sent.parts[0], id: 'foot', name: 'foot' }],
  })
  const merged = mergeProposal(objects, sent, proposed)
  assert.deepEqual(merged.map(o => o.id), ['base', 'badge', 'foot'])
})

test('an import inside a group the model changed is kept in that group', () => {
  const grouped = groupObjects([box('plate'), imported], new Set(['plate', 'badge']))
  const group = grouped.objects[0]
  const sent = programFromScene(grouped.objects)
  const node = sent.parts[0]
  if (node.op !== 'union') throw new Error('expected a union')
  const proposed = roundTrip({
    ...sent,
    parts: [{ ...node, children: [...node.children.filter(c => c.op !== 'mesh'), { ...node.children[0], id: 'rib', name: 'rib' }] }],
  })
  const [merged] = mergeProposal(grouped.objects, sent, proposed)
  assert.equal(merged.id, group.id)
  assert.equal(merged.type, 'group')
  if (merged.type !== 'group') return
  assert.deepEqual(merged.children.map(c => c.id).sort(), ['badge', 'plate', 'rib'])
})

test('a new part that reuses an import id gets its own id', () => {
  const objects = [imported]
  const sent = programFromScene(objects)
  const proposed = roundTrip({
    ...sent,
    parts: [{ id: 'badge', name: 'box', op: 'box', params: { widthMm: 5, depthMm: 5, heightMm: 5 }, transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] } }],
  })
  const merged = mergeProposal(objects, sent, proposed)
  assert.equal(merged.length, 2)
  assert.equal(merged[0], imported)
  assert.notEqual(merged[1].id, 'badge')
})
