// Gridfinity designer routes: designs round-trip, ownership isolation, label
// lists, and the Kreg starter list being given exactly once per account.
import assert from 'node:assert/strict'
import { afterAll, beforeAll, describe, test } from 'vitest'
import { OTHER_OID, startTestServer, stubVerifier, validClaims } from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'
import { DEFAULT_BASEPLATE, DEFAULT_BIN } from '../../lib/contracts/gridfinity.ts'

const OWNER = 'owner-token'
const OTHER = 'other-token'
const FRESH = 'fresh-token'

interface Record_ { id: string; name: string; notes?: string; kind: string; params: Record<string, unknown> }
interface List { id: string; name: string; items: string[] }

describe('gridfinity routes', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startTestServer({
      label: 'gridfinity-routes',
      verifier: stubVerifier({
        [OWNER]: validClaims(),
        [OTHER]: validClaims({ oid: OTHER_OID }),
        [FRESH]: validClaims({ oid: '99998888-7777-6666-5555-444433332222' }),
      }),
    })
  })
  afterAll(async () => { await server.close() })

  const send = <T>(path: string, method: string, body: unknown, token = OWNER) =>
    server.fetchJson<T>(`/api/gridfinity${path}`, { method, token, body: JSON.stringify(body) })
  const get = <T>(path: string, token = OWNER) => server.fetchJson<T>(`/api/gridfinity${path}`, { token })

  test('a bin round-trips its parameters and label', async () => {
    const params = { ...DEFAULT_BIN, gridX: 3, gridY: 2, labelText: '#8 x 1-1/4" Coarse' }
    const created = await send<{ id: string }>('/designs', 'POST', { name: 'Screws', notes: null, kind: 'bin', params })
    assert.equal(created.status, 201)
    const loaded = await get<Record_>(`/designs/${created.body.id}`)
    assert.equal(loaded.status, 200)
    assert.equal(loaded.body.kind, 'bin')
    assert.deepEqual(loaded.body.params, params)
    const list = await get<Record_[]>('/designs')
    assert.ok(list.body.some(d => d.id === created.body.id && d.kind === 'bin'))
  })

  test('a baseplate updates, clones and deletes', async () => {
    const created = await send<{ id: string }>('/designs', 'POST',
      { name: 'Drawer', kind: 'baseplate', params: DEFAULT_BASEPLATE })
    const id = created.body.id
    const put = await send('/designs/' + id, 'PUT',
      { name: 'Top drawer', kind: 'baseplate', params: { ...DEFAULT_BASEPLATE, drawerWidthMm: 500 } })
    assert.equal(put.status, 200)
    const clone = await send<{ id: string }>(`/designs/${id}/clone`, 'POST', {})
    assert.equal(clone.status, 201)
    const copy = await get<Record_>(`/designs/${clone.body.id}`)
    assert.equal(copy.body.params.drawerWidthMm, 500)
    assert.equal((await send(`/designs/${id}`, 'DELETE', {})).status, 200)
    assert.equal((await get(`/designs/${id}`)).status, 404)
    assert.equal((await get(`/designs/${clone.body.id}`)).status, 200)
  })

  test('another account cannot see or change a design', async () => {
    const { body } = await send<{ id: string }>('/designs', 'POST', { name: 'Mine', kind: 'bin', params: DEFAULT_BIN })
    assert.equal((await get(`/designs/${body.id}`, OTHER)).status, 404)
    assert.equal((await send(`/designs/${body.id}`, 'PUT', { name: 'x', kind: 'bin', params: DEFAULT_BIN }, OTHER)).status, 404)
    assert.equal((await send(`/designs/${body.id}`, 'DELETE', {}, OTHER)).status, 404)
    const theirs = await get<Record_[]>('/designs', OTHER)
    assert.ok(!theirs.body.some(d => d.id === body.id))
  })

  test('bad parameters are refused', async () => {
    const bad = [
      { name: 'x', kind: 'drawer', params: DEFAULT_BIN },
      { name: 'x', kind: 'bin', params: { ...DEFAULT_BIN, gridX: 0 } },
      { name: 'x', kind: 'bin', params: { ...DEFAULT_BIN, heightUnits: 99 } },
      { name: 'x', kind: 'bin', params: { ...DEFAULT_BIN, labelText: 'x'.repeat(61) } },
      { name: 'x', kind: 'baseplate', params: { ...DEFAULT_BASEPLATE, bedMm: 5 } },
    ]
    for (const body of bad) assert.equal((await send('/designs', 'POST', body)).status, 400, JSON.stringify(body))
  })

  test('a new account gets the Kreg list once, and deleting it sticks', async () => {
    const first = await get<List[]>('/label-lists', FRESH)
    assert.equal(first.status, 200)
    const kreg = first.body.filter(l => l.name === 'Kreg pocket screws')
    assert.equal(kreg.length, 1)
    assert.ok(kreg[0].items.length > 10)
    assert.equal((await get<List[]>('/label-lists', FRESH)).body.length, first.body.length)
    assert.equal((await send(`/label-lists/${kreg[0].id}`, 'DELETE', {}, FRESH)).status, 200)
    const after = await get<List[]>('/label-lists', FRESH)
    assert.ok(!after.body.some(l => l.name === 'Kreg pocket screws'))
  })

  test('uploaded lists save, edit, and stay private', async () => {
    const created = await send<{ id: string }>('/label-lists', 'POST', { name: 'Drill bits', items: ['1/8"', '3/16"'] })
    assert.equal(created.status, 201)
    const id = created.body.id
    assert.equal((await send(`/label-lists/${id}`, 'PUT', { name: 'Bits', items: ['1/8"', '1/4"', '3/8"'] })).status, 200)
    const loaded = await get<List>(`/label-lists/${id}`)
    assert.deepEqual(loaded.body, { ...loaded.body, name: 'Bits', items: ['1/8"', '1/4"', '3/8"'] })
    assert.equal((await get(`/label-lists/${id}`, OTHER)).status, 404)
    assert.equal((await send('/label-lists', 'POST', { name: 'Empty', items: [] })).status, 400)
    assert.equal((await send('/label-lists', 'POST', { name: '', items: ['a'] })).status, 400)
  })
})
