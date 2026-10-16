import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createFilesystemAssetStore } from '../../lib/assets/assetStore.ts'
import type {
  LibraryCollection, LibraryModel, LibraryModelDetail, LibraryModelPage, LibraryOverview, LibraryPrint,
} from '../../lib/contracts/library.ts'
import {
  ELEMENT_TEST_NOW, syntheticElementConnection, syntheticElementJob, syntheticElementSyncState,
} from '../fixtures/elementStatistics.ts'
import {
  OTHER_OID, TEST_OID, TEST_TENANT, startTestServer, stubVerifier, validClaims,
} from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'

const OWNER = 'owner-token'
const OTHER = 'other-token'
const MODEL_ID = '0b5f6c2e-1111-4222-8333-944455556666'
const SECOND_ID = '0b5f6c2e-1111-4222-8333-944455557777'
const sha = (value: string) => createHash('sha256').update(value).digest('hex')

let server: TestServer
let root: string

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'shapepilot-library-'))
  server = await startTestServer({
    label: 'library',
    verifier: stubVerifier({ [OWNER]: validClaims(), [OTHER]: validClaims({ oid: OTHER_OID }) }),
    assetStore: createFilesystemAssetStore(root),
  })
})

afterEach(async () => {
  await server.close()
  rmSync(root, { recursive: true, force: true })
})

async function deviceToken(token = OWNER): Promise<string> {
  const res = await server.fetchJson<{ id: string; token: string }>('/api/library/devices', {
    method: 'POST', token, body: JSON.stringify({ name: 'Studio Mac' }),
  })
  expect(res.status).toBe(201)
  expect(res.body.token).toMatch(/^spl1\.[A-Za-z0-9_-]{43}$/)
  return res.body.token
}

function sync<T>(device: string, path: string, body?: unknown, method = 'POST') {
  return server.fetchJson<T>(`/api/library/sync${path}`, {
    method,
    headers: { authorization: `Device ${device}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

const syncedModel = (overrides: Record<string, unknown> = {}) => ({
  id: MODEL_ID,
  title: 'Systainer divider',
  category: 'Festool',
  folder: 'Festool/Systainer divider',
  status: 'want',
  tags: ['sys3', 'SYS3', ' festool '],
  notes: '',
  designer: 'Someone',
  source: { site: 'makerworld', url: 'https://makerworld.com/en/models/1', modelId: '1' },
  workshopVersion: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  thumb: sha('hero'),
  gallery: [sha('plate-1'), 'not-a-hash'],
  files: [{
    relPath: 'Festool/Systainer divider/divider.3mf',
    filename: 'divider.3mf',
    kind: '3mf',
    size: 1234,
    sha256: sha('divider.3mf'),
    geomHash: sha('geometry'),
    mtimeMs: Date.parse('2026-09-01T00:00:00.000Z'),
    triangles: 900,
    bbox: [120, 80, 20],
    isSliced: true,
    seconds: 3600,
    grams: 45,
    plates: [{ index: 1, name: 'Synthetic calibration plate', grams: 45 }],
    filaments: [{ type: 'PLA', color: '#336699' }],
  }],
  ...overrides,
})

describe('device tokens', () => {
  test('sync needs a live device token, never an Entra session', async () => {
    expect((await sync('', '/edits', undefined, 'GET')).status).toBe(401)
    expect((await server.fetchJson('/api/library/sync/edits', { token: OWNER })).status).toBe(401)
    const device = await deviceToken()
    expect((await sync(device, '/edits', undefined, 'GET')).status).toBe(200)
    // A different last character, never the token itself (it is one of 16 values, 'A' among them).
    expect((await sync(`${device.slice(0, -1)}${device.endsWith('A') ? 'B' : 'A'}`, '/edits', undefined, 'GET')).status).toBe(401)

    const [listed] = (await server.fetchJson<{ id: string }[]>('/api/library/devices', { token: OWNER })).body
    // Another account cannot revoke it; its owner can.
    expect((await server.fetchJson(`/api/library/devices/${listed.id}`, { method: 'DELETE', token: OTHER })).status).toBe(404)
    expect((await server.fetchJson(`/api/library/devices/${listed.id}`, { method: 'DELETE', token: OWNER })).status).toBe(204)
    expect((await sync(device, '/edits', undefined, 'GET')).status).toBe(401)
  })

  test('only a digest of the token is stored', async () => {
    const device = await deviceToken()
    const rows = server.database.handle.prepare('SELECT token_hash FROM library_devices').all() as { token_hash: string }[]
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain(device.slice(5))
  })
})

describe('sync', () => {
  test('a synced model is cleaned, aggregated and visible only to its owner', async () => {
    const device = await deviceToken()
    const res = await sync<{ accepted: number; errors: unknown[] }>(device, '/models', {
      startedAt: '2026-10-15T00:00:00.000Z',
      models: [syncedModel(), { id: 'bad id', title: 'x' }],
    })
    expect(res.body).toEqual({ accepted: 1, errors: [{ id: 'bad id', error: 'model id is required' }] })

    const page = await server.fetchJson<LibraryModelPage>('/api/library/models', { token: OWNER })
    expect(page.body.total).toBe(1)
    const [model] = page.body.items
    expect(model).toMatchObject({
      id: MODEL_ID, title: 'Systainer divider', category: 'Festool', status: 'want',
      tags: ['sys3', 'festool'], formats: ['sliced'], estGrams: 45, estSeconds: 3600, plateCount: 1,
      bbox: [120, 80, 20], gallery: [sha('plate-1')], sourceSite: 'makerworld', bambuHubUrl: null,
    })
    expect((await server.fetchJson<LibraryModelPage>('/api/library/models', { token: OTHER })).body.total).toBe(0)
    expect((await server.fetchJson(`/api/library/models/${MODEL_ID}`, { token: OTHER })).status).toBe(404)
  })

  test('an edit made here waits for the disk, even when model.json already carries Workshop versions', async () => {
    const device = await deviceToken()
    // The folder was edited five times in Workshop before the move.
    await sync(device, '/models', { startedAt: '2026-10-15T00:00:00.000Z', models: [syncedModel({ workshopVersion: 5 })] })
    const edited = await server.fetchJson<LibraryModel>(`/api/library/models/${MODEL_ID}`, {
      method: 'PUT', token: OWNER, body: JSON.stringify({ title: 'Renamed here', notes: 'Use PETG' }),
    })
    expect(edited.body.title).toBe('Renamed here')

    const edits = await sync<{ edits: { id: string; title: string; workshopVersion: number }[] }>(device, '/edits', undefined, 'GET')
    expect(edits.body.edits).toEqual([expect.objectContaining({ id: MODEL_ID, title: 'Renamed here', notes: 'Use PETG', workshopVersion: 6 })])

    // A sync from before the disk applied the edit must not overwrite it.
    await sync(device, '/models', { startedAt: '2026-10-15T01:00:00.000Z', models: [syncedModel({ workshopVersion: 5 })] })
    expect((await server.fetchJson<LibraryModel>(`/api/library/models/${MODEL_ID}`, { token: OWNER })).body.title).toBe('Renamed here')

    // Once model.json carries version 6, the disk is the source again.
    await sync(device, '/models', {
      startedAt: '2026-10-15T02:00:00.000Z', models: [syncedModel({ workshopVersion: 6, title: 'Renamed on disk' })],
    })
    expect((await server.fetchJson<LibraryModel>(`/api/library/models/${MODEL_ID}`, { token: OWNER })).body.title).toBe('Renamed on disk')
    expect((await sync<{ edits: unknown[] }>(device, '/edits', undefined, 'GET')).body.edits).toEqual([])
  })

  test('commit marks models the scan no longer saw as missing and keeps the plan', async () => {
    const device = await deviceToken()
    await sync(device, '/models', {
      startedAt: '2026-10-15T00:00:00.000Z', models: [syncedModel(), syncedModel({ id: SECOND_ID, files: [] })],
    })
    await sync(device, '/models', { startedAt: '2026-10-16T00:00:00.000Z', models: [syncedModel()] })
    const plan = { createdAt: '2026-10-16T00:00:00.000Z', intakeOnly: false, skipped: 0, models: [{ id: 'x' }], summary: { models: 1 } }
    const commit = await sync<{ missing: number }>(device, '/commit', {
      startedAt: '2026-10-16T00:00:00.000Z', plan, batches: [{ batch: 'b1', at: '2026-10-16T00:00:00.000Z', ops: 2, undone: false, kind: 'intake' }],
      stats: { models: 1, files: 1 },
    })
    expect(commit.body.missing).toBe(1)
    const overview = await server.fetchJson<LibraryOverview>('/api/library/overview', { token: OWNER })
    expect(overview.body).toMatchObject({
      missing: 1, byStatus: { want: 1 }, planSummary: { pending: 1 },
      lastSync: { device: 'Studio Mac', stats: { models: 1, files: 1 } },
      printHistory: { available: false, lastSync: null },
    })
    expect(overview.body.batches).toHaveLength(1)
    expect((await server.fetchJson('/api/library/plan', { token: OWNER })).body).toEqual(plan)
  })

  test('a sync batch larger than the app-wide JSON limit is accepted', async () => {
    const device = await deviceToken()
    const models = Array.from({ length: 300 }, (_, i) => syncedModel({
      id: `0b5f6c2e-1111-4222-8333-${String(i).padStart(12, '0')}`,
      description: 'x'.repeat(7_900),
      files: [],
    }))
    const res = await sync<{ accepted: number }>(device, '/models', { startedAt: '2026-10-15T00:00:00.000Z', models })
    expect(res.status).toBe(200)
    expect(res.body.accepted).toBe(300)
  })

  test('thumbnails are verified, stored per owner and served only to their owner', async () => {
    const device = await deviceToken()
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('pixels')])
    const hash = createHash('sha256').update(png).digest('hex')
    expect((await sync<{ missing: string[] }>(device, '/thumbs/missing', { hashes: [hash, 'nope'] })).body.missing).toEqual([hash])

    const put = (body: Buffer, at = hash) => fetch(`${server.baseUrl}/api/library/sync/thumbs/${at}`, {
      method: 'PUT', headers: { authorization: `Device ${device}`, 'content-type': 'image/png' }, body,
    })
    expect((await put(Buffer.from('not a png'))).status).toBe(400)
    expect((await put(png, sha('other'))).status).toBe(400)
    expect((await put(png)).status).toBe(204)
    expect((await sync<{ missing: string[] }>(device, '/thumbs/missing', { hashes: [hash] })).body.missing).toEqual([])

    const read = (token: string) => fetch(`${server.baseUrl}/api/library/thumbs/${hash}`, { headers: { authorization: `Bearer ${token}` } })
    const mine = await read(OWNER)
    expect(mine.status).toBe(200)
    expect(mine.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await mine.arrayBuffer())).toEqual(png)
    expect((await read(OTHER)).status).toBe(404)
  })
})

describe('the pages', () => {
  beforeEach(async () => {
    const device = await deviceToken()
    await sync(device, '/models', {
      startedAt: '2026-10-15T00:00:00.000Z',
      models: [syncedModel(), syncedModel({ id: SECOND_ID, title: 'Spool holder', category: 'X2D', status: 'inbox', tags: [], files: [] })],
    })
  })

  test('filters, search over file names, and the Bambu Hub link', async () => {
    const titles = async (query: string) =>
      (await server.fetchJson<LibraryModelPage>(`/api/library/models?${query}`, { token: OWNER })).body.items.map(m => m.title)
    expect(await titles('sort=title')).toEqual(['Spool holder', 'Systainer divider'])
    expect(await titles('category=X2D')).toEqual(['Spool holder'])
    expect(await titles('q=divider.3mf')).toEqual(['Systainer divider'])
    expect(await titles('status=inbox,want&sort=title')).toEqual(['Spool holder', 'Systainer divider'])

    const put = (body: unknown) => server.fetchJson<LibraryModel>(`/api/library/models/${MODEL_ID}`, {
      method: 'PUT', token: OWNER, body: JSON.stringify(body),
    })
    expect((await put({ bambuHubUrl: 'javascript:alert(1)' })).status).toBe(400)
    expect((await put({ status: 'nope' })).status).toBe(400)
    expect((await put({ title: '  ' })).status).toBe(400)
    const linked = await put({ bambuHubUrl: 'https://workshop.nintek.com/bambu/12', favorite: true })
    expect(linked.body).toMatchObject({ bambuHubUrl: 'https://workshop.nintek.com/bambu/12', favorite: true })
    expect(await titles('favorite=1')).toEqual(['Systainer divider'])
    expect((await put({ bambuHubUrl: null })).body.bambuHubUrl).toBeNull()
  })

  test('collections: manual membership, smart counts, unique names', async () => {
    const post = (body: unknown) => server.fetchJson<LibraryCollection>('/api/library/collections', {
      method: 'POST', token: OWNER, body: JSON.stringify(body),
    })
    const manual = await post({ name: 'Gifts', kind: 'manual', modelIds: [MODEL_ID, 'missing-model'] })
    expect(manual.body).toMatchObject({ kind: 'manual', count: 1 })
    expect((await post({ name: 'gifts', kind: 'manual' })).status).toBe(409)
    const smart = await post({ name: 'Inbox X2D', kind: 'smart', query: { status: 'inbox', category: 'X2D', junk: 1 } })
    expect(smart.body).toMatchObject({ kind: 'smart', count: 1, query: { status: 'inbox', category: 'X2D' } })

    expect((await server.fetchJson(`/api/library/collections/${smart.body.id}/models/${MODEL_ID}`, { method: 'PUT', token: OWNER })).status).toBe(400)
    expect((await server.fetchJson(`/api/library/collections/${manual.body.id}/models/${SECOND_ID}`, { method: 'PUT', token: OWNER })).status).toBe(204)
    expect((await server.fetchJson(`/api/library/collections/${manual.body.id}/models/${SECOND_ID}`, { method: 'PUT', token: OTHER })).status).toBe(404)

    const inCollection = await server.fetchJson<LibraryModelPage>(`/api/library/models?collection=${manual.body.id}`, { token: OWNER })
    expect(inCollection.body.total).toBe(2)
    const detail = await server.fetchJson<LibraryModelDetail>(`/api/library/models/${SECOND_ID}`, { token: OWNER })
    expect(detail.body.collectionIds).toEqual([manual.body.id])

    expect((await server.fetchJson(`/api/library/collections/${manual.body.id}`, { method: 'DELETE', token: OWNER })).status).toBe(204)
    expect((await server.fetchJson<LibraryModelPage>('/api/library/models', { token: OWNER })).body.total).toBe(2)
  })

  test('a print logged by hand sets the status and can be taken back', async () => {
    const logged = await server.fetchJson<LibraryPrint>(`/api/library/models/${SECOND_ID}/prints`, {
      method: 'POST', token: OWNER, body: JSON.stringify({ result: 'failed', notes: 'Warped' }),
    })
    expect(logged.status).toBe(201)
    let detail = (await server.fetchJson<LibraryModelDetail>(`/api/library/models/${SECOND_ID}`, { token: OWNER })).body
    expect(detail).toMatchObject({ status: 'failed', failedCount: 1, prints: [{ source: 'manual', notes: 'Warped' }] })
    await server.fetchJson(`/api/library/models/${SECOND_ID}/prints`, { method: 'POST', token: OWNER, body: JSON.stringify({}) })
    detail = (await server.fetchJson<LibraryModelDetail>(`/api/library/models/${SECOND_ID}`, { token: OWNER })).body
    expect(detail).toMatchObject({ status: 'printed', printedCount: 1 })
    expect((await server.fetchJson(`/api/library/prints/${logged.body.id}`, { method: 'DELETE', token: OTHER })).status).toBe(404)
    expect((await server.fetchJson(`/api/library/prints/${logged.body.id}`, { method: 'DELETE', token: OWNER })).status).toBe(204)
  })

  test('a deleted model leaves the Library with its prints and memberships', async () => {
    await server.fetchJson(`/api/library/models/${MODEL_ID}/prints`, { method: 'POST', token: OWNER, body: JSON.stringify({}) })
    const gifts = await server.fetchJson<LibraryCollection>('/api/library/collections', {
      method: 'POST', token: OWNER, body: JSON.stringify({ name: 'Gifts', kind: 'manual', modelIds: [MODEL_ID, SECOND_ID] }),
    })
    const remove = (token: string) => server.fetchJson(`/api/library/models/${MODEL_ID}`, { method: 'DELETE', token })

    expect((await remove(OTHER)).status).toBe(404)
    expect((await remove(OWNER)).status).toBe(204)
    expect((await remove(OWNER)).status).toBe(404)
    expect((await server.fetchJson(`/api/library/models/${MODEL_ID}`, { token: OWNER })).status).toBe(404)
    const left = await server.fetchJson<LibraryModelPage>('/api/library/models', { token: OWNER })
    expect(left.body.items.map(m => m.id)).toEqual([SECOND_ID])
    const collections = await server.fetchJson<LibraryCollection[]>('/api/library/collections', { token: OWNER })
    expect(collections.body.find(c => c.id === gifts.body.id)?.count).toBe(1)
  })

  test('same geometry across models is reported as a duplicate group', async () => {
    const device = await deviceToken()
    const copy = syncedModel().files[0]
    await sync(device, '/models', {
      startedAt: '2026-10-15T00:00:00.000Z',
      models: [syncedModel({ id: SECOND_ID, title: 'Spool holder', files: [{ ...copy, relPath: 'X2D/Spool holder/copy.stl', kind: 'stl' }] })],
    })
    const groups = await server.fetchJson<{ geomHash: string; files: { modelId: string }[] }[]>('/api/library/duplicates', { token: OWNER })
    expect(groups.body).toHaveLength(1)
    expect(groups.body[0].files.map(f => f.modelId).sort()).toEqual([MODEL_ID, SECOND_ID])
  })
})

describe('print history', () => {
  async function seedJobs() {
    const repo = server.repos.elementStatistics
    const connection = await repo.saveConnection(syntheticElementConnection)
    await repo.commitPage(connection.id, [
      syntheticElementJob(),
      syntheticElementJob({ id: '901', title: 'Spool holer', result: 'failed_or_aborted', estimatedWeightGrams: 12 }),
      syntheticElementJob({ id: '902', title: 'Something unrelated entirely', estimatedWeightGrams: 3 }),
    ], ELEMENT_TEST_NOW, syntheticElementSyncState)
  }

  test('is the household ledger, so only an administrator can link it', async () => {
    await seedJobs()
    expect((await server.fetchJson('/api/library/print-history/sync', { method: 'POST', token: OWNER })).status).toBe(403)
  })

  test('links exact names automatically and offers close ones for review', async () => {
    await seedJobs()
    // The first request creates the membership; then promote it.
    await server.fetchJson('/api/library/overview', { token: OWNER })
    await server.repos.memberships.setRole({ tenantId: TEST_TENANT, oid: TEST_OID }, 'admin')
    const device = await deviceToken()
    await sync(device, '/models', {
      startedAt: '2026-10-15T00:00:00.000Z',
      models: [
        // The plate name matches the job title exactly, and the weight agrees.
        syncedModel({ files: [{ ...syncedModel().files[0], mtimeMs: Date.parse('2026-09-01T00:00:00.000Z') }] }),
        syncedModel({ id: SECOND_ID, title: 'Spool holder', status: 'want', files: [] }),
      ],
    })

    const counts = await server.fetchJson<{ imported: number; auto: number; suggested: number; unmatched: number }>(
      '/api/library/print-history/sync', { method: 'POST', token: OWNER })
    expect(counts.body).toEqual({ imported: 3, auto: 1, suggested: 1, unmatched: 1 })

    const detail = (await server.fetchJson<LibraryModelDetail>(`/api/library/models/${MODEL_ID}`, { token: OWNER })).body
    expect(detail).toMatchObject({ status: 'printed', printedCount: 1, prints: [{ source: 'bambu', matchState: 'auto' }] })

    const matches = (await server.fetchJson<LibraryPrint[]>('/api/library/matches', { token: OWNER })).body
    const suggested = matches.find(m => m.matchState === 'suggested')!
    expect(suggested).toMatchObject({ title: 'Spool holer', modelId: SECOND_ID, modelTitle: 'Spool holder' })
    const unmatched = matches.find(m => m.matchState === 'unmatched')!

    const confirmed = await server.fetchJson<LibraryPrint>(`/api/library/matches/${suggested.id}/confirm`, {
      method: 'POST', token: OWNER, body: JSON.stringify({}),
    })
    expect(confirmed.body.matchState).toBe('confirmed')
    expect((await server.fetchJson<LibraryModel>(`/api/library/models/${SECOND_ID}`, { token: OWNER })).body.status).toBe('failed')
    expect((await server.fetchJson(`/api/library/matches/${unmatched.id}/reject`, { method: 'POST', token: OWNER })).status).toBe(200)
    expect((await server.fetchJson<LibraryPrint[]>('/api/library/matches', { token: OWNER })).body).toEqual([])

    // Importing again re-reads only the last three days before the cursor, so
    // these September jobs are not read again, and nothing reopens.
    const again = await server.fetchJson<{ imported: number; auto: number; suggested: number; unmatched: number }>(
      '/api/library/print-history/sync', { method: 'POST', token: OWNER })
    expect(again.body).toEqual({ imported: 0, auto: 0, suggested: 0, unmatched: 0 })
    // Even when a job is read again, the unique job key keeps it to one row.
    await server.repos.library.importJobs({ tenantId: TEST_TENANT, oid: TEST_OID }, [{
      key: `${syntheticElementConnection.id}:900`, title: 'Synthetic calibration plate', result: 'completed',
      startedAt: '2026-09-14T16:00:00.000Z', endedAt: null, seconds: 3600, grams: 45, materials: [],
    }], ELEMENT_TEST_NOW, ELEMENT_TEST_NOW)
    expect((await server.fetchJson<LibraryModelDetail>(`/api/library/models/${MODEL_ID}`, { token: OWNER })).body.prints).toHaveLength(1)
    expect((await server.fetchJson<LibraryOverview>('/api/library/overview', { token: OWNER })).body.printHistory.available).toBe(true)
  })
})
