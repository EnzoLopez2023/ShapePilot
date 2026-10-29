// Cabinet routes: save is an upsert by name, listing is per owner, delete by name.
import assert from 'node:assert/strict'
import { afterAll, beforeAll, describe, test } from 'vitest'
import { OTHER_OID, startTestServer, stubVerifier, validClaims } from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'

const OWNER = 'owner-token'
const OTHER = 'other-token'

interface Cabinet { name: string; params: Record<string, unknown> }

describe('cabinet routes', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startTestServer({
      label: 'cabinet-routes',
      verifier: stubVerifier({
        [OWNER]: validClaims(),
        [OTHER]: validClaims({ oid: OTHER_OID }),
      }),
    })
  })
  afterAll(async () => { await server.close() })

  const put = (body: unknown, token = OWNER) =>
    server.fetchJson<{ ok: true }>('/api/cabinets', { method: 'PUT', token, body: JSON.stringify(body) })
  const list = (token = OWNER) => server.fetchJson<Cabinet[]>('/api/cabinets', { token })

  test('saving under an existing name replaces it', async () => {
    assert.equal((await put({ name: 'Wall', params: { trayCount: 4 } })).status, 200)
    assert.equal((await put({ name: 'Wall', params: { trayCount: 6 } })).status, 200)
    const walls = (await list()).body.filter(c => c.name === 'Wall')
    assert.equal(walls.length, 1)
    assert.equal(walls[0].params.trayCount, 6)
  })

  test('another account does not see it and cannot delete it', async () => {
    await put({ name: 'Private', params: { trayCount: 2 } })
    assert.ok(!(await list(OTHER)).body.some(c => c.name === 'Private'))
    const res = await server.fetchJson('/api/cabinets?name=Private', { method: 'DELETE', token: OTHER })
    assert.equal(res.status, 404)
  })

  test('delete removes it, and bad bodies are refused', async () => {
    await put({ name: 'Gone', params: {} })
    const del = await server.fetchJson('/api/cabinets?name=Gone', { method: 'DELETE', token: OWNER })
    assert.equal(del.status, 200)
    assert.ok(!(await list()).body.some(c => c.name === 'Gone'))
    assert.equal((await put({ name: '  ', params: {} })).status, 400)
    assert.equal((await put({ name: 'x', params: { a: { nested: 1 } } })).status, 400)
  })
})
