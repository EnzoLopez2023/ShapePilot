// Keycap project write validation.
//
// Every invalid body is a typed 400 naming the offending field, and none of
// them reaches SQLite. The bounds themselves are asserted here rather than in
// the route test, so a change to one is a change to a test that says why.
import assert from 'node:assert/strict'
import { afterAll, beforeAll, describe, test } from 'vitest'
import { startTestServer, stubVerifier, validClaims } from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'
import { LIMITS, validateSetItems } from '../../server/validation/keycapProject.ts'
import { POCKET_SHAPES } from '../../server/validation/keycapTray.ts'
import { SET_ITEM_SOURCES } from '../../lib/db/repositories/contracts.ts'

const TOKEN = 'owner-token'
const BASE = '/api/keycap-projects'

interface ErrorBody { error: { code: string; message: string; details?: { field?: string } } }

describe('keycap project write validation', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startTestServer({
      label: 'keycap-project-validation',
      verifier: stubVerifier({ [TOKEN]: validClaims() }),
    })
  })

  afterAll(async () => { await server.close() })

  const post = (body: unknown) =>
    server.fetchJson<ErrorBody>(BASE, {
      method: 'POST', token: TOKEN, body: JSON.stringify(body),
    })

  const count = (): number => (server.database.handle
    .prepare('SELECT COUNT(*) AS n FROM keycap_projects').get() as { n: number }).n

  test('every invalid project body is a typed 400 that changes nothing', async () => {
    const before = count()
    const cases: [unknown, string][] = [
      [{}, 'name'],
      [{ name: '   ' }, 'name'],
      [{ name: 'x'.repeat(LIMITS.nameMaxLength + 1) }, 'name'],
      [{ name: 'ok', rogue: 1 }, 'body.rogue'],
      [{ name: 'ok', items: 'no' }, 'items'],
      [{ name: 'ok', items: [{}] }, 'items[0].units'],
      [{ name: 'ok', items: [{ units: '1' }] }, 'items[0].units'],
      [{ name: 'ok', items: [{ units: Number.NaN }] }, 'items[0].units'],
      [{ name: 'ok', items: [{ units: 1.3 }] }, 'items[0].units'],
      [{ name: 'ok', items: [{ units: 0 }] }, 'items[0].units'],
      [{ name: 'ok', items: [{ units: LIMITS.maxUnits + 1 }] }, 'items[0].units'],
      [{ name: 'ok', items: [{ units: 1, heightUnits: 0 }] }, 'items[0].heightUnits'],
      [{ name: 'ok', items: [{ units: 1, count: 0 }] }, 'items[0].count'],
      [{ name: 'ok', items: [{ units: 1, count: 1.5 }] }, 'items[0].count'],
      [{ name: 'ok', items: [{ units: 1, count: LIMITS.maxCount + 1 }] }, 'items[0].count'],
      [{ name: 'ok', items: [{ units: 1, shape: 'hexagon' }] }, 'items[0].shape'],
      [{ name: 'ok', items: [{ units: 1, source: 'divine' }] }, 'items[0].source'],
      [{ name: 'ok', items: [{ units: 1, legend: 'x'.repeat(LIMITS.legendMaxLength + 1) }] },
        'items[0].legend'],
      [{ name: 'ok', items: [{ units: 1, extra: true }] }, 'items[0].extra'],
      [{ name: 'ok', items: Array.from({ length: LIMITS.maxItems + 1 }, () => ({ units: 1 })) },
        'items'],
    ]

    for (const [body, field] of cases) {
      const res = await post(body)
      assert.equal(res.status, 400, `expected 400 for ${field}: ${JSON.stringify(body)}`)
      assert.equal(res.body.error.code, 'bad_request')
      assert.equal(res.body.error.details?.field, field,
        `wrong field for ${JSON.stringify(body)}: ${res.body.error.message}`)
    }
    assert.equal(count(), before, 'no invalid body may reach storage')
  })

  test('every invalid photo body is a typed 400', async () => {
    const created = await server.fetchJson<{ id: string }>(BASE, {
      method: 'POST', token: TOKEN, body: JSON.stringify({ name: 'Photos' }),
    })
    const cases: [unknown, string][] = [
      [{}, 'hash'],
      [{ hash: 42 }, 'hash'],
      [{ hash: 'ABC' }, 'hash'],
      [{ hash: 'A'.repeat(64) }, 'hash'],
      [{ hash: 'a'.repeat(64), rogue: 1 }, 'body.rogue'],
      [{ hash: 'a'.repeat(64), caption: 'x'.repeat(LIMITS.captionMaxLength + 1) }, 'caption'],
    ]
    for (const [body, field] of cases) {
      const res = await server.fetchJson<ErrorBody>(`${BASE}/${created.body.id}/photos`, {
        method: 'POST', token: TOKEN, body: JSON.stringify(body),
      })
      assert.equal(res.status, 400, `expected 400 for ${field}`)
      assert.equal(res.body.error.details?.field, field)
    }
  })

  test('a valid body is rebuilt, so nothing unvalidated can survive', () => {
    const [item] = validateSetItems([{
      legend: '  Esc  ', units: 1, heightUnits: 1, shape: 'rect',
      count: 2, group: '  Modifiers ', color: 'tan', source: 'photo',
    }])
    assert.deepEqual(item, {
      units: 1, legend: 'Esc', heightUnits: 1, shape: 'rect',
      count: 2, group: 'Modifiers', color: 'tan', source: 'photo',
    })
  })

  test('an empty optional string is read as absent rather than stored', () => {
    const [item] = validateSetItems([{ units: 1, legend: '', group: '   ', color: '' }])
    assert.deepEqual(item, { units: 1 })
  })

  test('null and undefined are both absent for an optional field', () => {
    assert.deepEqual(
      validateSetItems([{ units: 1, legend: null, shape: null, count: null }]), [{ units: 1 }])
  })

  test('the enums the client may send are exactly the ones the server accepts', () => {
    // Two modules, one vocabulary. If either list grows, this fails.
    assert.deepEqual([...POCKET_SHAPES], ['rect', 'iso-enter'])
    assert.deepEqual([...SET_ITEM_SOURCES], ['manual', 'photo'])
  })

  test('quarter-unit widths are accepted across the library range', () => {
    for (const units of [0.25, 1, 1.25, 1.75, 2.25, 6.25, 13]) {
      assert.deepEqual(validateSetItems([{ units }]), [{ units }])
    }
  })
})
