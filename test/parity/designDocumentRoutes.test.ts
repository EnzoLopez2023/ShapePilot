// Design-document route and repository behaviour, asserted against the real
// Express app and a throwaway SQLite database: the round trip, ownership
// isolation, the kind filter, clone retargeting, and that validation refuses a
// malformed scene before anything reaches storage.
import assert from 'node:assert/strict'
import { afterAll, beforeAll, describe, test } from 'vitest'
import {
  OTHER_OID, startTestServer, stubVerifier, validClaims,
} from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'

const OWNER_TOKEN = 'owner-token'
const OTHER_TOKEN = 'other-token'
const BASE = '/api/design-documents'

const transform = {
  position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1],
}

const solid = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `Solid ${id}`, type: 'solid', primitive: 'box',
  params: { widthMm: 10, depthMm: 10, heightMm: 10 },
  transform, mode: 'solid', visible: true, locked: false,
  ...over,
})

const docPayload = (over: Record<string, unknown> = {}) => ({
  kind: 'bambu',
  name: 'Test model',
  objects: [solid('a'), solid('b')],
  machine: {
    kind: 'printer', id: 'bambu-x2d', label: 'Bambu Lab X2D',
    buildMm: [256, 256, 260], dualNozzleBuildMm: [235.5, 256, 256],
    nozzleDiameterMm: 0.4, maxNozzleC: 300, maxBedC: 120, chamberC: 65,
  },
  ...over,
})

interface Summary {
  id: string; kind: string; name: string; objectCount: number
  createdAt: string; updatedAt: string
}

describe('design document routes', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startTestServer({
      label: 'design-docs',
      verifier: stubVerifier({
        [OWNER_TOKEN]: validClaims(),
        [OTHER_TOKEN]: validClaims({ oid: OTHER_OID }),
      }),
    })
  })

  afterAll(async () => { await server.close() })

  const create = (payload: unknown, token = OWNER_TOKEN) =>
    server.fetchJson<{ id: string }>(BASE, { method: 'POST', token, body: JSON.stringify(payload) })

  test('create returns 201 and a string id', async () => {
    const created = await create(docPayload())
    assert.equal(created.status, 201)
    assert.match(created.body.id, /^\d+$/)
  })

  test('a document round-trips with its scene intact', async () => {
    const created = await create(docPayload({ name: 'Round trip', notes: 'a note' }))
    const got = await server.fetchJson<Record<string, unknown>>(
      `${BASE}/${created.body.id}`, { token: OWNER_TOKEN })

    assert.equal(got.status, 200)
    assert.equal(got.body.id, created.body.id)
    assert.equal(got.body.name, 'Round trip')
    assert.equal(got.body.notes, 'a note')
    assert.equal(got.body.kind, 'bambu')
    // Revision is client-side history state and always leaves the server at 0.
    assert.equal(got.body.revision, 0)
    const objects = got.body.objects as Record<string, unknown>[]
    assert.equal(objects.length, 2)
    assert.equal(objects[0].primitive, 'box')
    assert.deepEqual(objects[0].transform, transform)
    assert.equal((got.body.machine as Record<string, unknown>).id, 'bambu-x2d')
  })

  test('a nested group survives storage', async () => {
    const group = {
      id: 'g', name: 'Group', type: 'group', transform, mode: 'solid',
      visible: true, locked: false,
      children: [solid('c1'), solid('c2', { mode: 'hole' })],
    }
    const created = await create(docPayload({ objects: [group] }))
    const got = await server.fetchJson<Record<string, unknown>>(
      `${BASE}/${created.body.id}`, { token: OWNER_TOKEN })

    const objects = got.body.objects as Record<string, unknown>[]
    const children = objects[0].children as Record<string, unknown>[]
    assert.equal(children.length, 2)
    assert.equal(children[1].mode, 'hole')
  })

  test('list reports the object count without parsing the scene', async () => {
    const created = await create(docPayload({ name: 'Counted', objects: [solid('x')] }))
    const list = await server.fetchJson<Summary[]>(BASE, { token: OWNER_TOKEN })
    const row = list.body.find(d => d.id === created.body.id)
    assert.ok(row)
    assert.equal(row.objectCount, 1)
    assert.equal(row.kind, 'bambu')
  })

  test('the kind filter only returns that kind', async () => {
    await create(docPayload({ kind: 'shaper', name: 'A cut', objects: [], machine: undefined }))
    const shaper = await server.fetchJson<Summary[]>(`${BASE}?kind=shaper`, { token: OWNER_TOKEN })
    assert.ok(shaper.body.length > 0)
    assert.ok(shaper.body.every(d => d.kind === 'shaper'))

    const bad = await server.fetchJson(`${BASE}?kind=nope`, { token: OWNER_TOKEN })
    assert.equal(bad.status, 400)
  })

  test('update replaces the scene', async () => {
    const created = await create(docPayload())
    const put = await server.fetchJson<{ ok: true }>(`${BASE}/${created.body.id}`, {
      method: 'PUT', token: OWNER_TOKEN,
      body: JSON.stringify(docPayload({ name: 'Renamed', objects: [solid('only')] })),
    })
    assert.equal(put.status, 200)

    const got = await server.fetchJson<Record<string, unknown>>(
      `${BASE}/${created.body.id}`, { token: OWNER_TOKEN })
    assert.equal(got.body.name, 'Renamed')
    assert.equal((got.body.objects as unknown[]).length, 1)
  })

  test('clone can retarget the kind, which is the cross-designer handoff', async () => {
    const created = await create(docPayload({ kind: 'playground', name: 'Idea' }))
    const cloned = await server.fetchJson<{ id: string }>(`${BASE}/${created.body.id}/clone`, {
      method: 'POST', token: OWNER_TOKEN,
      body: JSON.stringify({ name: 'Idea in Bambu', kind: 'bambu' }),
    })
    assert.equal(cloned.status, 201)
    assert.notEqual(cloned.body.id, created.body.id)

    const copy = await server.fetchJson<Record<string, unknown>>(
      `${BASE}/${cloned.body.id}`, { token: OWNER_TOKEN })
    assert.equal(copy.body.kind, 'bambu')
    assert.equal(copy.body.name, 'Idea in Bambu')
    assert.equal((copy.body.objects as unknown[]).length, 2)

    // The original is untouched.
    const original = await server.fetchJson<Record<string, unknown>>(
      `${BASE}/${created.body.id}`, { token: OWNER_TOKEN })
    assert.equal(original.body.kind, 'playground')
  })

  test('another user cannot read, update, clone or delete the document', async () => {
    const created = await create(docPayload())
    const id = created.body.id

    assert.equal((await server.fetchJson(`${BASE}/${id}`, { token: OTHER_TOKEN })).status, 404)
    assert.equal((await server.fetchJson(`${BASE}/${id}`, {
      method: 'PUT', token: OTHER_TOKEN, body: JSON.stringify(docPayload()),
    })).status, 404)
    assert.equal((await server.fetchJson(`${BASE}/${id}/clone`, {
      method: 'POST', token: OTHER_TOKEN, body: JSON.stringify({}),
    })).status, 404)
    assert.equal((await server.fetchJson(`${BASE}/${id}`, {
      method: 'DELETE', token: OTHER_TOKEN,
    })).status, 404)

    // Still there for its owner.
    assert.equal((await server.fetchJson(`${BASE}/${id}`, { token: OWNER_TOKEN })).status, 200)
  })

  test('another user does not see it in their list', async () => {
    await create(docPayload({ name: 'Private' }))
    const theirs = await server.fetchJson<Summary[]>(BASE, { token: OTHER_TOKEN })
    assert.ok(theirs.body.every(d => d.name !== 'Private'))
  })

  test('delete removes it', async () => {
    const created = await create(docPayload())
    assert.equal((await server.fetchJson(`${BASE}/${created.body.id}`, {
      method: 'DELETE', token: OWNER_TOKEN,
    })).status, 200)
    assert.equal((await server.fetchJson(`${BASE}/${created.body.id}`, {
      token: OWNER_TOKEN,
    })).status, 404)
  })

  test('an unknown or non-numeric id is a 404, not a crash', async () => {
    for (const id of ['999999', 'abc', '../../etc/passwd', '1e3', '-1']) {
      const got = await server.fetchJson(`${BASE}/${encodeURIComponent(id)}`, { token: OWNER_TOKEN })
      assert.equal(got.status, 404, `id ${id}`)
    }
  })

  test('every route requires authentication', async () => {
    assert.equal((await server.fetchJson(BASE)).status, 401)
    assert.equal((await server.fetchJson(BASE, {
      method: 'POST', body: JSON.stringify(docPayload()),
    })).status, 401)
  })

  test('a malformed scene is a typed 400 naming the field', async () => {
    const cases: [unknown, string][] = [
      [docPayload({ kind: 'nope' }), 'kind'],
      [docPayload({ name: '' }), 'name'],
      [docPayload({ objects: 'not-an-array' }), 'objects'],
      [docPayload({ objects: [solid('a', { type: 'unknown-type' })] }), 'objects[0].type'],
      [docPayload({ objects: [solid('a', { visible: 'yes' })] }), 'objects[0].visible'],
      [docPayload({ objects: [solid('a', { params: { widthMm: '10' } })] }), 'objects[0].params.widthMm'],
      [docPayload({ objects: [solid('a', { params: { widthMm: NaN } })] }), 'objects[0].params.widthMm'],
      [docPayload({ objects: [solid('a', { extra: 1 })] }), 'objects[0]'],
      [docPayload({ objects: [solid('a', { transform: { ...transform, scale: [1, 0, 1] } })] }),
        'objects[0].transform.scale[1]'],
      [{ ...docPayload(), rogue: true }, 'body'],
    ]
    for (const [payload, field] of cases) {
      const res = await server.fetchJson<{ error: { code: string; details?: { field?: string } } }>(
        BASE, { method: 'POST', token: OWNER_TOKEN, body: JSON.stringify(payload) })
      assert.equal(res.status, 400, `expected 400 for ${field}`)
      assert.equal(res.body.error.code, 'bad_request')
      assert.equal(res.body.error.details?.field, field)
    }
  })

  test('an imported asset hash must be a real digest, or it would dangle', async () => {
    const imported = {
      id: 'i', name: 'Imported', type: 'imported', format: 'stl',
      transform, mode: 'solid', visible: true, locked: false,
      asset: { hash: 'not-a-hash', filename: 'part.stl', byteLength: 10 },
    }
    const res = await server.fetchJson<{ error: { details?: { field?: string } } }>(
      BASE, { method: 'POST', token: OWNER_TOKEN, body: JSON.stringify(docPayload({ objects: [imported] })) })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.details?.field, 'objects[0].asset.hash')
  })

  test('deeply nested groups are refused rather than recursed into forever', async () => {
    let node: Record<string, unknown> = solid('leaf')
    for (let i = 0; i < 20; i++) {
      node = {
        id: `g${i}`, name: 'G', type: 'group', transform, mode: 'solid',
        visible: true, locked: false, children: [node],
      }
    }
    const res = await server.fetchJson(BASE, {
      method: 'POST', token: OWNER_TOKEN, body: JSON.stringify(docPayload({ objects: [node] })),
    })
    assert.equal(res.status, 400)
  })
})
