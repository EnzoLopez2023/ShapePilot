// An imported model must be a first-class solid: renderable, groupable,
// cuttable and exportable. Before the `mesh` op existed, `objectNode` returned
// null for an imported object, so importing an STL added a row to the object
// tree and produced no geometry at all.
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { checkManifold } from '../geometry/mesh.ts'
import { validateShapeProgram } from '../../lib/contracts/shapeProgram.ts'
import { createSolid, groupObjects, newId } from '../model/scene.ts'
import type { AssetRef, SceneObject } from '../model/document.ts'
import { IDENTITY_TRANSFORM } from '../model/scene.ts'
import { evaluateNode, evaluateProgram } from './evaluate.ts'
import { programFromScene } from './fromScene.ts'
import { programToObjects } from './toScene.ts'

const HASH = 'a'.repeat(64)

const asset: AssetRef = { hash: HASH, filename: 'part.stl', byteLength: 1 }

const importedObject = (over: Partial<SceneObject> = {}): SceneObject => ({
  id: newId(),
  name: 'Imported part',
  transform: IDENTITY_TRANSFORM,
  mode: 'solid',
  visible: true,
  locked: false,
  type: 'imported',
  format: 'stl',
  asset,
  ...over,
} as SceneObject)

/** A 20 mm cube, built through the kernel so it is a genuine watertight mesh --
 *  the same shape an STL import would produce. */
const cube = async () => evaluateNode({
  id: 'src', name: 'src', op: 'box',
  params: { widthMm: 20, depthMm: 20, heightMm: 20 },
  transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
})

test('an imported object compiles to a mesh node keyed by its content hash', () => {
  const program = programFromScene([importedObject()])
  assert.equal(program.parts.length, 1)
  assert.equal(program.parts[0].op, 'mesh')
  assert.deepEqual(
    (program.parts[0] as { params: { meshId?: string } }).params.meshId, HASH)
})

test('the program stays small: triangles travel beside it, not inside it', () => {
  // A 60 MB STL inlined as JSON would blow the validator's bounds and make the
  // program useless as AI context.
  const program = programFromScene([importedObject()])
  assert.ok(JSON.stringify(program).length < 400)
  assert.doesNotThrow(() => validateShapeProgram(JSON.parse(JSON.stringify(program))))
})

test('an imported mesh evaluates to the solid it came from', async () => {
  const source = await cube()
  const program = programFromScene([importedObject()])
  const mesh = await evaluateProgram(program, { meshes: new Map([[HASH, source]]) })

  const report = checkManifold(mesh)
  assert.ok(report.ok, 'the imported solid should still be watertight')
  assert.ok(Math.abs(report.volume - 8_000) < 1, `unexpected volume ${report.volume}`)
})

test('an import can be cut by a hole grouped with it', async () => {
  // This is the whole point of making it a program node rather than a mesh
  // rendered off to the side.
  const source = await cube()
  const imported = importedObject()
  const bore = {
    ...createSolid('cylinder', [0, 0, -5], { radiusMm: 5, heightMm: 30, segments: 48 }),
    mode: 'hole' as const,
  }
  const { objects } = groupObjects([imported, bore], new Set([imported.id, bore.id]))

  const mesh = await evaluateProgram(
    programFromScene(objects), { meshes: new Map([[HASH, source]]) })
  const report = checkManifold(mesh)
  assert.ok(report.ok, 'the cut import should be watertight')

  const cylinder = (48 / 2) * 25 * Math.sin((2 * Math.PI) / 48) * 20
  assert.ok(Math.abs(report.volume - (8_000 - cylinder)) < 1,
    `expected the bore to be removed, volume was ${report.volume}`)
})

test('a transform on the import is honoured', async () => {
  const source = await cube()
  const moved = importedObject({
    transform: { position: [100, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
  })
  const mesh = await evaluateProgram(
    programFromScene([moved]), { meshes: new Map([[HASH, source]]) })
  assert.ok(Math.abs(mesh.bbox[0] - 90) < 1e-3, `minX was ${mesh.bbox[0]}`)
})

test('a missing file is a named failure, not a silently empty solid', async () => {
  // Assets are not authoritative and may genuinely be absent. Producing an
  // empty mesh instead would export a blank STL and look like success.
  await assert.rejects(
    () => evaluateProgram(programFromScene([importedObject()]), { meshes: new Map() }),
    /is not available/,
  )
})

test('the AI is never offered the mesh op, so it cannot invent a hash', async () => {
  const { AI_PRIMITIVE_OPS, PRIMITIVE_OPS } =
    await import('../../lib/contracts/shapeProgram.ts')
  assert.ok(PRIMITIVE_OPS.includes('mesh'))
  assert.ok(!AI_PRIMITIVE_OPS.includes('mesh'))
})

test('a mesh node has no scene form, since only an import can create one', () => {
  const program = programFromScene([importedObject()])
  assert.deepEqual(programToObjects(program), [])
})
