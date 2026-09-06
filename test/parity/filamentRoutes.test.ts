// Filament inventory routes: which filaments an account owns.
//
// The properties worth pinning are the ones the page leans on: the inventory is
// owner-scoped like everything else, a PUT replaces it wholesale and atomically,
// re-sending the same body changes nothing, and every tick is checked against
// the committed catalogue -- so a filament that does not exist, or a form a
// filament is not sold in, can never reach storage.
import assert from 'node:assert/strict'
import { afterAll, beforeAll, describe, test } from 'vitest'
import {
  OTHER_OID, startTestServer, stubVerifier, validClaims,
} from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'
import { FILAMENT_CATALOG, filamentsOfLine } from '../../lib/contracts/bambuFilaments.ts'

const OWNER_TOKEN = 'owner-token'
const OTHER_TOKEN = 'other-token'
const BASE = '/api/filaments'

interface Inventory {
  owned: { key: string; variant: string }[]
}

interface ErrorBody {
  error?: { code?: string; details?: { field?: string } }
}

// Real catalogue entries, so the tests break if the catalogue's shape changes
// out from under the route rather than passing against invented keys.
const PLA_BASIC = filamentsOfLine('bambu-lab/pla/basic')
const ABS = filamentsOfLine('bambu-lab/abs/basic')
const JADE_WHITE = PLA_BASIC.find(c => c.name === 'Jade White')!.key
const BLACK = PLA_BASIC.find(c => c.name === 'Black')!.key
const ABS_RED = ABS.find(c => c.name === 'Red')!.key

describe('filament inventory routes', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startTestServer({
      label: 'filaments',
      verifier: stubVerifier({
        [OWNER_TOKEN]: validClaims(),
        [OTHER_TOKEN]: validClaims({ oid: OTHER_OID }),
      }),
    })
  })

  afterAll(async () => { await server.close() })

  const get = (token = OWNER_TOKEN) =>
    server.fetchJson<Inventory>(BASE, { token })

  const put = <T = Inventory>(body: unknown, token = OWNER_TOKEN) =>
    server.fetchJson<T>(BASE, { method: 'PUT', token, body: JSON.stringify(body) })

  test('starts empty and round-trips a tick set', async () => {
    const before = await get()
    assert.equal(before.status, 200)
    assert.deepEqual(before.body.owned, [])

    const saved = await put({
      owned: [
        { key: JADE_WHITE, variant: 'spool' },
        { key: JADE_WHITE, variant: 'refill' },
        { key: ABS_RED, variant: 'spool' },
      ],
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.owned.length, 3)

    const after = await get()
    assert.deepEqual(after.body.owned, saved.body.owned)
  })

  test('reads back in a stable order regardless of the order sent', async () => {
    const forward = await put({
      owned: [
        { key: BLACK, variant: 'spool' },
        { key: JADE_WHITE, variant: 'spool' },
      ],
    })
    const reversed = await put({
      owned: [
        { key: JADE_WHITE, variant: 'spool' },
        { key: BLACK, variant: 'spool' },
      ],
    })
    assert.deepEqual(reversed.body.owned, forward.body.owned)
  })

  test('replaces wholesale rather than merging', async () => {
    await put({ owned: [{ key: JADE_WHITE, variant: 'spool' }, { key: BLACK, variant: 'spool' }] })
    const narrowed = await put({ owned: [{ key: BLACK, variant: 'spool' }] })
    assert.deepEqual(narrowed.body.owned, [{ key: BLACK, variant: 'spool' }])

    const emptied = await put({ owned: [] })
    assert.deepEqual(emptied.body.owned, [])
    assert.deepEqual((await get()).body.owned, [])
  })

  test('is idempotent: the same body twice leaves the same inventory', async () => {
    const body = { owned: [{ key: JADE_WHITE, variant: 'spool' }, { key: ABS_RED, variant: 'spool' }] }
    const first = await put(body)
    const second = await put(body)
    assert.deepEqual(second.body.owned, first.body.owned)
  })

  test('scopes the inventory to its owner', async () => {
    await put({ owned: [{ key: JADE_WHITE, variant: 'spool' }] })
    assert.deepEqual((await get(OTHER_TOKEN)).body.owned, [])

    // The other account writing its own inventory must not disturb this one.
    await put({ owned: [{ key: ABS_RED, variant: 'spool' }] }, OTHER_TOKEN)
    assert.deepEqual((await get()).body.owned, [{ key: JADE_WHITE, variant: 'spool' }])
    assert.deepEqual((await get(OTHER_TOKEN)).body.owned, [{ key: ABS_RED, variant: 'spool' }])
  })

  test('refuses a filament that is not in the catalogue', async () => {
    const response = await put<ErrorBody>({
      owned: [{ key: 'bambu-lab/pla/basic/invented-99999', variant: 'spool' }],
    })
    assert.equal(response.status, 400)
    assert.equal(response.body.error?.details?.field, 'owned[0].key')
  })

  // ABS is sold on a reel only. A refill of it describes a product that does
  // not exist, and the catalogue is what lets the server know that.
  test('refuses a variant the line is not sold in', async () => {
    const response = await put<ErrorBody>({ owned: [{ key: ABS_RED, variant: 'refill' }] })
    assert.equal(response.status, 400)
    assert.equal(response.body.error?.details?.field, 'owned[0].variant')
  })

  test('refuses a repeated tick rather than quietly deduping it', async () => {
    const response = await put<ErrorBody>({
      owned: [
        { key: JADE_WHITE, variant: 'spool' },
        { key: JADE_WHITE, variant: 'spool' },
      ],
    })
    assert.equal(response.status, 400)
    assert.equal(response.body.error?.details?.field, 'owned[1]')
  })

  test('refuses malformed bodies and unknown fields', async () => {
    for (const [body, field] of [
      [{}, 'owned'],
      [{ owned: 'everything' }, 'owned'],
      [{ owned: [{ key: JADE_WHITE }] }, 'owned[0].variant'],
      [{ owned: [{ variant: 'spool' }] }, 'owned[0].key'],
      [{ owned: [{ key: JADE_WHITE, variant: 'spool', grams: 812 }] }, 'owned[0].grams'],
      [{ owned: [42] }, 'owned[0]'],
      [{ owned: [], note: 'hello' }, 'note'],
    ] as const) {
      const response = await put<ErrorBody>(body)
      assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(body)}`)
      assert.equal(response.body.error?.details?.field, field)
    }
  })

  test('refuses an over-long inventory', async () => {
    const response = await put<ErrorBody>({
      owned: Array.from({ length: 500 }, () => ({ key: JADE_WHITE, variant: 'spool' })),
    })
    assert.equal(response.status, 400)
    assert.equal(response.body.error?.details?.field, 'owned')
  })

  test('accepts the entire catalogue at once', async () => {
    // The realistic upper bound: every spool the catalogue lists. Proves the
    // limit is not set below what the page's own "own everything" can produce.
    const owned = FILAMENT_CATALOG.map(color => ({ key: color.key, variant: 'spool' as const }))
    const response = await put({ owned })
    assert.equal(response.status, 200)
    assert.equal(response.body.owned.length, FILAMENT_CATALOG.length)
    await put({ owned: [] })
  })

  test('requires a token', async () => {
    const anonymous = await server.fetchJson<ErrorBody>(BASE)
    assert.equal(anonymous.status, 401)
    const write = await server.fetchJson<ErrorBody>(BASE, {
      method: 'PUT', body: JSON.stringify({ owned: [] }),
    })
    assert.equal(write.status, 401)
  })
})
