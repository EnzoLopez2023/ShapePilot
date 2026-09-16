// Filament usage routes: per-colour usage from the recorded print history, and
// the hand-made links that settle what the matcher cannot.
//
// The matching rules themselves are pinned in lib/contracts/filamentUsage.test.ts.
// What is pinned here is what only the route can get wrong: usage is
// administrator data and refused to anyone else, links belong to the account
// that made them, a link takes effect on the very next read, and a link is
// stored in exactly the normalised form a print will be compared against.
import assert from 'node:assert/strict'
import { afterAll, beforeAll, describe, test } from 'vitest'
import {
  OTHER_OID, TEST_OID, startTestServer, stubVerifier, validClaims,
} from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'
import {
  syntheticElementConnection, syntheticElementJob, syntheticElementSnapshot, syntheticElementSyncState,
} from '../fixtures/elementStatistics.ts'
import type {
  FilamentUsageMapping, FilamentUsageReport as FilamentUsage,
} from '../../lib/contracts/filamentUsage.ts'

const ADMIN = 'admin-token'
const USER = 'user-token'
const BASE = '/api/filaments/usage'

const COCOA = 'bambu-lab/pla/basic/cocoa-brown-10802'
const BLUE = 'bambu-lab/pla/basic/blue-10601'
const MYSTERY_BLUE = { material: 'PLA', filamentId: 'GFA00', color: '#307FE2' }
const THIRD_PARTY_ABS = { material: 'ABS', filamentId: 'GFB99', color: '#161616' }

interface ErrorBody { error?: { code?: string; details?: { field?: string } } }

describe('filament usage routes', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startTestServer({
      label: 'filament-usage',
      env: { SHAPEPILOT_ADMIN_OIDS: TEST_OID },
      verifier: stubVerifier({
        [ADMIN]: validClaims(),
        [USER]: validClaims({ oid: OTHER_OID }),
      }),
    })
    const stats = server.repos.elementStatistics
    await stats.saveConnection(syntheticElementConnection)
    await stats.commitPage(syntheticElementConnection.id, [
      syntheticElementJob({
        id: '1',
        materials: [{
          material: 'PLA', filamentId: 'GFA00', color: '#6F5034FF',
          estimatedWeightGrams: 120, nozzleId: '0', amsId: '0', slotId: '0',
        }, {
          material: 'PLA', filamentId: 'GFA00', color: '#307FE2FF',
          estimatedWeightGrams: 300, nozzleId: '0', amsId: '0', slotId: '1',
        }],
      }),
      syntheticElementJob({
        id: '2',
        result: 'failed_or_aborted',
        materials: [{
          material: 'ABS', filamentId: 'GFB99', color: '#161616FF',
          estimatedWeightGrams: 80, nozzleId: '1', amsId: '0', slotId: '2',
        }],
      }),
    ], syntheticElementSyncState.lastSuccessAt as string, syntheticElementSyncState)
  })

  afterAll(async () => { await server.close() })

  const get = <T = FilamentUsage>(token = ADMIN) => server.fetchJson<T>(BASE, { token })
  const put = <T = { mappings: FilamentUsageMapping[] }>(body: unknown, token = ADMIN) =>
    server.fetchJson<T>(`${BASE}/mappings`, { method: 'PUT', token, body: JSON.stringify(body) })

  test('totals matched colours and lists what it could not match', async () => {
    const response = await get()
    assert.equal(response.status, 200)
    assert.deepEqual(response.body.colors.map(color => [color.key, color.grams]), [[COCOA, 120]])
    assert.deepEqual(response.body.unmatched.map(entry => [entry.material, entry.color, entry.grams]), [
      ['PLA', '#307FE2', 300],
      ['ABS', '#161616', 80],
    ])
    assert.equal(response.body.unmatched[1].failedGrams, 80)
    assert.equal(response.body.coverage.prints, 2)
  })

  test('carries the AMS of the printer being recorded, matched to catalogue colours', async () => {
    // No active printer yet: no AMS, and usage is still served.
    assert.equal((await get()).body.ams, null)

    const stats = server.repos.elementStatistics
    await stats.saveSettings({
      enabled: true, activeConnectionId: syntheticElementConnection.id, updatedAt: null,
    })
    await stats.recordSnapshot(syntheticElementConnection.id, {
      ...syntheticElementSnapshot,
      ams: [
        { amsId: '0', slotId: '0', material: 'PLA', subBrand: 'PLA Basic', color: '#6F5034FF', remainingPercent: 12, empty: false },
        { amsId: '0', slotId: '1', material: 'ABS', subBrand: '', color: '#161616FF', remainingPercent: null, empty: false },
        { amsId: '0', slotId: '2', material: null, subBrand: null, color: null, remainingPercent: null, empty: true },
      ],
    })

    const ams = (await get()).body.ams
    assert.ok(ams)
    assert.deepEqual(ams.slots.map(slot => [slot.slotId, slot.key, slot.remainingPercent]), [
      ['0', COCOA, 12],
      ['1', null, null],
    ])
  })

  test('is administrator data, refused to everyone else', async () => {
    assert.equal((await get<ErrorBody>(USER)).status, 403)
    assert.equal((await put<ErrorBody>({ mappings: [] }, USER)).status, 403)
    assert.equal((await server.fetchJson(BASE)).status, 401)
  })

  test('a link takes effect on the next read, and "don\'t track" sets usage aside', async () => {
    const saved = await put({
      mappings: [
        { source: MYSTERY_BLUE, key: BLUE },
        { source: THIRD_PARTY_ABS, key: null },
      ],
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.mappings.length, 2)

    const usage = (await get()).body
    assert.equal(usage.colors.find(color => color.key === BLUE)?.grams, 300)
    assert.deepEqual(usage.unmatched, [])
    assert.deepEqual(usage.untracked.map(entry => [entry.color, entry.grams]), [['#161616', 80]])

    // Removing the links puts both back in the unmatched list.
    await put({ mappings: [] })
    assert.equal((await get()).body.unmatched.length, 2)
  })

  test('refuses a link that is not in the normalised form a print is compared against', async () => {
    for (const [source, field] of [
      [{ ...MYSTERY_BLUE, material: 'pla' }, 'mappings[0].source.material'],
      [{ ...MYSTERY_BLUE, filamentId: ' GFA00' }, 'mappings[0].source.filamentId'],
      [{ ...MYSTERY_BLUE, color: '#307fe2' }, 'mappings[0].source.color'],
      [{ ...MYSTERY_BLUE, color: '#307FE2FF' }, 'mappings[0].source.color'],
      [{ material: 'PLA', filamentId: 'GFA00' }, 'mappings[0].source.color'],
    ] as const) {
      const response = await put<ErrorBody>({ mappings: [{ source, key: BLUE }] })
      assert.equal(response.status, 400, JSON.stringify(source))
      assert.equal(response.body.error?.details?.field, field)
    }
  })

  test('refuses a colour that does not exist, and a source linked twice', async () => {
    const unknown = await put<ErrorBody>({
      mappings: [{ source: MYSTERY_BLUE, key: 'bambu-lab/pla/basic/invented-99999' }],
    })
    assert.equal(unknown.body.error?.details?.field, 'mappings[0].key')

    const twice = await put<ErrorBody>({
      mappings: [{ source: MYSTERY_BLUE, key: BLUE }, { source: MYSTERY_BLUE, key: null }],
    })
    assert.equal(twice.body.error?.details?.field, 'mappings[1]')
  })

  test('links belong to the account that made them', async () => {
    await server.repos.filamentUsageMappings.replace(
      { tenantId: validClaims().tid as string, oid: OTHER_OID },
      [{ source: MYSTERY_BLUE, key: null }],
    )
    const usage = (await get()).body
    // The other account's "don't track" does not hide this administrator's usage.
    assert.ok(usage.unmatched.some(entry => entry.color === '#307FE2'))
    assert.deepEqual(usage.mappings, [])
  })
})
