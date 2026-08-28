// Keycap tray route and repository parity.
//
// These are the pinned routes/keycap-trays.js behaviours, asserted against the
// real Express app and a throwaway SQLite database: list order and counts, the
// complete round trip, validation, transactional pocket replacement, clone
// isolation, library route precedence, the duplicate 409, ownership isolation,
// cascade delete, typed errors, and unknown ids.
import assert from 'node:assert/strict'
import { afterAll, beforeAll, describe, test } from 'vitest'
import {
  OTHER_OID, TEST_OID, TEST_SCOPE, TEST_TENANT, startTestServer, stubVerifier, validClaims,
} from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'

const OWNER_TOKEN = 'owner-token'
const OTHER_TOKEN = 'other-token'

const sizing = { pitch: 19.05, widthOffset: -0.45, height: 18.6, cornerRadius: 2, cornerSegments: 16 }

const designPayload = (over: Record<string, unknown> = {}) => ({
  name: 'Test Tray',
  notes: undefined,
  profile: { kind: 'preset', id: 'systainer-s76-notched' },
  sizing,
  floorThicknessMm: 2.4,
  pocketDepthMm: 10,
  engraveDepthMm: 0.4,
  pockets: [
    { id: 'a', units: 1, x: 114, y: 14, isThrough: true, label: '1u' },
    { id: 'b', units: 4, x: 87, y: 124, label: '4u' },
  ],
  ...over,
})

interface Design {
  id: string
  name: string
  notes?: string
  profile: { kind: string; id?: string }
  sizing: typeof sizing
  floorThicknessMm: number
  pocketDepthMm: number
  engraveDepthMm: number
  revision: number
  createdAt: string
  updatedAt: string
  pockets: {
    id: string
    units: number
    heightUnits: number
    x: number
    y: number
    rotationDeg: number
    isThrough: boolean
    label?: string
    labelMode: string
    depthMm?: number
    widthMm?: number
    heightMm?: number
    cornerRadiusMm?: number
  }[]
}

describe('keycap tray routes', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startTestServer({
      label: 'routes',
      verifier: stubVerifier({
        [OWNER_TOKEN]: validClaims(),
        [OTHER_TOKEN]: validClaims({ oid: OTHER_OID }),
      }),
    })
  })

  afterAll(async () => { await server.close() })

  const create = async (payload: unknown, token = OWNER_TOKEN) =>
    server.fetchJson<{ id: string }>('/api/keycap-trays', {
      method: 'POST', token, body: JSON.stringify(payload),
    })

  test('create returns 201 and a string id', async () => {
    const created = await create(designPayload())
    assert.equal(created.status, 201)
    assert.match(created.body.id, /^\d+$/)
  })

  test('a design round-trips every persisted field', async () => {
    const created = await create(designPayload({ name: 'Round trip', notes: 'a note' }))
    const loaded = await server.fetchJson<Design>(
      `/api/keycap-trays/${created.body.id}`, { token: OWNER_TOKEN })

    assert.equal(loaded.status, 200)
    assert.equal(loaded.body.name, 'Round trip')
    assert.equal(loaded.body.notes, 'a note')
    assert.deepEqual(loaded.body.profile, { kind: 'preset', id: 'systainer-s76-notched' })
    assert.deepEqual(loaded.body.sizing, sizing)
    assert.equal(loaded.body.floorThicknessMm, 2.4)
    assert.equal(loaded.body.pocketDepthMm, 10)
    assert.equal(loaded.body.engraveDepthMm, 0.4)
    // `revision` is runtime-only and always leaves the server as 0.
    assert.equal(loaded.body.revision, 0)
    assert.equal(loaded.body.pockets.length, 2)

    const [first, second] = loaded.body.pockets
    assert.equal(first.units, 1)
    assert.equal(first.heightUnits, 1)
    assert.equal(first.x, 114)
    assert.equal(first.y, 14)
    assert.equal(first.rotationDeg, 0)
    assert.equal(first.isThrough, true)
    assert.equal(first.label, '1u')
    assert.equal(first.labelMode, 'guide')
    // Nullable columns come back as undefined, not null.
    assert.equal(first.depthMm, undefined)
    assert.equal(first.widthMm, undefined)
    assert.equal(second.units, 4)
    assert.equal(second.isThrough, false)
    // Server-assigned integer identity crosses the wire as a string.
    assert.match(first.id, /^\d+$/)
  })

  test('pockets come back in sort_order, matching the submitted order', async () => {
    const created = await create(designPayload({
      pockets: [
        { id: 'x', units: 6.25, x: 87.5, y: 38.5, label: 'first' },
        { id: 'y', units: 2, x: 8, y: 64, label: 'second' },
        { id: 'z', units: 1, x: 1, y: 1, label: 'third' },
      ],
    }))
    const loaded = await server.fetchJson<Design>(
      `/api/keycap-trays/${created.body.id}`, { token: OWNER_TOKEN })
    assert.deepEqual(loaded.body.pockets.map(p => p.label), ['first', 'second', 'third'])
  })

  test('list is ordered by updated_at DESC and carries the pocket count', async () => {
    const solo = await startTestServer({
      label: 'list', verifier: stubVerifier({ [OWNER_TOKEN]: validClaims() }),
    })
    try {
      await solo.fetchJson('/api/keycap-trays', {
        method: 'POST', token: OWNER_TOKEN,
        body: JSON.stringify(designPayload({ name: 'older', pockets: [] })),
      })
      // datetime('now') has one-second resolution, so the second row is written
      // with an explicit later timestamp through a normal update.
      const newer = await solo.fetchJson<{ id: string }>('/api/keycap-trays', {
        method: 'POST', token: OWNER_TOKEN,
        body: JSON.stringify(designPayload({ name: 'newer' })),
      })
      solo.database.handle.prepare(
        "UPDATE keycap_tray_designs SET updated_at = '2099-01-01 00:00:00' WHERE id = ?",
      ).run(newer.body.id)

      const list = await solo.fetchJson<{ name: string; pocketCount: number; profileKind: string }[]>(
        '/api/keycap-trays', { token: OWNER_TOKEN })
      assert.equal(list.status, 200)
      assert.equal(list.body.length, 2)
      assert.equal(list.body[0].name, 'newer')
      assert.equal(list.body[0].pocketCount, 2)
      assert.equal(list.body[0].profileKind, 'preset')
      assert.equal(list.body[1].pocketCount, 0)
    } finally {
      await solo.close()
    }
  })

  test('update atomically replaces the complete pocket set', async () => {
    const created = await create(designPayload())
    const updated = await server.fetchJson<{ ok: true }>(
      `/api/keycap-trays/${created.body.id}`, {
        method: 'PUT', token: OWNER_TOKEN,
        body: JSON.stringify(designPayload({
          name: 'Renamed',
          pockets: [{ id: 'only', units: 2, x: 5, y: 5, label: 'only' }],
        })),
      })
    assert.equal(updated.status, 200)

    const loaded = await server.fetchJson<Design>(
      `/api/keycap-trays/${created.body.id}`, { token: OWNER_TOKEN })
    assert.equal(loaded.body.name, 'Renamed')
    assert.equal(loaded.body.pockets.length, 1)
    assert.equal(loaded.body.pockets[0].label, 'only')
  })

  test('clone copies the design and its pockets, and the copy is independent', async () => {
    const created = await create(designPayload({ name: 'Source' }))
    const cloned = await server.fetchJson<{ id: string }>(
      `/api/keycap-trays/${created.body.id}/clone`, {
        method: 'POST', token: OWNER_TOKEN, body: JSON.stringify({}),
      })
    assert.equal(cloned.status, 201)
    assert.notEqual(cloned.body.id, created.body.id)

    const copy = await server.fetchJson<Design>(
      `/api/keycap-trays/${cloned.body.id}`, { token: OWNER_TOKEN })
    assert.equal(copy.body.name, 'Source (copy)')
    assert.equal(copy.body.pockets.length, 2)

    await server.fetchJson(`/api/keycap-trays/${cloned.body.id}`, {
      method: 'PUT', token: OWNER_TOKEN,
      body: JSON.stringify(designPayload({ name: 'Copy edited', pockets: [] })),
    })
    const original = await server.fetchJson<Design>(
      `/api/keycap-trays/${created.body.id}`, { token: OWNER_TOKEN })
    assert.equal(original.body.name, 'Source')
    assert.equal(original.body.pockets.length, 2)
  })

  test('clone accepts an explicit name', async () => {
    const created = await create(designPayload({ name: 'Source' }))
    const cloned = await server.fetchJson<{ id: string }>(
      `/api/keycap-trays/${created.body.id}/clone`, {
        method: 'POST', token: OWNER_TOKEN, body: JSON.stringify({ name: 'Chosen' }),
      })
    const copy = await server.fetchJson<Design>(
      `/api/keycap-trays/${cloned.body.id}`, { token: OWNER_TOKEN })
    assert.equal(copy.body.name, 'Chosen')
  })

  test('delete cascades to pockets', async () => {
    const created = await create(designPayload())
    const before = server.database.handle.prepare<[string], { count: number }>(
      'SELECT COUNT(*) AS count FROM keycap_tray_pockets WHERE design_id = ?',
    ).get(created.body.id)
    assert.equal(Number(before?.count), 2)

    const removed = await server.fetchJson<{ ok: true }>(
      `/api/keycap-trays/${created.body.id}`, { method: 'DELETE', token: OWNER_TOKEN })
    assert.equal(removed.status, 200)

    const after = server.database.handle.prepare<[string], { count: number }>(
      'SELECT COUNT(*) AS count FROM keycap_tray_pockets WHERE design_id = ?',
    ).get(created.body.id)
    assert.equal(Number(after?.count), 0)
  })

  test('a missing name is a typed 400', async () => {
    const response = await create({ profile: { kind: 'rect' } })
    assert.equal(response.status, 400)
    assert.deepEqual(
      (response.body as unknown as {
        error: { code: string; message: string; details?: unknown }
      }).error,
      { code: 'bad_request', message: 'name is required', details: { field: 'name' } })
  })

  test('a missing profile kind is a typed 400', async () => {
    const response = await create({ name: 'No profile', profile: {} })
    assert.equal(response.status, 400)
    const { error } = response.body as unknown as { error: { code: string; message: string } }
    assert.equal(error.code, 'bad_request')
    assert.equal(error.message, 'profile.kind is required')
  })

  test('unknown ids are typed 404s on every verb', async () => {
    for (const [method, body] of [
      ['GET', undefined],
      ['PUT', JSON.stringify(designPayload())],
      ['DELETE', undefined],
    ] as const) {
      const response = await server.fetchJson(`/api/keycap-trays/999999`, {
        method, token: OWNER_TOKEN, body,
      })
      assert.equal(response.status, 404, `${method} should 404`)
      assert.equal(
        (response.body as { error: { code: string } }).error.code, 'not_found')
    }
    const clone = await server.fetchJson('/api/keycap-trays/999999/clone', {
      method: 'POST', token: OWNER_TOKEN, body: JSON.stringify({}),
    })
    assert.equal(clone.status, 404)
  })

  test('another signed-in user cannot see, read, update or delete a design', async () => {
    const created = await create(designPayload({ name: 'Private' }))

    const list = await server.fetchJson<unknown[]>('/api/keycap-trays', { token: OTHER_TOKEN })
    assert.equal(list.body.length, 0)

    const read = await server.fetchJson(
      `/api/keycap-trays/${created.body.id}`, { token: OTHER_TOKEN })
    assert.equal(read.status, 404)

    const update = await server.fetchJson(`/api/keycap-trays/${created.body.id}`, {
      method: 'PUT', token: OTHER_TOKEN, body: JSON.stringify(designPayload()),
    })
    assert.equal(update.status, 404)

    const removed = await server.fetchJson(
      `/api/keycap-trays/${created.body.id}`, { method: 'DELETE', token: OTHER_TOKEN })
    assert.equal(removed.status, 404)

    // ...and the owner's row is untouched.
    const stillThere = await server.fetchJson(
      `/api/keycap-trays/${created.body.id}`, { token: OWNER_TOKEN })
    assert.equal(stillThere.status, 200)
  })
})

describe('pocket library routes', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startTestServer({
      label: 'library',
      verifier: stubVerifier({
        [OWNER_TOKEN]: validClaims(),
        [OTHER_TOKEN]: validClaims({ oid: OTHER_OID }),
      }),
    })
  })

  afterAll(async () => { await server.close() })

  test('/library/pockets is matched before /:id', async () => {
    // The pinned route order matters: '/library/pockets' must not be captured
    // by '/:id' with id = 'library'.
    const response = await server.fetchJson<unknown[]>(
      '/api/keycap-trays/library/pockets', { token: OWNER_TOKEN })
    assert.equal(response.status, 200)
    assert.ok(Array.isArray(response.body))
  })

  test('a library pocket round-trips and lists by name', async () => {
    await server.fetchJson('/api/keycap-trays/library/pockets', {
      method: 'POST', token: OWNER_TOKEN,
      body: JSON.stringify({ name: 'zeta', units: 1 }),
    })
    const created = await server.fetchJson<{ id: string }>(
      '/api/keycap-trays/library/pockets', {
        method: 'POST', token: OWNER_TOKEN,
        body: JSON.stringify({
          name: 'alpha', units: 0.5, widthMm: 14, heightMm: 14,
          cornerRadiusMm: 1.5, notes: 'small',
        }),
      })
    assert.equal(created.status, 201)

    const list = await server.fetchJson<{
      id: string; name: string; units: number; widthMm?: number; notes?: string
    }[]>('/api/keycap-trays/library/pockets', { token: OWNER_TOKEN })
    assert.deepEqual(list.body.map(p => p.name), ['alpha', 'zeta'])
    assert.equal(list.body[0].units, 0.5)
    assert.equal(list.body[0].widthMm, 14)
    assert.equal(list.body[0].notes, 'small')
    assert.equal(list.body[1].widthMm, undefined)
  })

  test('a duplicate name for the same owner is a 409', async () => {
    await server.fetchJson('/api/keycap-trays/library/pockets', {
      method: 'POST', token: OWNER_TOKEN, body: JSON.stringify({ name: 'dupe' }),
    })
    const again = await server.fetchJson('/api/keycap-trays/library/pockets', {
      method: 'POST', token: OWNER_TOKEN, body: JSON.stringify({ name: 'dupe' }),
    })
    assert.equal(again.status, 409)
    const { error } = again.body as { error: { code: string; message: string } }
    assert.equal(error.code, 'conflict')
    assert.equal(error.message, 'a pocket named "dupe" already exists')
  })

  test('the same name is allowed for a different owner', async () => {
    await server.fetchJson('/api/keycap-trays/library/pockets', {
      method: 'POST', token: OWNER_TOKEN, body: JSON.stringify({ name: 'shared name' }),
    })
    const other = await server.fetchJson('/api/keycap-trays/library/pockets', {
      method: 'POST', token: OTHER_TOKEN, body: JSON.stringify({ name: 'shared name' }),
    })
    assert.equal(other.status, 201)
  })

  test('a missing name is a 400 and an unknown id is a 404', async () => {
    const bad = await server.fetchJson('/api/keycap-trays/library/pockets', {
      method: 'POST', token: OWNER_TOKEN, body: JSON.stringify({}),
    })
    assert.equal(bad.status, 400)

    const missing = await server.fetchJson('/api/keycap-trays/library/pockets/999999', {
      method: 'DELETE', token: OWNER_TOKEN,
    })
    assert.equal(missing.status, 404)
  })

  test('one owner cannot delete another owner library pocket', async () => {
    const created = await server.fetchJson<{ id: string }>(
      '/api/keycap-trays/library/pockets', {
        method: 'POST', token: OWNER_TOKEN, body: JSON.stringify({ name: 'mine only' }),
      })
    const attempt = await server.fetchJson(
      `/api/keycap-trays/library/pockets/${created.body.id}`,
      { method: 'DELETE', token: OTHER_TOKEN })
    assert.equal(attempt.status, 404)

    const list = await server.fetchJson<{ name: string }[]>(
      '/api/keycap-trays/library/pockets', { token: OWNER_TOKEN })
    assert.ok(list.body.some(p => p.name === 'mine only'))
  })
})

describe('audit trail', () => {
  test('a destructive operation records a verified actor', async () => {
    const server = await startTestServer({
      label: 'audit',
      verifier: stubVerifier({ [OWNER_TOKEN]: validClaims() }),
    })
    try {
      const created = await server.fetchJson<{ id: string }>('/api/keycap-trays', {
        method: 'POST', token: OWNER_TOKEN, body: JSON.stringify(designPayload()),
      })
      await server.fetchJson(`/api/keycap-trays/${created.body.id}`, {
        method: 'DELETE', token: OWNER_TOKEN,
      })

      const events = await server.repos.audit.list({ category: 'keycap-tray' })
      const deletion = events.find(e => e.action === 'design_deleted')
      assert.ok(deletion, 'the deletion must be audited')
      assert.equal(deletion.actorTenantId, TEST_TENANT)
      assert.equal(deletion.actorOid, TEST_OID)
      assert.equal(deletion.subject, created.body.id)
      assert.equal(deletion.httpMethod, 'DELETE')
    } finally {
      await server.close()
    }
  })

  test('client-recorded events cannot spoof the actor', async () => {
    const server = await startTestServer({
      label: 'audit-actor',
      verifier: stubVerifier({ [OWNER_TOKEN]: validClaims() }),
    })
    try {
      await server.fetchJson('/api/audit/events', {
        method: 'POST', token: OWNER_TOKEN,
        body: JSON.stringify({
          category: 'client', action: 'spoof',
          owner: { tenantId: 'attacker', oid: 'attacker' },
          detail: { accessToken: 'super-secret', note: 'keep' },
        }),
      })
      const events = await server.repos.audit.list({ category: 'client' })
      const recorded = events.find(e => e.action === 'spoof')
      assert.ok(recorded)
      assert.equal(recorded.actorOid, TEST_OID)
      assert.ok(recorded.detail?.includes('[redacted]'), 'token-shaped keys must be redacted')
      assert.ok(!recorded.detail?.includes('super-secret'))
      assert.ok(recorded.detail?.includes('keep'))
    } finally {
      await server.close()
    }
  })
})

test('the required API scope is what the stub claims carry', () => {
  assert.equal(validClaims().scp, TEST_SCOPE)
})
