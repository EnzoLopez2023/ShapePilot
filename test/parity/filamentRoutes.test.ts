// Filament routes: orders, and the owned list derived from them.
//
// The properties worth pinning are the ones everything downstream leans on:
// orders are owner-scoped like everything else, the same invoice cannot be
// logged twice, every filament line is checked against the committed catalogue
// -- so a colour that does not exist, or a form it is not sold in, can never
// reach storage -- and the owned list the colour pickers and reorder check read
// is exactly what the orders add up to.
import assert from 'node:assert/strict'
import { afterAll, beforeAll, describe, test } from 'vitest'
import {
  OTHER_OID, startTestServer, stubVerifier, validClaims,
} from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FILAMENT_CATALOG, filamentsOfLine } from '../../lib/contracts/bambuFilaments.ts'
import { createFilesystemAssetStore } from '../../lib/assets/assetStore.ts'

const OWNER_TOKEN = 'owner-token'
const OTHER_TOKEN = 'other-token'
const BASE = '/api/filaments'

interface Inventory {
  owned: { key: string; variant: string; quantity: number }[]
}

interface OrderBook {
  orders: { id: string; orderNumber: string | null; lines: { key: string | null }[] }[]
  adjustments: { key: string; finished: number }[]
}

const line = (key: string | null, variant: 'spool' | 'refill' | null, quantity = 1, unitPrice: number | null = 20) => ({
  key, description: key ?? 'Glue stick', sku: null, variant, gramsPerUnit: key ? 1000 : 0,
  quantity, unitPrice, discount: 0, tax: 0,
})

const invoice = (orderNumber: string, lines: unknown[], extra: Record<string, unknown> = {}) => ({
  source: 'bambu-us-invoice', orderNumber, orderedAt: '2026-09-04', currency: 'USD',
  orderDiscount: 0, credit: 0, shipping: 0, grandTotal: null, note: null, lines, ...extra,
})

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

describe('filament order routes', () => {
  let server: TestServer
  let root: string

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'shapepilot-invoices-'))
    server = await startTestServer({
      label: 'filaments',
      verifier: stubVerifier({
        [OWNER_TOKEN]: validClaims(),
        [OTHER_TOKEN]: validClaims({ oid: OTHER_OID }),
      }),
      assetStore: createFilesystemAssetStore(root),
    })
  })

  afterAll(async () => {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  })

  const owned = async (token = OWNER_TOKEN) =>
    (await server.fetchJson<Inventory>(BASE, { token })).body.owned
  const book = async (token = OWNER_TOKEN) =>
    (await server.fetchJson<OrderBook>(`${BASE}/orders`, { token })).body
  const post = <T = { order: { id: string } }>(body: unknown, token = OWNER_TOKEN) =>
    server.fetchJson<T>(`${BASE}/orders`, { method: 'POST', token, body: JSON.stringify(body) })
  const remove = (id: string, token = OWNER_TOKEN) =>
    server.fetchJson<ErrorBody>(`${BASE}/orders/${id}`, { method: 'DELETE', token })
  const clear = async (token = OWNER_TOKEN) => {
    for (const order of (await book(token)).orders) await remove(order.id, token)
  }

  test('starts empty, and the owned list is what the orders add up to', async () => {
    assert.deepEqual(await owned(), [])
    assert.deepEqual(await book(), { orders: [], adjustments: [] })

    const created = await post(invoice('us-1', [
      line(JADE_WHITE, 'spool', 2),
      line(JADE_WHITE, 'refill', 1),
      line(null, null),
      line(ABS_RED, 'spool'),
    ]))
    assert.equal(created.status, 201)

    assert.deepEqual(await owned(), [
      { key: ABS_RED, variant: 'spool', quantity: 1 },
      { key: JADE_WHITE, variant: 'refill', quantity: 1 },
      { key: JADE_WHITE, variant: 'spool', quantity: 2 },
    ])
    // Every line is kept, filament or not: a glue stick takes its share of the
    // order's credit and shipping.
    assert.equal((await book()).orders[0].lines.length, 4)
    await clear()
  })

  test('refuses the same invoice twice rather than doubling the shelf', async () => {
    assert.equal((await post(invoice('us-2', [line(BLACK, 'spool')]))).status, 201)
    const again = await post<ErrorBody>(invoice('us-2', [line(BLACK, 'spool')]))
    assert.equal(again.status, 409)
    assert.equal(again.body.error?.code, 'duplicate_order')
    assert.deepEqual(await owned(), [{ key: BLACK, variant: 'spool', quantity: 1 }])
    await clear()
  })

  test('takes any number of manual entries, which have no order number', async () => {
    const manual = { ...invoice('', [line(BLACK, 'spool', 1, null)]), source: 'manual', orderNumber: null, note: 'Best Buy' }
    assert.equal((await post(manual)).status, 201)
    assert.equal((await post(manual)).status, 201)
    assert.deepEqual(await owned(), [{ key: BLACK, variant: 'spool', quantity: 2 }])
    await clear()
  })

  test('deleting an order takes its rolls off the shelf', async () => {
    const created = await post(invoice('us-3', [line(BLACK, 'spool')]))
    assert.equal((await remove(created.body.order.id)).status, 204)
    assert.deepEqual(await owned(), [])
    assert.equal((await remove(created.body.order.id)).status, 404)
  })

  test('scopes orders to their owner', async () => {
    const created = await post(invoice('us-4', [line(JADE_WHITE, 'spool')]))
    assert.deepEqual(await owned(OTHER_TOKEN), [])
    assert.deepEqual((await book(OTHER_TOKEN)).orders, [])
    // Another account cannot delete it, and may log the same order number.
    assert.equal((await remove(created.body.order.id, OTHER_TOKEN)).status, 404)
    assert.equal((await post(invoice('us-4', [line(BLACK, 'spool')]), OTHER_TOKEN)).status, 201)
    assert.deepEqual(await owned(), [{ key: JADE_WHITE, variant: 'spool', quantity: 1 }])
    await clear()
    await clear(OTHER_TOKEN)
  })

  test('a roll marked used up comes off the shelf, and the mark can be cleared', async () => {
    await post(invoice('us-5', [line(BLACK, 'spool', 2)]))
    const marked = await server.fetchJson<OrderBook>(`${BASE}/adjustments`, {
      method: 'PUT', token: OWNER_TOKEN, body: JSON.stringify({ key: BLACK, finished: 1 }),
    })
    assert.deepEqual(marked.body.adjustments, [{ key: BLACK, finished: 1 }])
    assert.deepEqual(await owned(), [{ key: BLACK, variant: 'spool', quantity: 1 }])

    await server.fetchJson(`${BASE}/adjustments`, {
      method: 'PUT', token: OWNER_TOKEN, body: JSON.stringify({ key: BLACK, finished: 0 }),
    })
    assert.deepEqual((await book()).adjustments, [])
    assert.deepEqual(await owned(), [{ key: BLACK, variant: 'spool', quantity: 2 }])
    await clear()
  })

  // ABS is sold on a reel only. A refill of it describes a product that does
  // not exist, and the catalogue is what lets the server know that.
  test('checks every filament line against the catalogue', async () => {
    for (const [body, field] of [
      [invoice('x', [line('bambu-lab/pla/basic/invented-99999', 'spool')]), 'lines[0].key'],
      [invoice('x', [line(ABS_RED, 'refill')]), 'lines[0].variant'],
      [invoice('x', [line(JADE_WHITE, null)]), 'lines[0].variant'],
      [invoice('x', [line(null, 'spool')]), 'lines[0].variant'],
      [invoice('x', [line(null, null)]), 'lines'],
      [invoice('x', [{ ...line(JADE_WHITE, 'spool'), quantity: 0 }]), 'lines[0].quantity'],
      [invoice('x', [{ ...line(JADE_WHITE, 'spool'), unitPrice: -1 }]), 'lines[0].unitPrice'],
      [invoice('x', [{ ...line(JADE_WHITE, 'spool'), grams: 812 }]), 'lines[0].grams'],
      [invoice('x', []), 'lines'],
      [invoice('', [line(JADE_WHITE, 'spool')]), 'orderNumber'],
      [invoice('x', [line(JADE_WHITE, 'spool')], { orderedAt: 'yesterday' }), 'orderedAt'],
      [invoice('x', [line(JADE_WHITE, 'spool')], { currency: 'dollars' }), 'currency'],
      [invoice('x', [line(JADE_WHITE, 'spool')], { source: 'amazon' }), 'source'],
      [invoice('x', [line(JADE_WHITE, 'spool')], { extra: 1 }), 'body.extra'],
    ] as const) {
      const response = await post<ErrorBody>(body)
      assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(body)}`)
      assert.equal(response.body.error?.details?.field, field)
    }
    assert.deepEqual(await owned(), [])
  })

  test('the ticks are gone: writing an owned list is refused', async () => {
    const response = await server.fetchJson<ErrorBody>(BASE, {
      method: 'PUT', token: OWNER_TOKEN, body: JSON.stringify({ owned: [] }),
    })
    assert.equal(response.status, 410)
  })

  test('accepts an order of every colour in the catalogue', async () => {
    const lines = FILAMENT_CATALOG.slice(0, 200).map(color => line(color.key, 'spool'))
    assert.equal((await post(invoice('us-big', lines))).status, 201)
    assert.equal((await owned()).length, lines.length)
    await clear()
  })

  const PDF = Buffer.from('%PDF-1.7\n% an invoice\n%%EOF\n')
  const keep = (id: string, body: Buffer, token = OWNER_TOKEN, filename = 'us-9.pdf') =>
    fetch(`${server.baseUrl}${BASE}/orders/${id}/invoice?filename=${encodeURIComponent(filename)}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      body: new Uint8Array(body),
    })
  const open = (id: string, token = OWNER_TOKEN) =>
    fetch(`${server.baseUrl}${BASE}/orders/${id}/invoice`, { headers: { authorization: `Bearer ${token}` } })

  test('keeps the original invoice with its order, and gives it back unchanged', async () => {
    const created = await post(invoice('us-9', [line(BLACK, 'spool')]))
    const id = created.body.order.id
    assert.equal((await open(id)).status, 404)

    const kept = await keep(id, PDF)
    assert.equal(kept.status, 200)
    assert.deepEqual((await book()).orders[0], {
      ...(await book()).orders[0],
      invoice: { filename: 'us-9.pdf', contentType: 'application/pdf', byteLength: PDF.byteLength },
    })

    const back = await open(id)
    assert.equal(back.status, 200)
    assert.equal(back.headers.get('content-type'), 'application/pdf')
    assert.equal(back.headers.get('cache-control'), 'private, no-store')
    assert.ok(Buffer.from(await back.arrayBuffer()).equals(PDF))
    await clear()
  })

  test('a paper receipt can be kept as a photo; anything else is refused', async () => {
    const created = await post(invoice('us-10', [line(BLACK, 'spool')]))
    const id = created.body.order.id
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46])
    assert.equal((await keep(id, jpeg, OWNER_TOKEN, 'receipt.jpg')).status, 200)
    assert.equal((await open(id)).headers.get('content-type'), 'image/jpeg')
    assert.equal((await keep(id, Buffer.from('<html>not an invoice</html>'))).status, 400)
    await clear()
  })

  test("another account can neither keep nor read an order's invoice", async () => {
    const created = await post(invoice('us-11', [line(BLACK, 'spool')]))
    const id = created.body.order.id
    assert.equal((await keep(id, PDF, OTHER_TOKEN)).status, 404)
    assert.equal((await keep(id, PDF)).status, 200)
    assert.equal((await open(id, OTHER_TOKEN)).status, 404)
    assert.equal((await keep('no-such-order', PDF)).status, 404)
    await clear()
  })

  test('requires a token', async () => {
    assert.equal((await server.fetchJson<ErrorBody>(BASE)).status, 401)
    assert.equal((await server.fetchJson<ErrorBody>(`${BASE}/orders`)).status, 401)
    const write = await server.fetchJson<ErrorBody>(`${BASE}/orders`, {
      method: 'POST', body: JSON.stringify(invoice('x', [line(BLACK, 'spool')])),
    })
    assert.equal(write.status, 401)
  })
})
