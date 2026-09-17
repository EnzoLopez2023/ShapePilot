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
  owned: { key: string; variant: string; quantity: number }[]
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
        { key: JADE_WHITE, variant: 'spool', quantity: 1 },
        { key: JADE_WHITE, variant: 'refill', quantity: 1 },
        { key: ABS_RED, variant: 'spool', quantity: 1 },
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
        { key: BLACK, variant: 'spool', quantity: 1 },
        { key: JADE_WHITE, variant: 'spool', quantity: 1 },
      ],
    })
    const reversed = await put({
      owned: [
        { key: JADE_WHITE, variant: 'spool', quantity: 1 },
        { key: BLACK, variant: 'spool', quantity: 1 },
      ],
    })
    assert.deepEqual(reversed.body.owned, forward.body.owned)
  })

  test('replaces wholesale rather than merging', async () => {
    await put({ owned: [{ key: JADE_WHITE, variant: 'spool', quantity: 1 }, { key: BLACK, variant: 'spool', quantity: 1 }] })
    const narrowed = await put({ owned: [{ key: BLACK, variant: 'spool', quantity: 1 }] })
    assert.deepEqual(narrowed.body.owned, [{ key: BLACK, variant: 'spool', quantity: 1 }])

    const emptied = await put({ owned: [] })
    assert.deepEqual(emptied.body.owned, [])
    assert.deepEqual((await get()).body.owned, [])
  })

  test('is idempotent: the same body twice leaves the same inventory', async () => {
    const body = { owned: [{ key: JADE_WHITE, variant: 'spool', quantity: 1 }, { key: ABS_RED, variant: 'spool', quantity: 1 }] }
    const first = await put(body)
    const second = await put(body)
    assert.deepEqual(second.body.owned, first.body.owned)
  })

  test('scopes the inventory to its owner', async () => {
    await put({ owned: [{ key: JADE_WHITE, variant: 'spool', quantity: 1 }] })
    assert.deepEqual((await get(OTHER_TOKEN)).body.owned, [])

    // The other account writing its own inventory must not disturb this one.
    await put({ owned: [{ key: ABS_RED, variant: 'spool', quantity: 1 }] }, OTHER_TOKEN)
    assert.deepEqual((await get()).body.owned, [{ key: JADE_WHITE, variant: 'spool', quantity: 1 }])
    assert.deepEqual((await get(OTHER_TOKEN)).body.owned, [{ key: ABS_RED, variant: 'spool', quantity: 1 }])
  })

  test('stores a count per filament and form, and a new count replaces the old', async () => {
    const saved = await put({
      owned: [
        { key: JADE_WHITE, variant: 'spool', quantity: 3 },
        { key: JADE_WHITE, variant: 'refill', quantity: 2 },
        { key: BLACK, variant: 'spool', quantity: 1 },
      ],
    })
    assert.equal(saved.status, 200)
    const count = (owned: Inventory['owned'], key: string, variant: string) =>
      owned.find(entry => entry.key === key && entry.variant === variant)?.quantity
    assert.equal(count((await get()).body.owned, JADE_WHITE, 'spool'), 3)
    assert.equal(count((await get()).body.owned, JADE_WHITE, 'refill'), 2)

    await put({ owned: [{ key: JADE_WHITE, variant: 'spool', quantity: 1 }] })
    assert.deepEqual((await get()).body.owned, [{ key: JADE_WHITE, variant: 'spool', quantity: 1 }])
    await put({ owned: [] })
  })

  test('refuses an inventory without counts rather than resetting them', async () => {
    await put({ owned: [{ key: BLACK, variant: 'spool', quantity: 4 }] })
    const stale = await put<ErrorBody>({ owned: [{ key: BLACK, variant: 'spool' }] })
    assert.equal(stale.status, 400)
    assert.equal(stale.body.error?.details?.field, 'owned[0].quantity')
    // The stored count survives the refused write.
    assert.deepEqual((await get()).body.owned, [{ key: BLACK, variant: 'spool', quantity: 4 }])
    await put({ owned: [] })
  })

  test('refuses a filament that is not in the catalogue', async () => {
    const response = await put<ErrorBody>({
      owned: [{ key: 'bambu-lab/pla/basic/invented-99999', variant: 'spool', quantity: 1 }],
    })
    assert.equal(response.status, 400)
    assert.equal(response.body.error?.details?.field, 'owned[0].key')
  })

  // ABS is sold on a reel only. A refill of it describes a product that does
  // not exist, and the catalogue is what lets the server know that.
  test('refuses a variant the line is not sold in', async () => {
    const response = await put<ErrorBody>({ owned: [{ key: ABS_RED, variant: 'refill', quantity: 1 }] })
    assert.equal(response.status, 400)
    assert.equal(response.body.error?.details?.field, 'owned[0].variant')
  })

  test('refuses a repeated tick rather than quietly deduping it', async () => {
    const response = await put<ErrorBody>({
      owned: [
        { key: JADE_WHITE, variant: 'spool', quantity: 1 },
        { key: JADE_WHITE, variant: 'spool', quantity: 1 },
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
      [{ owned: [{ variant: 'spool', quantity: 1 }] }, 'owned[0].key'],
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
      owned: Array.from({ length: 500 }, () => ({ key: JADE_WHITE, variant: 'spool', quantity: 1 })),
    })
    assert.equal(response.status, 400)
    assert.equal(response.body.error?.details?.field, 'owned')
  })

  test('accepts the entire catalogue at once', async () => {
    // The realistic upper bound: every spool the catalogue lists. Proves the
    // limit is not set below what the page's own "own everything" can produce.
    const owned = FILAMENT_CATALOG.map(color => ({ key: color.key, variant: 'spool' as const, quantity: 1 }))
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

// What a kilogram of a line costs. Priced per line because Bambu prices a line,
// and replaced wholesale like the inventory it sits beside.
describe('filament price routes', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startTestServer({
      label: 'filament-prices',
      verifier: stubVerifier({
        [OWNER_TOKEN]: validClaims(),
        [OTHER_TOKEN]: validClaims({ oid: OTHER_OID }),
      }),
    })
  })

  afterAll(async () => { await server.close() })

  interface Prices {
    prices: { line: string; pricePerKg: number; currency: string }[]
  }

  const PRICES = `${BASE}/prices`
  const get = (token = OWNER_TOKEN) => server.fetchJson<Prices>(PRICES, { token })
  const put = <T = Prices>(body: unknown, token = OWNER_TOKEN) =>
    server.fetchJson<T>(PRICES, { method: 'PUT', token, body: JSON.stringify(body) })

  test('starts unpriced and round-trips a price list', async () => {
    assert.deepEqual((await get()).body.prices, [])

    const written = await put({
      prices: [
        { line: 'bambu-lab/petg/hf', pricePerKg: 27.5, currency: 'eur' },
        { line: 'bambu-lab/pla/basic', pricePerKg: 19.99, currency: 'EUR' },
      ],
    })
    assert.equal(written.status, 200)
    // Sorted by line and the currency upper-cased, so two identical price lists
    // always read back identically.
    assert.deepEqual(written.body.prices, [
      { line: 'bambu-lab/petg/hf', pricePerKg: 27.5, currency: 'EUR' },
      { line: 'bambu-lab/pla/basic', pricePerKg: 19.99, currency: 'EUR' },
    ])
    assert.deepEqual((await get()).body.prices, written.body.prices)
  })

  test('replaces wholesale, so an empty list unprices everything', async () => {
    await put({ prices: [{ line: 'bambu-lab/pla/basic', pricePerKg: 20, currency: 'EUR' }] })
    await put({ prices: [] })
    assert.deepEqual((await get()).body.prices, [])
  })

  test('scopes prices to their owner', async () => {
    await put({ prices: [{ line: 'bambu-lab/pla/basic', pricePerKg: 20, currency: 'EUR' }] })
    assert.deepEqual((await get(OTHER_TOKEN)).body.prices, [])
  })

  test('refuses what cannot be a price, naming the field', async () => {
    const cases: [unknown, string][] = [
      [{ prices: [{ line: 'not/a/line', pricePerKg: 20, currency: 'EUR' }] }, 'prices[0].line'],
      [{ prices: [{ line: 'bambu-lab/pla/basic', pricePerKg: 0, currency: 'EUR' }] }, 'prices[0].pricePerKg'],
      [{ prices: [{ line: 'bambu-lab/pla/basic', pricePerKg: -5, currency: 'EUR' }] }, 'prices[0].pricePerKg'],
      [{ prices: [{ line: 'bambu-lab/pla/basic', pricePerKg: 20, currency: 'euros' }] }, 'prices[0].currency'],
      [{ prices: [{ line: 'bambu-lab/pla/basic', pricePerKg: 20 }] }, 'prices[0].currency'],
      [{ prices: [{ line: 'bambu-lab/pla/basic', pricePerKg: 20, currency: 'EUR', extra: 1 }] }, 'prices[0].extra'],
      [{ prices: 'lots' }, 'prices'],
      [{ owned: [] }, 'owned'],
    ]
    for (const [body, field] of cases) {
      const response = await put<ErrorBody>(body)
      assert.equal(response.status, 400, JSON.stringify(body))
      assert.equal(response.body.error?.details?.field, field)
    }
  })

  test('refuses the same line priced twice rather than picking one', async () => {
    const response = await put<ErrorBody>({
      prices: [
        { line: 'bambu-lab/pla/basic', pricePerKg: 20, currency: 'EUR' },
        { line: 'bambu-lab/pla/basic', pricePerKg: 25, currency: 'EUR' },
      ],
    })
    assert.equal(response.status, 400)
    assert.equal(response.body.error?.details?.field, 'prices[1].line')
  })

  test('rounds to the cent, because a price is money', async () => {
    const written = await put({
      prices: [{ line: 'bambu-lab/pla/basic', pricePerKg: 19.999, currency: 'EUR' }],
    })
    assert.equal(written.body.prices[0].pricePerKg, 20)
  })

  test('requires authentication', async () => {
    assert.equal((await server.fetchJson(PRICES)).status, 401)
  })
})
