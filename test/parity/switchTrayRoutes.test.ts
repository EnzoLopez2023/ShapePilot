// Switch tray route and repository behaviour.
//
// Asserted against the real Express app and a throwaway SQLite database: the
// complete round trip, the JSON blobs coming back as objects rather than
// strings, list order, clone isolation, ownership isolation, unknown ids and
// the typed error envelope. The shape mirrors keycapTrayRoutes.test.ts so the
// two designers cannot quietly diverge on ownership or status codes.
import assert from 'node:assert/strict'
import { afterAll, beforeAll, describe, test } from 'vitest'
import {
  OTHER_OID, TEST_OID, TEST_TENANT, startTestServer, stubVerifier, validClaims,
} from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'

const OWNER_TOKEN = 'owner-token'
const OTHER_TOKEN = 'other-token'

const mx = {
  id: 'mx',
  label: 'Cherry MX',
  bodyMm: 14,
  housingMm: 15.6,
  flangeToTopMm: 11.6,
  flangeToTipMm: 8.3,
  clipPlateMm: 1.5,
  standardPitchMm: 19.05,
  minPitchMm: 16,
  source: 'Cherry MX1A-xxNA/NB drawing',
}

const plate = {
  retention: 'shelf',
  shelfMm: 1.6,
  recessMm: 2,
  holeClearanceMm: 0.2,
  recessClearanceMm: 0.3,
  cornerRadiusMm: 0.5,
}

const fill = {
  pitchXMm: 17.1,
  pitchYMm: 17.1,
  marginMm: 3,
  stagger: 'none',
  origin: 'maximised',
  spreadEvenly: true,
}

const feet = { heightMm: 16.8, sizeMm: 12, pattern: 'corners', bottomTierHeightMm: 6.7 }

const payload = (over: Record<string, unknown> = {}) => ({
  name: 'Switch tray',
  profile: { kind: 'preset', id: 'systainer-s76-notched' },
  switch: mx,
  plate,
  fill,
  feet,
  ...over,
})

interface Design {
  id: string
  name: string
  notes?: string
  profile: { kind: string; id?: string }
  switch: typeof mx
  plate: typeof plate
  fill: typeof fill
  feet?: typeof feet
  nameplate?: { heightMm: number; fontSizeMm: number; x: number; y: number }
  skippedCells?: string[]
  caseClearHeightMm?: number
  revision: number
  createdAt: string
  updatedAt: string
}

interface Summary {
  id: string
  name: string
  profileKind: string
  switchLabel: string
  updatedAt: string
}

describe('switch tray routes', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startTestServer({
      label: 'switch-routes',
      verifier: stubVerifier({
        [OWNER_TOKEN]: validClaims(),
        [OTHER_TOKEN]: validClaims({ oid: OTHER_OID }),
      }),
    })
  })

  afterAll(async () => { await server.close() })

  const create = async (body: unknown, token = OWNER_TOKEN) =>
    server.fetchJson<{ id: string }>('/api/switch-trays', {
      method: 'POST', token, body: JSON.stringify(body),
    })

  const load = async (id: string, token = OWNER_TOKEN) =>
    server.fetchJson<Design>(`/api/switch-trays/${id}`, { token })

  test('create returns 201 and a string id', async () => {
    const created = await create(payload())
    assert.equal(created.status, 201)
    assert.match(created.body.id, /^\d+$/)
  })

  test('a tray round-trips every persisted field as an object, not a string', async () => {
    const created = await create(payload({
      name: 'Round trip',
      notes: 'a note',
      nameplate: { heightMm: 1.2, fontSizeMm: 8, x: 124, y: 150 },
      skippedCells: ['0,0', '3,4'],
      caseClearHeightMm: 61.5,
    }))
    const loaded = await load(created.body.id)

    assert.equal(loaded.status, 200)
    assert.equal(loaded.body.name, 'Round trip')
    assert.equal(loaded.body.notes, 'a note')
    assert.deepEqual(loaded.body.profile, { kind: 'preset', id: 'systainer-s76-notched' })
    assert.deepEqual(loaded.body.switch, mx)
    assert.deepEqual(loaded.body.plate, plate)
    assert.deepEqual(loaded.body.fill, fill)
    assert.deepEqual(loaded.body.feet, feet)
    assert.deepEqual(loaded.body.nameplate, { heightMm: 1.2, fontSizeMm: 8, x: 124, y: 150 })
    assert.deepEqual(loaded.body.skippedCells, ['0,0', '3,4'])
    assert.equal(loaded.body.caseClearHeightMm, 61.5)
    // `revision` is runtime-only and always leaves the server as 0.
    assert.equal(loaded.body.revision, 0)
  })

  test('an absent optional blob comes back absent, not null', async () => {
    const created = await create(payload({ feet: undefined }))
    const loaded = await load(created.body.id)
    assert.equal(loaded.body.feet, undefined)
    assert.equal(loaded.body.nameplate, undefined)
    assert.equal(loaded.body.skippedCells, undefined)
    assert.equal(loaded.body.caseClearHeightMm, undefined)
  })

  test('update replaces the whole design, and clearing feet really clears them', async () => {
    const created = await create(payload())
    const put = await server.fetchJson<{ ok: boolean }>(
      `/api/switch-trays/${created.body.id}`, {
        method: 'PUT',
        token: OWNER_TOKEN,
        body: JSON.stringify(payload({ name: 'Renamed', feet: null })),
      })
    assert.equal(put.status, 200)
    const loaded = await load(created.body.id)
    assert.equal(loaded.body.name, 'Renamed')
    assert.equal(loaded.body.feet, undefined)
  })

  test('the list carries the switch label without parsing the geometry', async () => {
    const created = await create(payload({ name: 'Listed' }))
    const list = await server.fetchJson<Summary[]>('/api/switch-trays', { token: OWNER_TOKEN })
    assert.equal(list.status, 200)
    const row = list.body.find(r => r.id === created.body.id)
    assert.ok(row)
    assert.equal(row.name, 'Listed')
    assert.equal(row.profileKind, 'preset')
    assert.equal(row.switchLabel, 'Cherry MX')
    // Newest first.
    assert.equal(list.body[0].id, created.body.id)
  })

  test('a clone is an independent copy', async () => {
    const created = await create(payload({ name: 'Original' }))
    const cloned = await server.fetchJson<{ id: string }>(
      `/api/switch-trays/${created.body.id}/clone`, {
        method: 'POST', token: OWNER_TOKEN, body: JSON.stringify({ name: 'Copy' }),
      })
    assert.equal(cloned.status, 201)
    assert.notEqual(cloned.body.id, created.body.id)

    const copy = await load(cloned.body.id)
    assert.equal(copy.body.name, 'Copy')
    assert.deepEqual(copy.body.plate, plate)

    // Editing the copy leaves the original alone.
    await server.fetchJson(`/api/switch-trays/${cloned.body.id}`, {
      method: 'PUT', token: OWNER_TOKEN, body: JSON.stringify(payload({ name: 'Edited copy' })),
    })
    const original = await load(created.body.id)
    assert.equal(original.body.name, 'Original')
  })

  test('a clone with no name gets one', async () => {
    const created = await create(payload({ name: 'Unnamed source' }))
    const cloned = await server.fetchJson<{ id: string }>(
      `/api/switch-trays/${created.body.id}/clone`, { method: 'POST', token: OWNER_TOKEN })
    const copy = await load(cloned.body.id)
    assert.equal(copy.body.name, 'Unnamed source copy')
  })

  test('another account cannot read, edit, clone or delete the tray', async () => {
    const created = await create(payload())
    const id = created.body.id

    assert.equal((await load(id, OTHER_TOKEN)).status, 404)
    assert.equal((await server.fetchJson(`/api/switch-trays/${id}`, {
      method: 'PUT', token: OTHER_TOKEN, body: JSON.stringify(payload()),
    })).status, 404)
    assert.equal((await server.fetchJson(`/api/switch-trays/${id}/clone`, {
      method: 'POST', token: OTHER_TOKEN,
    })).status, 404)
    assert.equal((await server.fetchJson(`/api/switch-trays/${id}`, {
      method: 'DELETE', token: OTHER_TOKEN,
    })).status, 404)

    // ...and it is still there afterwards.
    assert.equal((await load(id)).status, 200)
  })

  test('delete removes it, and deleting it twice is a 404', async () => {
    const created = await create(payload())
    const first = await server.fetchJson<{ ok: boolean }>(
      `/api/switch-trays/${created.body.id}`, { method: 'DELETE', token: OWNER_TOKEN })
    assert.equal(first.status, 200)
    assert.equal((await load(created.body.id)).status, 404)
    assert.equal((await server.fetchJson(`/api/switch-trays/${created.body.id}`, {
      method: 'DELETE', token: OWNER_TOKEN,
    })).status, 404)
  })

  test('an unknown id is a typed 404, not a crash', async () => {
    const missing = await server.fetchJson<{ error: { code: string; message: string } }>(
      '/api/switch-trays/999999', { token: OWNER_TOKEN })
    assert.equal(missing.status, 404)
    assert.equal(missing.body.error.code, 'not_found')
  })

  test('the routes require authentication', async () => {
    assert.equal((await server.fetchJson('/api/switch-trays')).status, 401)
  })

  test('a write is audited against the owner, under its own category', async () => {
    const created = await create(payload({ name: 'Audited' }))
    // Audit is fire-and-forget, so give the record a tick to land.
    await new Promise(resolve => setImmediate(resolve))
    const events = await server.repos.audit.list()
    const event = events.find(
      e => e.category === 'switch-tray' && e.subject === created.body.id)
    assert.ok(event, 'no switch-tray audit event for the created design')
    assert.equal(event.action, 'design_created')
    assert.equal(event.actorTenantId, TEST_TENANT)
    assert.equal(event.actorOid, TEST_OID)
  })
})
