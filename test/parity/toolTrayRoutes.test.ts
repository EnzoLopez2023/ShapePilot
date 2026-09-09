// Tool tray route and repository behaviour.
//
// Asserted against the real Express app and a throwaway SQLite database: the
// complete round trip, the pockets blob coming back as objects rather than a
// string, list order, the denormalised count staying in step, clone isolation,
// ownership isolation, unknown ids and the typed error envelope. The shape
// mirrors switchTrayRoutes.test.ts so the designers cannot quietly diverge on
// ownership or status codes.
import assert from 'node:assert/strict'
import { afterAll, beforeAll, describe, test } from 'vitest'
import {
  OTHER_OID, TEST_OID, TEST_TENANT, startTestServer, stubVerifier, validClaims,
} from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'

const OWNER_TOKEN = 'owner-token'
const OTHER_TOKEN = 'other-token'

/** A tiered pocket, so the round trip carries something genuinely nested. */
const hotend = {
  id: 'hotend-1',
  kind: 'composite',
  label: 'Hotend 0.4',
  presetId: 'bambu-hotend',
  x: 24,
  y: 20,
  widthMm: 19.4,
  heightMm: 60.9,
  rotationDeg: 90,
  mirrorX: true,
  steps: [
    { shape: { kind: 'rect', widthMm: 19.4, heightMm: 33, cornerRadiusMm: 1 }, offset: [0, 27.9], depthMm: 11 },
    { shape: { kind: 'rect', widthMm: 19.4, heightMm: 27.9, cornerRadiusMm: 1 }, offset: [0, 0], depthMm: 4 },
    { shape: { kind: 'rect', widthMm: 11, heightMm: 6, cornerRadiusMm: 1 }, offset: [4.2, 0], depthMm: 7 },
  ],
  fingerAccess: { style: 'scallop', side: 'left', widthMm: 12, reachMm: 5 },
}

/** A channel, because its path is the one field that is a list of points. */
const allen = {
  id: 'allen-1',
  kind: 'channel',
  x: 24,
  y: 118,
  widthMm: 136,
  heightMm: 37,
  steps: [
    { shape: { kind: 'channel', path: [[3, 33], [131, 33], [131, 15]], widthMm: 4 }, depthMm: 9 },
  ],
}

const feet = { heightMm: 6, sizeMm: 10, pattern: 'corners' }

const payload = (over: Record<string, unknown> = {}) => ({
  name: 'Tool tray',
  profile: { kind: 'preset', id: 'systainer-s76-notched' },
  heightMm: 21,
  layerHeightMm: 0.2,
  minFloorMm: 1.6,
  pockets: [hotend, allen],
  feet,
  undersideReliefs: 'avoid',
  ...over,
})

interface Design {
  id: string
  name: string
  notes?: string
  profile: { kind: string; id?: string }
  heightMm: number
  layerHeightMm: number
  minFloorMm: number
  pockets: Record<string, unknown>[]
  feet?: typeof feet
  undersideReliefs?: string
  caseClearHeightMm?: number
  revision: number
  createdAt: string
  updatedAt: string
}

interface Summary {
  id: string
  name: string
  profileKind: string
  pocketCount: number
  updatedAt: string
}

describe('tool tray routes', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startTestServer({
      label: 'tool-routes',
      verifier: stubVerifier({
        [OWNER_TOKEN]: validClaims(),
        [OTHER_TOKEN]: validClaims({ oid: OTHER_OID }),
      }),
    })
  })

  afterAll(async () => { await server.close() })

  const create = async (body: unknown, token = OWNER_TOKEN) =>
    server.fetchJson<{ id: string }>('/api/tool-trays', {
      method: 'POST', token, body: JSON.stringify(body),
    })

  const load = async (id: string, token = OWNER_TOKEN) =>
    server.fetchJson<Design>(`/api/tool-trays/${id}`, { token })

  test('create returns 201 and a string id', async () => {
    const created = await create(payload())
    assert.equal(created.status, 201)
    assert.match(created.body.id, /^\d+$/)
  })

  test('a tray round-trips every field, with the pockets as objects not a string', async () => {
    const created = await create(payload({
      name: 'Round trip',
      notes: 'a note',
      caseClearHeightMm: 48,
    }))
    const loaded = await load(created.body.id)

    assert.equal(loaded.status, 200)
    assert.equal(loaded.body.name, 'Round trip')
    assert.equal(loaded.body.notes, 'a note')
    assert.deepEqual(loaded.body.profile, { kind: 'preset', id: 'systainer-s76-notched' })
    assert.equal(loaded.body.heightMm, 21)
    assert.equal(loaded.body.layerHeightMm, 0.2)
    assert.equal(loaded.body.minFloorMm, 1.6)
    assert.deepEqual(loaded.body.feet, feet)
    assert.equal(loaded.body.undersideReliefs, 'avoid')
    assert.equal(loaded.body.caseClearHeightMm, 48)
    assert.equal(loaded.body.revision, 0)

    // The nested part: a tiered pocket with three steps, an offset pair, a
    // rotation, a mirror flag and a finger scoop, all intact.
    assert.ok(Array.isArray(loaded.body.pockets))
    assert.equal(loaded.body.pockets.length, 2)
    assert.deepEqual(loaded.body.pockets[0], hotend)
    assert.deepEqual(loaded.body.pockets[1], allen)
  })

  test('a through-cut survives the round trip as null, not as a missing field', async () => {
    const through = {
      ...allen, id: 'through-1', kind: 'bin',
      steps: [{ shape: { kind: 'rect', widthMm: 20, heightMm: 20 }, depthMm: null }],
    }
    const created = await create(payload({ pockets: [through] }))
    const loaded = await load(created.body.id)
    const steps = loaded.body.pockets[0]!.steps as { depthMm: number | null }[]
    assert.equal(steps[0]!.depthMm, null)
  })

  test('an absent optional comes back absent, not null', async () => {
    const created = await create(payload({ feet: undefined, undersideReliefs: undefined }))
    const loaded = await load(created.body.id)
    assert.equal(loaded.body.feet, undefined)
    assert.equal(loaded.body.undersideReliefs, undefined)
    assert.equal(loaded.body.caseClearHeightMm, undefined)
    assert.equal(loaded.body.notes, undefined)
  })

  test('update replaces the whole design, and clearing feet really clears them', async () => {
    const created = await create(payload())
    const put = await server.fetchJson<{ ok: boolean }>(
      `/api/tool-trays/${created.body.id}`, {
        method: 'PUT',
        token: OWNER_TOKEN,
        body: JSON.stringify(payload({ name: 'Renamed', feet: null })),
      })
    assert.equal(put.status, 200)
    const loaded = await load(created.body.id)
    assert.equal(loaded.body.name, 'Renamed')
    assert.equal(loaded.body.feet, undefined)
  })

  test('the list carries the pocket count without parsing the blob', async () => {
    const created = await create(payload({ name: 'Listed' }))
    const list = await server.fetchJson<Summary[]>('/api/tool-trays', { token: OWNER_TOKEN })
    assert.equal(list.status, 200)
    const row = list.body.find(r => r.id === created.body.id)
    assert.ok(row)
    assert.equal(row.name, 'Listed')
    assert.equal(row.profileKind, 'preset')
    assert.equal(row.pocketCount, 2)
    // Newest first.
    assert.equal(list.body[0]!.id, created.body.id)
  })

  test('the denormalised count follows an update, not just a create', async () => {
    // The count is a separate column, so an update that forgets it would leave
    // the list lying about a tray it can still open correctly.
    const created = await create(payload())
    await server.fetchJson(`/api/tool-trays/${created.body.id}`, {
      method: 'PUT', token: OWNER_TOKEN, body: JSON.stringify(payload({ pockets: [allen] })),
    })
    const list = await server.fetchJson<Summary[]>('/api/tool-trays', { token: OWNER_TOKEN })
    const row = list.body.find(r => r.id === created.body.id)
    assert.equal(row?.pocketCount, 1)
    assert.equal((await load(created.body.id)).body.pockets.length, 1)
  })

  test('a tray with no pockets at all is legal', async () => {
    const created = await create(payload({ pockets: [] }))
    assert.equal(created.status, 201)
    const loaded = await load(created.body.id)
    assert.deepEqual(loaded.body.pockets, [])
    const list = await server.fetchJson<Summary[]>('/api/tool-trays', { token: OWNER_TOKEN })
    assert.equal(list.body.find(r => r.id === created.body.id)?.pocketCount, 0)
  })

  test('a clone is an independent copy, pockets and all', async () => {
    const created = await create(payload({ name: 'Original' }))
    const cloned = await server.fetchJson<{ id: string }>(
      `/api/tool-trays/${created.body.id}/clone`, {
        method: 'POST', token: OWNER_TOKEN, body: JSON.stringify({ name: 'Copy' }),
      })
    assert.equal(cloned.status, 201)
    assert.notEqual(cloned.body.id, created.body.id)

    const copy = await load(cloned.body.id)
    assert.equal(copy.body.name, 'Copy')
    assert.deepEqual(copy.body.pockets, [hotend, allen])

    await server.fetchJson(`/api/tool-trays/${cloned.body.id}`, {
      method: 'PUT', token: OWNER_TOKEN, body: JSON.stringify(payload({ name: 'Edited copy' })),
    })
    const original = await load(created.body.id)
    assert.equal(original.body.name, 'Original')
  })

  test('a clone with no name gets one', async () => {
    const created = await create(payload({ name: 'Unnamed source' }))
    const cloned = await server.fetchJson<{ id: string }>(
      `/api/tool-trays/${created.body.id}/clone`, { method: 'POST', token: OWNER_TOKEN })
    const copy = await load(cloned.body.id)
    assert.equal(copy.body.name, 'Unnamed source copy')
  })

  test('another account cannot read, edit, clone or delete the tray', async () => {
    const created = await create(payload())
    const id = created.body.id

    assert.equal((await load(id, OTHER_TOKEN)).status, 404)
    assert.equal((await server.fetchJson(`/api/tool-trays/${id}`, {
      method: 'PUT', token: OTHER_TOKEN, body: JSON.stringify(payload()),
    })).status, 404)
    assert.equal((await server.fetchJson(`/api/tool-trays/${id}/clone`, {
      method: 'POST', token: OTHER_TOKEN,
    })).status, 404)
    assert.equal((await server.fetchJson(`/api/tool-trays/${id}`, {
      method: 'DELETE', token: OTHER_TOKEN,
    })).status, 404)

    assert.equal((await load(id)).status, 200)
  })

  test("another account's list does not include it", async () => {
    await create(payload({ name: 'Mine' }))
    const theirs = await server.fetchJson<Summary[]>('/api/tool-trays', { token: OTHER_TOKEN })
    assert.equal(theirs.body.some(r => r.name === 'Mine'), false)
  })

  test('delete removes it, and deleting it twice is a 404', async () => {
    const created = await create(payload())
    const first = await server.fetchJson<{ ok: boolean }>(
      `/api/tool-trays/${created.body.id}`, { method: 'DELETE', token: OWNER_TOKEN })
    assert.equal(first.status, 200)
    assert.equal((await load(created.body.id)).status, 404)
    assert.equal((await server.fetchJson(`/api/tool-trays/${created.body.id}`, {
      method: 'DELETE', token: OWNER_TOKEN,
    })).status, 404)
  })

  test('an unknown id is a typed 404, not a crash', async () => {
    const missing = await server.fetchJson<{ error: { code: string; message: string } }>(
      '/api/tool-trays/999999', { token: OWNER_TOKEN })
    assert.equal(missing.status, 404)
    assert.equal(missing.body.error.code, 'not_found')
  })

  test('a profile with no kind is a 400 from the repository guard, not a 500', async () => {
    const bad = await create(payload({ profile: { id: 'systainer-s76-plain' } }))
    assert.equal(bad.status, 400)
  })

  test('the routes require authentication', async () => {
    assert.equal((await server.fetchJson('/api/tool-trays')).status, 401)
  })

  test('a write is audited against the owner, under its own category', async () => {
    const created = await create(payload({ name: 'Audited' }))
    await new Promise(resolve => setImmediate(resolve))
    const events = await server.repos.audit.list()
    const event = events.find(
      e => e.category === 'tool-tray' && e.subject === created.body.id)
    assert.ok(event, 'no tool-tray audit event for the created design')
    assert.equal(event.action, 'design_created')
    assert.equal(event.actorTenantId, TEST_TENANT)
    assert.equal(event.actorOid, TEST_OID)
  })
})
