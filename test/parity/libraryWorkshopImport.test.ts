import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createFilesystemAssetStore } from '../../lib/assets/assetStore.ts'
import type { LibraryCollection, LibraryModelDetail } from '../../lib/contracts/library.ts'
import { WORKSHOP_BUNDLE_FORMAT } from '../../lib/contracts/libraryWorkshop.ts'
import type { WorkshopBundle, WorkshopImportReport } from '../../lib/contracts/libraryWorkshop.ts'
import { readWorkshopLibrary } from '../../scripts/library-workshop-export.ts'
import { OTHER_OID, startTestServer, stubVerifier, validClaims } from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'

const OWNER = 'owner-token'
const OTHER = 'other-token'
const MODEL_ID = '0b5f6c2e-1111-4222-8333-944455556666'
const SECOND_ID = '0b5f6c2e-1111-4222-8333-944455557777'
const NOT_SYNCED = '0b5f6c2e-1111-4222-8333-944455558888'
const sha = (value: string) => createHash('sha256').update(value).digest('hex')

interface ImportResponse { committed: boolean; reportHash: string; report: WorkshopImportReport }

let server: TestServer
let root: string

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'shapepilot-library-workshop-'))
  server = await startTestServer({
    label: 'library-workshop',
    verifier: stubVerifier({ [OWNER]: validClaims(), [OTHER]: validClaims({ oid: OTHER_OID }) }),
    assetStore: createFilesystemAssetStore(root),
  })
})

afterEach(async () => {
  await server.close()
  rmSync(root, { recursive: true, force: true })
})

async function syncModels(token: string, ids: string[]) {
  const device = await server.fetchJson<{ token: string }>('/api/library/devices', {
    method: 'POST', token, body: JSON.stringify({ name: 'Studio Mac' }),
  })
  const res = await server.fetchJson(`/api/library/sync/models`, {
    method: 'POST',
    headers: { authorization: `Device ${device.body.token}` },
    body: JSON.stringify({
      startedAt: '2026-10-15T00:00:00.000Z',
      models: ids.map(id => ({ id, title: `Model ${id.slice(-4)}`, category: 'Festool', status: 'want', files: [] })),
    }),
  })
  expect(res.status).toBe(200)
}

const bundle = (): WorkshopBundle => ({
  format: WORKSHOP_BUNDLE_FORMAT,
  sourceSha256: sha('workshop.db'),
  models: [
    { id: MODEL_ID, favorite: true, bambuHubUrl: 'https://workshop.nintek.com/bambu/7' },
    { id: NOT_SYNCED, favorite: true, bambuHubUrl: null },
  ],
  collections: [
    { name: 'Festool', kind: 'manual', query: null, modelIds: [MODEL_ID, SECOND_ID, NOT_SYNCED], createdAt: '2026-09-01T00:00:00.000Z' },
    { name: 'Wanted', kind: 'smart', query: { status: 'want' }, modelIds: [], createdAt: '2026-09-02T00:00:00.000Z' },
  ],
  manualPrints: [{
    modelId: MODEL_ID, title: 'Model 6666', result: 'completed', startedAt: '2026-09-10T10:00:00.000Z',
    endedAt: null, seconds: 3600, grams: 40, notes: 'first one', createdAt: '2026-09-10T12:00:00.000Z',
  }],
  decisions: [
    {
      jobKey: 'conn-1:job-1', modelId: SECOND_ID, matchState: 'confirmed', matchScore: 0.7, title: 'divider.3mf',
      result: 'completed', startedAt: '2026-09-11T10:00:00.000Z', endedAt: null, seconds: 100, grams: 5, materials: [],
    },
    {
      jobKey: 'conn-1:job-2', modelId: null, matchState: 'rejected', matchScore: 0.6, title: 'calibration',
      result: 'failed', startedAt: '2026-09-12T10:00:00.000Z', endedAt: null, seconds: 50, grams: 1, materials: [],
    },
  ],
})

const post = (token: string, body: unknown) => server.fetchJson<ImportResponse>('/api/library/import/workshop', {
  method: 'POST', token, body: JSON.stringify(body),
})

const tally = (applied: number, unchanged: number, skipped: number) => ({ applied, unchanged, skipped })

describe('Workshop carry-over', () => {
  test('a dry run writes nothing; applying its hash commits exactly that report; a second run changes nothing', async () => {
    await syncModels(OWNER, [MODEL_ID, SECOND_ID])

    const dry = await post(OWNER, { bundle: bundle() })
    expect(dry.status).toBe(200)
    expect(dry.body.committed).toBe(false)
    expect(dry.body.report).toEqual({
      sourceSha256: sha('workshop.db'),
      favorites: tally(1, 0, 1),
      bambuHubUrls: { ...tally(1, 0, 0), differs: 0 },
      collections: { ...tally(2, 0, 0), conflicts: [] },
      collectionMembers: tally(2, 0, 1),
      manualPrints: tally(1, 0, 0),
      decisions: tally(2, 0, 0),
      missingModels: [NOT_SYNCED],
    })
    expect((await server.fetchJson<LibraryCollection[]>('/api/library/collections', { token: OWNER })).body).toEqual([])
    expect((await server.fetchJson<LibraryModelDetail>(`/api/library/models/${MODEL_ID}`, { token: OWNER })).body.favorite).toBe(false)

    const applied = await post(OWNER, { bundle: bundle(), apply: dry.body.reportHash })
    expect(applied.status).toBe(200)
    expect(applied.body).toEqual({ ...dry.body, committed: true })

    const model = (await server.fetchJson<LibraryModelDetail>(`/api/library/models/${MODEL_ID}`, { token: OWNER })).body
    expect(model).toMatchObject({ favorite: true, bambuHubUrl: 'https://workshop.nintek.com/bambu/7', printedCount: 1 })
    expect(model.prints).toEqual([expect.objectContaining({ source: 'manual', notes: 'first one', grams: 40 })])
    const second = (await server.fetchJson<LibraryModelDetail>(`/api/library/models/${SECOND_ID}`, { token: OWNER })).body
    expect(second.prints).toEqual([expect.objectContaining({ source: 'bambu', matchState: 'confirmed' })])
    const collections = (await server.fetchJson<LibraryCollection[]>('/api/library/collections', { token: OWNER })).body
    expect(collections.map(c => [c.name, c.kind, c.count])).toEqual([['Festool', 'manual', 2], ['Wanted', 'smart', 2]])
    const rejected = server.database.handle.prepare(
      `SELECT model_id, match_state FROM library_prints WHERE job_key = 'conn-1:job-2'`).get()
    expect(rejected).toEqual({ model_id: null, match_state: 'rejected' })

    const again = await post(OWNER, { bundle: bundle() })
    expect(again.body.report).toMatchObject({
      favorites: tally(0, 1, 1),
      bambuHubUrls: tally(0, 1, 0),
      collections: tally(0, 2, 0),
      collectionMembers: tally(0, 2, 1),
      manualPrints: tally(0, 1, 0),
      decisions: tally(0, 2, 0),
    })
    const reapplied = await post(OWNER, { bundle: bundle(), apply: again.body.reportHash })
    expect(reapplied.body.committed).toBe(true)
    const count = (sql: string) => (server.database.handle.prepare(sql).get() as { n: number }).n
    expect(count('SELECT COUNT(*) AS n FROM library_prints')).toBe(3)
    expect(count('SELECT COUNT(*) AS n FROM library_collections')).toBe(2)
    expect(count('SELECT COUNT(*) AS n FROM library_collection_models')).toBe(2)
  })

  test('a model synced after the first run is picked up by the next one', async () => {
    await syncModels(OWNER, [MODEL_ID, SECOND_ID])
    const first = await post(OWNER, { bundle: bundle() })
    await post(OWNER, { bundle: bundle(), apply: first.body.reportHash })

    await syncModels(OWNER, [NOT_SYNCED])
    const next = await post(OWNER, { bundle: bundle() })
    expect(next.body.report).toMatchObject({ favorites: tally(1, 1, 0), collectionMembers: tally(1, 2, 0), missingModels: [] })
  })

  test('applying a stale hash is refused and writes nothing', async () => {
    await syncModels(OWNER, [MODEL_ID, SECOND_ID])
    const dry = await post(OWNER, { bundle: bundle() })
    await server.fetchJson(`/api/library/models/${MODEL_ID}`, {
      method: 'PUT', token: OWNER, body: JSON.stringify({ bambuHubUrl: 'https://example.com/hub/1' }),
    })
    const res = await post(OWNER, { bundle: bundle(), apply: dry.body.reportHash })
    expect(res.status).toBe(409)
    expect((await server.fetchJson<LibraryCollection[]>('/api/library/collections', { token: OWNER })).body).toEqual([])

    // The link set here wins over Workshop's.
    const redo = await post(OWNER, { bundle: bundle() })
    expect(redo.body.report.bambuHubUrls).toEqual({ ...tally(0, 0, 1), differs: 1 })
    await post(OWNER, { bundle: bundle(), apply: redo.body.reportHash })
    expect((await server.fetchJson<LibraryModelDetail>(`/api/library/models/${MODEL_ID}`, { token: OWNER })).body.bambuHubUrl)
      .toBe('https://example.com/hub/1')
  })

  test('is owner-scoped: another account imports into its own Library only', async () => {
    await syncModels(OWNER, [MODEL_ID, SECOND_ID])

    // The other account has none of these models, so nothing of the owner's is touched.
    const otherDry = await post(OTHER, { bundle: bundle() })
    expect(otherDry.body.report).toMatchObject({
      favorites: tally(0, 0, 2), collections: tally(2, 0, 0), collectionMembers: tally(0, 0, 3),
      manualPrints: tally(0, 0, 1), decisions: tally(1, 0, 1),
      missingModels: [MODEL_ID, SECOND_ID, NOT_SYNCED],
    })
    await post(OTHER, { bundle: bundle(), apply: otherDry.body.reportHash })
    expect((await server.fetchJson<LibraryModelDetail>(`/api/library/models/${MODEL_ID}`, { token: OWNER })).body.favorite).toBe(false)
    expect((await server.fetchJson<LibraryCollection[]>('/api/library/collections', { token: OWNER })).body).toEqual([])

    // The owner's own run is unaffected by the other account's rows.
    const ownerDry = await post(OWNER, { bundle: bundle() })
    expect(ownerDry.body.report).toMatchObject({ collections: tally(2, 0, 0), decisions: tally(2, 0, 0) })
    await post(OWNER, { bundle: bundle(), apply: ownerDry.body.reportHash })
    expect((await server.fetchJson<LibraryCollection[]>('/api/library/collections', { token: OTHER })).body.map(c => c.count))
      .toEqual([0, 0])
  })

  test('a decision upgrades a job the ledger already brought in', async () => {
    await syncModels(OWNER, [MODEL_ID, SECOND_ID])
    server.database.handle.prepare(`
      INSERT INTO library_prints (owner_tenant_id, owner_oid, source, job_key, title, result, match_state, match_score)
      SELECT tenant_id, oid, 'bambu', 'conn-1:job-1', 'divider.3mf', 'completed', 'suggested', 0.8 FROM app_memberships
      WHERE oid != ?`).run(OTHER_OID)
    const dry = await post(OWNER, { bundle: bundle() })
    expect(dry.body.report.decisions).toEqual(tally(2, 0, 0))
    await post(OWNER, { bundle: bundle(), apply: dry.body.reportHash })
    const row = server.database.handle.prepare(
      `SELECT model_id, match_state, match_score FROM library_prints WHERE job_key = 'conn-1:job-1'`).get()
    expect(row).toEqual({ model_id: SECOND_ID, match_state: 'confirmed', match_score: 0.8 })
  })

  test('rejects anything that is not an exporter bundle, and needs a session', async () => {
    expect((await post(OWNER, { bundle: { ...bundle(), format: 'other' } })).status).toBe(400)
    expect((await post(OWNER, { bundle: { ...bundle(), models: [{ id: '../etc', favorite: true }] } })).status).toBe(400)
    expect((await server.fetchJson('/api/library/import/workshop', {
      method: 'POST', body: JSON.stringify({ bundle: bundle() }),
    })).status).toBe(401)
  })
})

describe('the exporter', () => {
  test('reads only Workshop-only data, turns Hub ids into links and job ids into ledger keys', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE library_models (id TEXT PRIMARY KEY, favorite INTEGER NOT NULL DEFAULT 0, bambu_project_id INTEGER);
      CREATE TABLE library_collections (id INTEGER PRIMARY KEY, name TEXT, kind TEXT, query_json TEXT, created_at TEXT);
      CREATE TABLE library_collection_models (collection_id INTEGER, model_id TEXT, added_at TEXT);
      CREATE TABLE library_prints (
        id INTEGER PRIMARY KEY, model_id TEXT, source TEXT, external_job_id TEXT, title TEXT, result TEXT,
        started_at TEXT, ended_at TEXT, seconds REAL, grams REAL, printer TEXT, materials_json TEXT DEFAULT '[]',
        notes TEXT DEFAULT '', match_state TEXT, match_score REAL, created_at TEXT);
      INSERT INTO library_models VALUES ('${MODEL_ID}', 1, 7), ('${SECOND_ID}', 0, NULL), ('${NOT_SYNCED}', 0, 9);
      INSERT INTO library_collections VALUES (1, 'Festool', 'manual', NULL, '2026-09-01'), (2, 'Faves', 'smart', '{"favorite":true,"junk":1}', '2026-09-02');
      INSERT INTO library_collection_models VALUES (1, '${SECOND_ID}', '2026-09-01');
      INSERT INTO library_prints (model_id, source, external_job_id, result, match_state, match_score, created_at) VALUES
        ('${MODEL_ID}', 'manual', NULL, 'completed', 'manual', NULL, '2026-09-10'),
        ('${SECOND_ID}', 'shapepilot', 'shapepilot:conn-1:job-1', 'completed', 'confirmed', 0.7, '2026-09-11'),
        (NULL, 'shapepilot', 'shapepilot:conn-1:job-2', 'failed', 'rejected', 0.6, '2026-09-12'),
        ('${SECOND_ID}', 'shapepilot', 'shapepilot:conn-1:job-3', 'completed', 'auto', 0.99, '2026-09-13'),
        (NULL, 'shapepilot', 'shapepilot:conn-1:job-4', 'completed', 'unmatched', NULL, '2026-09-14');
    `)
    const out = readWorkshopLibrary(db, sha('workshop.db'))
    expect(out.models).toEqual([
      { id: MODEL_ID, favorite: true, bambuHubUrl: 'https://workshop.nintek.com/bambu/7' },
      { id: NOT_SYNCED, favorite: false, bambuHubUrl: 'https://workshop.nintek.com/bambu/9' },
    ])
    expect(out.collections.map(c => [c.name, c.kind, c.query, c.modelIds])).toEqual([
      ['Festool', 'manual', null, [SECOND_ID]], ['Faves', 'smart', { favorite: true }, []],
    ])
    expect(out.manualPrints).toHaveLength(1)
    expect(out.decisions.map(d => [d.jobKey, d.matchState, d.modelId])).toEqual([
      ['conn-1:job-1', 'confirmed', SECOND_ID], ['conn-1:job-2', 'rejected', null],
    ])
  })
})
