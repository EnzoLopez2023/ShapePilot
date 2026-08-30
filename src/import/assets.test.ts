// Where an imported file's bytes come from, and what happens when they are
// nowhere. Each test uses its own content hash: the caches are module-level on
// purpose (a hash names immutable bytes), so they persist across tests exactly
// as they persist across renders.
import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import type { Mesh } from '../geometry/mesh.ts'
import type { SceneObject } from '../model/document.ts'

const local = new Map<string, ArrayBuffer>()
const remote = new Map<string, ArrayBuffer>()
const uploaded: string[] = []
let storeAvailable = true

vi.mock('./assetStore.ts', () => ({
  assetStoreAvailable: () => storeAvailable,
  getAsset: async (hash: string) => {
    const bytes = local.get(hash)
    return bytes ? { hash, filename: 'f.stl', format: 'stl', bytes, storedAt: '' } : undefined
  },
  putAsset: async (bytes: ArrayBuffer, filename: string) => {
    local.set('put', bytes)
    return { hash: 'put', filename, byteLength: bytes.byteLength }
  },
}))

vi.mock('../services/designAssets.ts', () => ({
  fetchAsset: async (hash: string) => remote.get(hash) ?? null,
  uploadAsset: async (hash: string) => {
    uploaded.push(hash)
    return { hash, filename: 'f.stl', format: 'stl', byteLength: 1, createdAt: '' }
  },
  listAssets: async () => [],
}))

const stubMesh: Mesh = {
  positions: new Float32Array([0, 0, 0]),
  indices: new Uint32Array([0, 0, 0]),
  triangleCount: 1,
  bbox: [0, 0, 0, 1, 1, 1],
}
let parseCalls = 0

const importStlMock = vi.hoisted(() => vi.fn())

vi.mock('./mesh.ts', () => ({
  importStl: importStlMock,
  importObj: async () => ({ kind: '3d', format: 'obj', mesh: stubMesh }),
  importThreeMf: async () => ({ kind: '3d', format: '3mf', mesh: stubMesh }),
  geometryToMesh: () => stubMesh,
}))

const { resolveAssets } = await import('./assets.ts')

const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer

const importedObject = (hash: string): SceneObject => ({
  id: `object-${hash}`,
  name: 'Imported',
  transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
  mode: 'solid',
  visible: true,
  locked: false,
  type: 'imported',
  format: 'stl',
  asset: { hash, filename: 'f.stl', byteLength: 4 },
})

beforeEach(() => {
  uploaded.length = 0
  parseCalls = 0
  storeAvailable = true
  importStlMock.mockReset()
  importStlMock.mockImplementation(async () => {
    parseCalls += 1
    return { kind: '3d', format: 'stl', mesh: stubMesh }
  })
})

test('a scene with no imports resolves to nothing and touches neither store', async () => {
  const result = await resolveAssets([])
  assert.equal(result.meshes.size, 0)
  assert.equal(result.detached.size, 0)
  assert.deepEqual(uploaded, [])
})

test('bytes cached locally are used without asking the server', async () => {
  const hash = 'local1'
  local.set(hash, bytes('stl'))

  const result = await resolveAssets([importedObject(hash)])
  assert.ok(result.meshes.has(hash))
  assert.equal(result.detached.size, 0)
})

test('bytes only on the server are fetched, which is the cross-device case', async () => {
  const hash = 'remote1'
  remote.set(hash, bytes('stl'))

  const result = await resolveAssets([importedObject(hash)])
  assert.ok(result.meshes.has(hash), 'should have resolved from the server')
  assert.equal(result.detached.size, 0)
  // It came from the server, so it must not be sent straight back.
  assert.deepEqual(uploaded, [])
})

test('a file found only locally is uploaded, once, so other devices get it', async () => {
  const hash = 'local2'
  local.set(hash, bytes('stl'))

  await resolveAssets([importedObject(hash)])
  await resolveAssets([importedObject(hash)])
  await Promise.all([
    resolveAssets([importedObject(hash)]),
    resolveAssets([importedObject(hash)]),
  ])

  // The opportunistic upload fires on every resolve, and a scene resolves
  // several times per render. Re-sending 60 MB each time is the bug this pins.
  assert.deepEqual(uploaded, [hash])
})

test('bytes are parsed once and reused', async () => {
  const hash = 'parse1'
  local.set(hash, bytes('stl'))

  await resolveAssets([importedObject(hash)])
  const first = parseCalls
  await resolveAssets([importedObject(hash)])

  assert.equal(first, 1)
  assert.equal(parseCalls, 1, 'a 60 MB STL must not be re-parsed on every render')
})

test('bytes nowhere means detached, and the rest of the scene still resolves', async () => {
  const present = 'present1'
  local.set(present, bytes('stl'))
  const absent = 'absent1'

  const result = await resolveAssets([importedObject(present), importedObject(absent)])

  assert.ok(result.meshes.has(present))
  assert.ok(result.detached.has(`object-${absent}`))
  // The design opens either way: assets are not authoritative.
  assert.equal(result.detached.has(`object-${present}`), false)
})

test('a file that will not parse reports as detached rather than throwing', async () => {
  const hash = 'bad1'
  local.set(hash, bytes('not an stl'))
  importStlMock.mockRejectedValueOnce(new Error('unparseable'))

  const result = await resolveAssets([importedObject(hash)])
  assert.ok(result.detached.has(`object-${hash}`))
  assert.equal(result.meshes.size, 0)
})

test('no local store at all still resolves from the server', async () => {
  // A private window, or a browser with site data blocked.
  storeAvailable = false
  const hash = 'noidb1'
  remote.set(hash, bytes('stl'))

  const result = await resolveAssets([importedObject(hash)])
  assert.ok(result.meshes.has(hash))
})
