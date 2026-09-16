import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, describe, test } from 'vitest'
import type {
  ElementConnection, ElementEventInput, ElementJobInput, ElementSnapshot, ElementSyncState,
} from '../../lib/contracts/elementStatistics.ts'
import { openDatabase } from '../../lib/db/connection.ts'
import { emptyElementSyncState } from '../../lib/db/repositories/elementStatisticsContract.ts'
import { createRepositories } from '../../lib/db/repositories/index.ts'
import { canonicalTableHashFromDatabase } from '../../lib/legacy/canonicalTable.ts'
import { createTempDatabase } from '../helpers/server.ts'
import type { TempDatabase } from '../helpers/server.ts'

const T0 = '2026-09-15T10:00:00.000Z'
const T1 = '2026-09-15T10:01:00.000Z'
const T2 = '2026-09-15T10:02:00.000Z'
const fixtures: TempDatabase[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const connection = (overrides: Partial<ElementConnection> = {}): ElementConnection => ({
  id: 'household-a',
  accountId: 'account-a',
  accountName: 'Household A',
  region: 'global',
  printerId: 'printer-1',
  printerName: 'Workshop',
  printerModel: 'P1S',
  createdAt: T0,
  updatedAt: T0,
  ...overrides,
})

const sparseJob = (overrides: Partial<ElementJobInput> = {}): ElementJobInput => ({
  id: 'cloud-job-1',
  title: null,
  result: 'unknown',
  rawStatus: null,
  startedAt: null,
  endedAt: null,
  actualDurationSeconds: null,
  estimatedDurationSeconds: null,
  estimatedWeightGrams: null,
  estimatedLength: null,
  lengthUnit: null,
  materials: [],
  warnings: [],
  ...overrides,
})

const completedJob = (overrides: Partial<ElementJobInput> = {}): ElementJobInput => sparseJob({
  title: 'Tool tray',
  result: 'completed',
  rawStatus: 'finish',
  startedAt: '2026-09-01T10:00:00.000Z',
  endedAt: '2026-09-01T11:00:00.000Z',
  actualDurationSeconds: 3_600,
  estimatedDurationSeconds: 4_200,
  estimatedWeightGrams: 72.5,
  estimatedLength: 23_400,
  lengthUnit: 'mm',
  materials: [{
    material: 'PLA', filamentId: 'GFA00', color: 'FFFFFF',
    estimatedWeightGrams: 70, nozzleId: '0', amsId: '0', slotId: '1',
  }],
  warnings: ['Estimated, not weighed.'],
  ...overrides,
})

const sync = (connectionId = 'household-a', overrides: Partial<ElementSyncState> = {}): ElementSyncState => ({
  ...emptyElementSyncState(connectionId),
  lastAttemptAt: T0,
  lastSuccessAt: T0,
  ...overrides,
})

const snapshot = (overrides: Partial<ElementSnapshot> = {}): ElementSnapshot => ({
  receivedAt: T0,
  state: 'RUNNING',
  jobId: 'cloud-job-1',
  jobName: 'Tool tray',
  progressPercent: 20,
  remainingMinutes: 40,
  currentLayer: 20,
  totalLayers: 100,
  nozzleActualC: 220.5,
  nozzleTargetC: 220,
  bedActualC: 60,
  bedTargetC: 60,
  wifiSignalDbm: -48,
  printError: null,
  hms: null,
  ams: null,
  fieldUpdatedAt: { state: T0, progressPercent: T0 },
  ...overrides,
})

const event = (overrides: Partial<ElementEventInput> = {}): ElementEventInput => ({
  connectionId: 'household-a',
  occurredAt: T0,
  kind: 'printer_state',
  code: 'RUNNING',
  message: 'Printer is running.',
  jobId: 'cloud-job-1',
  ...overrides,
})

async function fixture(seedConnection = true) {
  const temp = createTempDatabase('element-statistics')
  fixtures.push(temp)
  if (seedConnection) await temp.repos.elementStatistics.saveConnection(connection())
  return { ...temp, repo: temp.repos.elementStatistics }
}

describe('EL-ement durable repository', () => {
  test('all empty reads are disabled and never create a seed row', async () => {
    const { repo, database } = await fixture(false)
    assert.deepEqual(await repo.getSettings(), {
      enabled: false, activeConnectionId: null, updatedAt: null,
    })
    assert.deepEqual(await repo.listConnections(), [])
    assert.deepEqual(await repo.getSyncState('not-configured'), emptyElementSyncState('not-configured'))
    assert.deepEqual(await repo.listJobs(null, 100), [])
    assert.equal(await repo.getJob('not-configured', 'no-job'), null)
    assert.deepEqual(await repo.coverage(), [])
    assert.equal(await repo.getSnapshot('not-configured'), null)
    assert.deepEqual(await repo.listEvents(null, 100), [])
    const tables = database.handle.prepare<[], { name: string }>(`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name LIKE 'element_statistics_%'`).all()
    assert.equal(tables.length, 6)
    for (const { name } of tables) {
      assert.equal(database.handle.prepare<[], { count: number }>(
        `SELECT COUNT(*) AS count FROM "${name}"`).get()?.count, 0, name)
    }
  })

  test('connection identity separates accounts, regions, printers and delimiter-like identities', async () => {
    const { repo } = await fixture()
    const others = [
      connection({ id: 'household-b', accountId: 'account-b' }),
      connection({ id: 'household-china', region: 'china' }),
      connection({ id: 'second-printer', printerId: 'printer-2' }),
      connection({ id: 'delimiter-a', accountId: 'a:b', printerId: 'c' }),
      connection({ id: 'delimiter-b', accountId: 'a', printerId: 'b:c' }),
    ]
    for (const other of others) await repo.saveConnection(other)
    await assert.rejects(repo.saveConnection(connection({ id: 'different-id-same-identity' })), /UNIQUE/)
    for (const changes of [{ accountId: 'account-x' }, { printerId: 'printer-x' }, { region: 'china' as const }]) {
      await assert.rejects(repo.saveConnection(connection(changes)), /identity cannot be reassigned/)
    }
    const renamed = await repo.saveConnection(connection({
      accountName: null, printerName: 'Renamed workshop', printerModel: null,
      createdAt: T1, updatedAt: T2,
    }))
    assert.deepEqual(renamed, connection({ printerName: 'Renamed workshop', updatedAt: T2 }))
    assert.equal((await repo.listConnections()).length, 6)
    for (const target of [connection(), ...others]) {
      await repo.commitPage(target.id, [sparseJob()], T0, sync(target.id))
    }
    assert.equal((await repo.listJobs(null, 20)).length, 6, 'cloud ids are scoped to connection identity')
  })

  test('settings only change the selection; disabling and reconfiguration retain all history', async () => {
    const { repo, database } = await fixture()
    const other = connection({ id: 'household-b', accountId: 'account-b' })
    await repo.saveConnection(other)
    await repo.commitPage('household-a', [completedJob()], T0, sync())
    await repo.recordSnapshot('household-a', snapshot())
    await repo.recordEvent(event())
    await repo.saveSettings({ enabled: true, activeConnectionId: 'household-a', updatedAt: T0 })
    const history = await repo.getJob('household-a', 'cloud-job-1')
    for (const settings of [
      { enabled: false, activeConnectionId: 'household-a', updatedAt: T1 },
      { enabled: false, activeConnectionId: null, updatedAt: T1 },
      { enabled: true, activeConnectionId: 'household-b', updatedAt: T2 },
    ]) {
      await repo.saveSettings(settings)
      assert.deepEqual(await repo.getSettings(), settings)
      assert.deepEqual(await repo.getJob('household-a', 'cloud-job-1'), history)
      assert.deepEqual(await repo.getSyncState('household-a'), sync())
      assert.deepEqual(await repo.getSnapshot('household-a'), snapshot())
      assert.equal((await repo.listEvents('household-a', 10)).length, 1)
      assert.equal((await repo.listConnections()).length, 2)
    }
    assert.deepEqual(database.handle.pragma('foreign_key_check'), [])
    assert.throws(() => database.handle.prepare(
      'DELETE FROM element_statistics_connections WHERE id = ?').run('household-a'), /FOREIGN KEY/)
    assert.throws(() => database.handle.prepare(
      'DELETE FROM element_statistics_connections WHERE id = ?').run('household-b'), /FOREIGN KEY/)
  })

  test('settings, metadata, resume state, jobs, snapshots and events survive closing and reopening', async () => {
    const { repo, database, path } = await fixture()
    const state = sync('household-a', {
      backfillCursor: 'page-4',
      backfillStartedAt: T0,
      backfillPages: 3,
      backfillSeenCursors: ['page-1', 'page-2', 'page-3'],
      refreshCursor: 'refresh-2',
      refreshBoundary: 'job-opaque-boundary',
      refreshSeenCursors: ['refresh-1'],
      lastFullScanAt: T0,
      nextSyncAt: T2,
      consecutiveFailures: 2,
      remoteTotal: 81,
      problem: { code: 'offline', message: 'Cloud history is temporarily unavailable.' },
    })
    const observed = snapshot({
      hms: [{ code: '03008005', attribute: '1' }],
      ams: [{
        amsId: '0', slotId: '1', material: 'PLA', subBrand: 'Basic',
        color: 'FFFFFF', remainingPercent: 80, empty: false,
      }],
    })
    await repo.saveSettings({ enabled: true, activeConnectionId: 'household-a', updatedAt: T0 })
    await repo.commitPage('household-a', [completedJob()], T0, state)
    await repo.recordSnapshot('household-a', observed)
    await repo.recordEvent(event())
    const expectedJob = await repo.getJob('household-a', 'cloud-job-1')
    const expectedEvents = await repo.listEvents(null, 10)
    database.close()

    const reopened = openDatabase({ path, busyTimeoutMs: 2_000, createIfMissing: false })
    try {
      const persisted = createRepositories(reopened).elementStatistics
      assert.equal(reopened.handle.pragma('journal_mode', { simple: true }), 'delete')
      assert.equal(reopened.handle.pragma('foreign_keys', { simple: true }), 1)
      assert.deepEqual(await persisted.getSettings(), {
        enabled: true, activeConnectionId: 'household-a', updatedAt: T0,
      })
      assert.deepEqual(await persisted.listConnections(), [connection()])
      assert.deepEqual(await persisted.getSyncState('household-a'), state)
      assert.deepEqual(await persisted.getJob('household-a', 'cloud-job-1'), expectedJob)
      assert.deepEqual(await persisted.getSnapshot('household-a'), observed,
        'receivedAt and per-field timestamps remain the original observation, not restart time')
      assert.deepEqual(await persisted.listEvents(null, 10), expectedEvents)
      await persisted.recordEvent(event())
      assert.deepEqual(await persisted.listEvents(null, 10), expectedEvents, 'replay remains idempotent after restart')
    } finally {
      reopened.close()
    }
  })

  test('idempotent upserts retain firstSeenAt and update lastSeenAt with controller timestamps', async () => {
    const { repo } = await fixture()
    await repo.commitPage('household-a', [completedJob(), completedJob()], T0, sync())
    await repo.commitPage('household-a', [completedJob({ title: 'Renamed tray' })], T1, sync())
    const result = await repo.getJob('household-a', 'cloud-job-1')
    assert.deepEqual(result, {
      ...completedJob({ title: 'Renamed tray' }), connectionId: 'household-a',
      firstSeenAt: T0, lastSeenAt: T1,
    })
    await repo.commitPage('household-a', [completedJob({ title: 'Stale replay' })], T0, sync())
    assert.deepEqual(await repo.getJob('household-a', 'cloud-job-1'), result)
    assert.equal((await repo.listJobs(null, 10)).length, 1)
  })

  test('a checkpoint failure rolls back both updated and inserted page jobs', async () => {
    const { repo, database } = await fixture()
    const before = sync('household-a', { backfillPages: 1, backfillCursor: 'next' })
    await repo.commitPage('household-a', [completedJob()], T0, before)
    database.handle.exec(`
      CREATE TEMP TRIGGER fail_element_checkpoint BEFORE UPDATE ON element_statistics_sync_state
      WHEN NEW.backfill_pages = 2
      BEGIN SELECT RAISE(ABORT, 'fixture checkpoint failure'); END`)
    await assert.rejects(repo.commitPage('household-a', [
      completedJob({ title: 'Must roll back' }), completedJob({ id: 'new-job' }),
    ], T1, sync('household-a', { backfillPages: 2 })), /fixture checkpoint failure/)
    assert.equal((await repo.getJob('household-a', 'cloud-job-1'))?.title, 'Tool tray')
    assert.equal((await repo.getJob('household-a', 'cloud-job-1'))?.lastSeenAt, T0)
    assert.equal(await repo.getJob('household-a', 'new-job'), null)
    assert.deepEqual(await repo.getSyncState('household-a'), before)
  })

  test('invalid page identities and mismatched checkpoints never cross-associate data', async () => {
    const { repo } = await fixture()
    await repo.saveConnection(connection({ id: 'household-b', accountId: 'account-b' }))
    await assert.rejects(repo.commitPage('household-a', [completedJob()], T0, sync('household-b')),
      /checkpoint belongs to another connection/)
    const wrongConnectionJob = { ...completedJob(), connectionId: 'household-b' }
    await assert.rejects(repo.commitPage('household-a', [wrongConnectionJob], T0, sync()),
      /job belongs to another connection/)
    await assert.rejects(repo.commitPage('household-a', [
      completedJob(), completedJob({ id: ' ' }),
    ], T0, sync()), /Invalid EL-ement identity/)
    await assert.rejects(repo.commitPage('household-a', [completedJob()], T0,
      sync('household-a', { backfillPages: -1 })), /Invalid EL-ement count/)
    await assert.rejects(repo.commitPage('missing', [], T0, sync('missing')), /FOREIGN KEY/)
    assert.deepEqual(await repo.listJobs(null, 10), [])
    assert.deepEqual(await repo.getSyncState('household-a'), emptyElementSyncState('household-a'))
    assert.deepEqual(await repo.getSyncState('household-b'), emptyElementSyncState('household-b'))
  })

  test('reportedFields preserves omitted facts, treats zero as reported, and never reaches stored jobs', async () => {
    const { repo } = await fixture()
    await repo.commitPage('household-a', [completedJob()], T0, sync())
    await repo.commitPage('household-a', [sparseJob({
      reportedFields: ['estimatedWeightGrams'], estimatedWeightGrams: 0,
    })], T1, sync())
    const expected = {
      ...completedJob({ estimatedWeightGrams: 0 }),
      connectionId: 'household-a', firstSeenAt: T0, lastSeenAt: T1,
    }
    assert.deepEqual(await repo.getJob('household-a', 'cloud-job-1'), expected)
    await repo.commitPage('household-a', [completedJob({
      reportedFields: [], title: 'Not reported', result: 'active', estimatedWeightGrams: 99,
    })], T2, sync())
    const job = await repo.getJob('household-a', 'cloud-job-1')
    assert.deepEqual(job, { ...expected, lastSeenAt: T2 })
    assert.equal(Object.hasOwn(job!, 'reportedFields'), false)

    await repo.commitPage('household-a', [completedJob({
      id: 'partial-insert', reportedFields: ['title'], title: 'Only the title was reported',
    })], T2, sync())
    assert.deepEqual(await repo.getJob('household-a', 'partial-insert'), {
      ...sparseJob({ id: 'partial-insert', title: 'Only the title was reported' }),
      connectionId: 'household-a', firstSeenAt: T2, lastSeenAt: T2,
    })
  })

  test('explicit null and invalid reported scalars clear known values instead of reviving old estimates', async () => {
    const { repo } = await fixture()
    await repo.commitPage('household-a', [completedJob()], T0, sync())
    await repo.commitPage('household-a', [sparseJob({
      reportedFields: [
        'title', 'estimatedDurationSeconds', 'estimatedWeightGrams', 'estimatedLength', 'lengthUnit',
      ],
      title: null,
      estimatedDurationSeconds: null,
      estimatedWeightGrams: -1,
      estimatedLength: Infinity,
      lengthUnit: null,
    })], T1, sync())
    assert.deepEqual(await repo.getJob('household-a', 'cloud-job-1'), {
      ...completedJob({
        title: null, estimatedDurationSeconds: null, estimatedWeightGrams: null,
        estimatedLength: null, lengthUnit: null,
      }),
      connectionId: 'household-a', firstSeenAt: T0, lastSeenAt: T1,
    })
  })

  test('absent reportedFields means a full normalized replacement, including every null and empty array', async () => {
    const { repo } = await fixture()
    await repo.commitPage('household-a', [completedJob()], T0, sync())
    await repo.commitPage('household-a', [sparseJob()], T1, sync())
    assert.deepEqual(await repo.getJob('household-a', 'cloud-job-1'), {
      ...sparseJob(), connectionId: 'household-a', firstSeenAt: T0, lastSeenAt: T1,
    })
  })

  test('reported material arrays replace null members and empty arrays, while omitted arrays survive', async () => {
    const { repo } = await fixture()
    await repo.commitPage('household-a', [completedJob()], T0, sync())
    const material = { ...completedJob().materials[0], material: null, estimatedWeightGrams: null }
    await repo.commitPage('household-a', [sparseJob({
      reportedFields: ['materials'], materials: [material],
    })], T1, sync())
    assert.deepEqual((await repo.getJob('household-a', 'cloud-job-1'))?.materials, [material])
    assert.deepEqual((await repo.getJob('household-a', 'cloud-job-1'))?.warnings, completedJob().warnings)
    await repo.commitPage('household-a', [sparseJob({ reportedFields: ['warnings'] })], T2, sync())
    assert.deepEqual((await repo.getJob('household-a', 'cloud-job-1'))?.warnings, [])
    assert.deepEqual((await repo.getJob('household-a', 'cloud-job-1'))?.materials, [material])
    await repo.commitPage('household-a', [sparseJob({ reportedFields: ['materials'] })], T2, sync())
    assert.deepEqual((await repo.getJob('household-a', 'cloud-job-1'))?.materials, [])
  })

  test('invalid ingestion metadata rolls back a page and never becomes persisted payload', async () => {
    const { repo } = await fixture()
    const invalid = sparseJob({ id: 'invalid-metadata' })
    Reflect.set(invalid, 'reportedFields', ['rawCloudPayload'])
    await assert.rejects(repo.commitPage('household-a', [completedJob(), invalid], T0, sync()),
      /Invalid EL-ement reported job field/)
    assert.deepEqual(await repo.listJobs(null, 10), [])
    assert.deepEqual(await repo.getSyncState('household-a'), emptyElementSyncState('household-a'))
  })

  test('same-result terminal observations invalidate stale completion facts and clear resolved warnings/materials', async () => {
    const { repo } = await fixture()
    await repo.commitPage('household-a', [completedJob()], T0, sync())
    await repo.commitPage('household-a', [completedJob({
      endedAt: null, actualDurationSeconds: null, warnings: ['End time is ambiguous.'],
    })], T1, sync())
    const unavailable = await repo.getJob('household-a', 'cloud-job-1')
    assert.equal(unavailable?.result, 'completed')
    assert.equal(unavailable?.endedAt, null)
    assert.equal(unavailable?.actualDurationSeconds, null)
    assert.deepEqual(unavailable?.warnings, ['End time is ambiguous.'])
    await repo.commitPage('household-a', [completedJob({
      warnings: [], materials: [],
    })], T2, sync())
    const resolved = await repo.getJob('household-a', 'cloud-job-1')
    assert.equal(resolved?.actualDurationSeconds, 3_600)
    assert.equal(resolved?.endedAt, completedJob().endedAt)
    assert.deepEqual(resolved?.warnings, [])
    assert.deepEqual(resolved?.materials, [])
    assert.equal(resolved?.firstSeenAt, T0)
  })

  test('same-state sparse invalid timelines never borrow a previously valid duration', async () => {
    const { repo } = await fixture()
    const cases: { name: string; update: Partial<ElementJobInput> }[] = [
      { name: 'unavailable-start', update: { reportedFields: ['startedAt'], startedAt: null } },
      { name: 'unavailable-end', update: { reportedFields: ['endedAt'], endedAt: null } },
      { name: 'future-start', update: {
        reportedFields: ['startedAt'], startedAt: '2026-09-16T10:00:00.000Z',
      } },
      { name: 'future-end', update: {
        reportedFields: ['endedAt'], endedAt: '2026-09-16T11:00:00.000Z',
      } },
      { name: 'inverted', update: {
        reportedFields: ['endedAt'], endedAt: '2026-09-01T09:59:59.000Z',
      } },
      { name: 'zero-interval', update: {
        reportedFields: ['endedAt'], endedAt: '2026-09-01T10:00:00.000Z',
      } },
      { name: 'short-placeholder', update: {
        reportedFields: ['endedAt'], endedAt: '2026-09-01T10:00:30.000Z',
      } },
      { name: 'sixty-second-placeholder', update: {
        reportedFields: ['endedAt'], endedAt: '2026-09-01T10:01:00.000Z',
      } },
    ]
    for (const { name, update } of cases) {
      await repo.commitPage('household-a', [completedJob({ id: name })], T0, sync())
      await repo.commitPage('household-a', [sparseJob({
        id: name, actualDurationSeconds: 9_999_999, ...update,
      })], T1, sync())
      const job = await repo.getJob('household-a', name)
      assert.equal(job?.result, 'completed', name)
      assert.equal(job?.actualDurationSeconds, null, name)
      assert.equal(job?.firstSeenAt, T0, name)
      assert.equal(job?.lastSeenAt, T1, name)
    }
  })

  test('sparse timeline fields merge before elapsed time is recomputed, never trusting supplied duration', async () => {
    const { repo } = await fixture()
    await repo.commitPage('household-a', [completedJob({
      endedAt: null, actualDurationSeconds: 9_999_999,
    })], T0, sync())
    assert.equal((await repo.getJob('household-a', 'cloud-job-1'))?.actualDurationSeconds, null)
    await repo.commitPage('household-a', [sparseJob({
      reportedFields: ['endedAt'], endedAt: completedJob().endedAt,
    })], T1, sync())
    let job = await repo.getJob('household-a', 'cloud-job-1')
    assert.equal(job?.result, 'completed')
    assert.equal(job?.startedAt, completedJob().startedAt)
    assert.equal(job?.actualDurationSeconds, 3_600)
    await repo.commitPage('household-a', [sparseJob({
      reportedFields: ['startedAt', 'actualDurationSeconds'],
      startedAt: '2026-09-01T10:30:00.000Z', actualDurationSeconds: 9_999_999,
    })], T2, sync())
    job = await repo.getJob('household-a', 'cloud-job-1')
    assert.equal(job?.endedAt, completedJob().endedAt)
    assert.equal(job?.actualDurationSeconds, 1_800)
    await repo.commitPage('household-a', [sparseJob({
      reportedFields: ['startedAt', 'endedAt', 'actualDurationSeconds'],
      startedAt: '2026-09-01T10:00:00.000Z', endedAt: '2026-09-01T10:01:01.000Z',
      actualDurationSeconds: null,
    })], T2, sync())
    job = await repo.getJob('household-a', 'cloud-job-1')
    assert.equal(job?.actualDurationSeconds, 61)
    assert.equal(job?.firstSeenAt, T0)
  })

  test('an explicitly unrecognized raw status replaces a previous known state without stale completion facts', async () => {
    const { repo } = await fixture()
    await repo.commitPage('household-a', [completedJob()], T0, sync())
    await repo.commitPage('household-a', [sparseJob({
      reportedFields: ['result', 'rawStatus'],
      rawStatus: 'VENDOR_FUTURE_STATE',
    })], T1, sync())
    const unknown = await repo.getJob('household-a', 'cloud-job-1')
    assert.equal(unknown?.result, 'unknown')
    assert.equal(unknown?.rawStatus, 'VENDOR_FUTURE_STATE')
    assert.equal(unknown?.actualDurationSeconds, null)
    assert.equal(unknown?.endedAt, completedJob().endedAt)
    assert.equal(unknown?.estimatedDurationSeconds, 4_200)
    await repo.commitPage('household-a', [sparseJob({ reportedFields: [] })], T2, sync())
    assert.equal((await repo.getJob('household-a', 'cloud-job-1'))?.rawStatus, 'VENDOR_FUTURE_STATE')
    assert.equal((await repo.getJob('household-a', 'cloud-job-1'))?.result, 'unknown')
    await repo.commitPage('household-a', [sparseJob({
      reportedFields: ['result', 'rawStatus'],
    })], T2, sync())
    assert.equal((await repo.getJob('household-a', 'cloud-job-1'))?.rawStatus, null)
    assert.equal((await repo.getJob('household-a', 'cloud-job-1'))?.actualDurationSeconds, null)
  })

  test('sync checkpoints clear nullable fields explicitly and persist completion without invented dates', async () => {
    const { repo } = await fixture()
    await repo.saveSyncState(sync('household-a', {
      backfillCursor: 'page-2', refreshCursor: 'refresh-2', refreshBoundary: 'job-boundary',
      problem: { code: 'unavailable', message: 'History is unavailable.' }, consecutiveFailures: 1,
    }))
    const completed = sync('household-a', {
      backfillComplete: true, backfillCompletedAt: T1, backfillPages: 2,
      backfillCursor: null, refreshCursor: null, refreshBoundary: null,
      remoteTotal: 0, problem: null, nextSyncAt: null,
    })
    await repo.saveSyncState(completed)
    assert.deepEqual(await repo.getSyncState('household-a'), completed)
    assert.equal((await repo.getSyncState('household-a')).backfillStartedAt, null)
  })

  test('explicit result transitions clear stale completion data rather than fabricating active completion', async () => {
    const { repo } = await fixture()
    await repo.commitPage('household-a', [completedJob()], T0, sync())
    await repo.commitPage('household-a', [completedJob({ result: 'active', rawStatus: 'running' })], T1, sync())
    let job = await repo.getJob('household-a', 'cloud-job-1')
    assert.equal(job?.result, 'active')
    assert.equal(job?.endedAt, null)
    assert.equal(job?.actualDurationSeconds, null)
    await repo.commitPage('household-a', [sparseJob({ reportedFields: [] })], T2, sync())
    assert.equal((await repo.getJob('household-a', 'cloud-job-1'))?.result, 'active')
    await repo.commitPage('household-a', [sparseJob({
      reportedFields: ['result', 'rawStatus'], result: 'failed_or_aborted',
    })], T2, sync())
    job = await repo.getJob('household-a', 'cloud-job-1')
    assert.equal(job?.result, 'failed_or_aborted')
    assert.equal(job?.endedAt, null)
    assert.equal(job?.actualDurationSeconds, null)
    assert.equal(job?.rawStatus, null)
    assert.equal(job?.estimatedDurationSeconds, 4_200)

    await repo.commitPage('household-a', [completedJob({ id: 'terminal-change' })], T0, sync())
    await repo.commitPage('household-a', [sparseJob({
      id: 'terminal-change', result: 'failed_or_aborted',
    })], T1, sync())
    assert.equal((await repo.getJob('household-a', 'terminal-change'))?.actualDurationSeconds, null)
    assert.equal((await repo.getJob('household-a', 'terminal-change'))?.endedAt, null)
    await repo.commitPage('household-a', [sparseJob({ id: 'unreported' })], T0, sync())
    assert.equal((await repo.getJob('household-a', 'unreported'))?.result, 'unknown')
  })

  test('reported length and unit changes preserve only omitted facts and keep normalized unit invariants', async () => {
    const { repo } = await fixture()
    await repo.commitPage('household-a', [completedJob()], T0, sync())
    await repo.commitPage('household-a', [sparseJob({
      reportedFields: ['estimatedLength', 'lengthUnit'], estimatedLength: 21,
    })], T1, sync())
    assert.equal((await repo.getJob('household-a', 'cloud-job-1'))?.estimatedLength, 21)
    assert.equal((await repo.getJob('household-a', 'cloud-job-1'))?.lengthUnit, null)
    await repo.commitPage('household-a', [sparseJob({
      reportedFields: ['lengthUnit'], lengthUnit: 'm',
    })], T2, sync())
    assert.equal((await repo.getJob('household-a', 'cloud-job-1'))?.estimatedLength, 21)
    assert.equal((await repo.getJob('household-a', 'cloud-job-1'))?.lengthUnit, 'm')
    await repo.commitPage('household-a', [sparseJob({
      reportedFields: ['estimatedLength'], estimatedLength: null,
    })], T2, sync())
    assert.equal((await repo.getJob('household-a', 'cloud-job-1'))?.estimatedLength, null)
    assert.equal((await repo.getJob('household-a', 'cloud-job-1'))?.lengthUnit, null)
    await repo.commitPage('household-a', [sparseJob({
      reportedFields: ['estimatedLength', 'lengthUnit'], estimatedLength: 0, lengthUnit: 'm',
    })], T2, sync())
    assert.equal((await repo.getJob('household-a', 'cloud-job-1'))?.estimatedLength, 0)
    assert.equal((await repo.getJob('household-a', 'cloud-job-1'))?.lengthUnit, 'm')
  })

  test('coverage reports historical starts, recording bounds, undated rows and each connection checkpoint', async () => {
    const { repo } = await fixture()
    const other = connection({ id: 'empty', accountId: 'account-empty', createdAt: T1 })
    await repo.saveConnection(other)
    const state = sync('household-a', { backfillComplete: true, backfillCompletedAt: T2, remoteTotal: 3 })
    await repo.commitPage('household-a', [
      completedJob({ id: 'early', startedAt: '2020-01-01T05:00:00+05:00' }),
      completedJob({ id: 'late', startedAt: '2026-08-10T15:00:00-04:00' }),
      sparseJob({ id: 'undated' }),
    ], T0, sync())
    await repo.commitPage('household-a', [sparseJob({ id: 'late', reportedFields: [] })], T2, state)
    assert.deepEqual(await repo.coverage(), [{
      connectionId: 'household-a', jobCount: 3,
      earliestJobAt: '2020-01-01T00:00:00.000Z', latestJobAt: '2026-08-10T19:00:00.000Z',
      firstRecordedAt: T0, lastRecordedAt: T2, undatedJobs: 1, sync: state,
    }, {
      connectionId: 'empty', jobCount: 0, earliestJobAt: null, latestJobAt: null,
      firstRecordedAt: null, lastRecordedAt: null, undatedJobs: 0, sync: emptyElementSyncState('empty'),
    }])
  })

  test('listJobs honors explicit limit+1 without a hidden cap and uses deterministic ordering', async () => {
    const { repo } = await fixture()
    const jobs = Array.from({ length: 1_105 }, (_, index) => sparseJob({
      id: `job-${String(index).padStart(4, '0')}`, startedAt: T0,
    })).reverse()
    await repo.commitPage('household-a', jobs, T1, sync())
    const items = await repo.listJobs(null, 1_001)
    assert.equal(items.length, 1_001)
    assert.equal(items[0].id, 'job-0000')
    assert.equal(items.at(-1)?.id, 'job-1000')
    assert.deepEqual(await repo.listJobs('household-a', 1_001), items)
    assert.equal((await repo.listJobs(null, 1_106)).length, 1_105)
    assert.equal((await repo.listJobs('missing', 10)).length, 0)
    await repo.commitPage('household-a', [sparseJob({ id: 'undated' })], T1, sync())
    assert.equal((await repo.listJobs(null, 2_000)).at(-1)?.id, 'undated')
    for (const bad of [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(repo.listJobs(null, bad), RangeError)
      await assert.rejects(repo.listEvents(null, bad), RangeError)
    }
  })

  test('listJobs applies optional half-open UTC bounds before limiting without changing the ledger', async () => {
    const { repo, database } = await fixture()
    await repo.saveConnection(connection({ id: 'household-b', accountId: 'account-b' }))
    await repo.commitPage('household-a', [
      sparseJob({ id: 'before', startedAt: '2026-09-15T09:59:59.999Z' }),
      sparseJob({ id: 'inclusive', startedAt: T0 }),
      sparseJob({ id: 'middle', startedAt: '2026-09-15T10:00:30.000Z' }),
      sparseJob({ id: 'exclusive', startedAt: T1 }),
      sparseJob({ id: 'after', startedAt: T2 }),
      sparseJob({ id: 'undated' }),
    ], T2, sync())
    await repo.commitPage('household-b', [
      sparseJob({ id: 'other-inclusive', startedAt: T0 }),
      sparseJob({ id: 'other-after', startedAt: T2 }),
    ], T2, sync('household-b'))
    const before = canonicalTableHashFromDatabase(database.handle, 'element_statistics_jobs')
    const bounds = { fromInclusive: T0, toExclusive: T1 }
    assert.deepEqual((await repo.listJobs(null, 10, bounds)).map((job) => job.id),
      ['middle', 'inclusive', 'other-inclusive'])
    assert.deepEqual((await repo.listJobs('household-a', 2, bounds)).map((job) => job.id),
      ['middle', 'inclusive'])
    assert.equal((await repo.listJobs('household-a', 1, bounds))[0]?.id, 'middle',
      'newer out-of-range rows must not consume the limit before filtering')
    assert.deepEqual((await repo.listJobs('household-a', 10, { fromInclusive: T1 })).map((job) => job.id),
      ['after', 'exclusive'])
    assert.deepEqual((await repo.listJobs('household-a', 10, { toExclusive: T0 })).map((job) => job.id),
      ['before'])
    assert.deepEqual(await repo.listJobs(null, 10, {
      fromInclusive: '2026-09-15T06:00:00-04:00',
      toExclusive: '2026-09-15T06:01:00-04:00',
    }), await repo.listJobs(null, 10, bounds))
    assert.deepEqual(await repo.listJobs(null, 10, {}), await repo.listJobs(null, 10))
    assert.equal((await repo.listJobs(null, 10)).at(-1)?.id, 'undated')
    assert.deepEqual(await repo.listJobs(null, 10, { fromInclusive: T0, toExclusive: T0 }), [])
    await assert.rejects(repo.listJobs(null, 10, { fromInclusive: 'invalid' }), /timestamp/)
    await assert.rejects(repo.listJobs(null, 10, { toExclusive: 'invalid' }), /timestamp/)
    assert.deepEqual(canonicalTableHashFromDatabase(database.handle, 'element_statistics_jobs'), before)
  })

  test('telemetry coalesces by connection and UTC minute without reviving an older observation', async () => {
    const { repo, database } = await fixture()
    await repo.recordSnapshot('household-a', snapshot())
    const later = snapshot({
      receivedAt: '2026-09-15T06:00:50-04:00', progressPercent: 30, hms: [], ams: [],
      fieldUpdatedAt: { state: T0, progressPercent: '2026-09-15T10:00:50.000Z' },
    })
    await repo.recordSnapshot('household-a', later)
    await repo.recordSnapshot('household-a', snapshot({ receivedAt: '2026-09-15T10:00:10.000Z' }))
    assert.deepEqual(await repo.getSnapshot('household-a'), {
      ...later, receivedAt: '2026-09-15T10:00:50.000Z',
    })
    await repo.recordSnapshot('household-a', snapshot({ receivedAt: T1, hms: null, ams: null }))
    assert.equal((await repo.getSnapshot('household-a'))?.receivedAt, T1)
    assert.equal((await repo.getSnapshot('household-a'))?.hms, null)
    await repo.saveConnection(connection({ id: 'other', accountId: 'other' }))
    await repo.recordSnapshot('other', snapshot())
    assert.equal(database.handle.prepare<[], { count: number }>(
      'SELECT COUNT(*) AS count FROM element_statistics_telemetry').get()?.count, 3)
  })

  test('telemetry retention is exclusive and never prunes jobs, events, identities or checkpoints', async () => {
    const { repo, database } = await fixture()
    await repo.commitPage('household-a', [completedJob()], T0, sync())
    await repo.recordEvent(event({ occurredAt: '2020-01-01T00:00:00.000Z' }))
    await repo.recordSnapshot('household-a', snapshot())
    await repo.recordSnapshot('household-a', snapshot({ receivedAt: T1 }))
    await repo.recordSnapshot('household-a', snapshot({ receivedAt: T2 }))
    await repo.saveSettings({ enabled: false, activeConnectionId: null, updatedAt: T2 })
    const tables = ['connections', 'settings', 'sync_state', 'jobs', 'events']
      .map((suffix) => `element_statistics_${suffix}`)
    const before = tables.map((table) => canonicalTableHashFromDatabase(database.handle, table))
    await repo.pruneTelemetry(T1)
    assert.deepEqual(database.handle.prepare<[], { received_at: string }>(
      'SELECT received_at FROM element_statistics_telemetry ORDER BY received_at').all(),
    [{ received_at: T1 }, { received_at: T2 }])
    assert.deepEqual(tables.map((table) => canonicalTableHashFromDatabase(database.handle, table)), before)
    await repo.pruneTelemetry('2030-01-01T00:00:00.000Z')
    assert.equal(await repo.getSnapshot('household-a'), null)
    assert.deepEqual(tables.map((table) => canonicalTableHashFromDatabase(database.handle, table)), before)
  })

  test('event replay coalesces but preserves transitions, recurring errors and connection/job scope', async () => {
    const { repo } = await fixture()
    await repo.recordEvent(event())
    await repo.recordEvent(event())
    await repo.recordEvent(event({ occurredAt: '2026-09-15T10:00:05.000Z' }))
    assert.equal((await repo.listEvents(null, 20)).length, 1)
    await repo.recordEvent(event({
      occurredAt: '2026-09-15T10:00:10.000Z', kind: 'printer_error',
      code: 'FILAMENT', message: 'Filament needs attention.',
    }))
    await repo.recordEvent(event({ occurredAt: '2026-09-15T10:00:20.000Z' }))
    await repo.recordEvent(event({ occurredAt: T1 }))
    await repo.recordEvent(event())
    const historical = await repo.listEvents('household-a', 20)
    assert.equal(historical.length, 4)
    assert.deepEqual(historical.map((item) => item.occurredAt), [
      T1, '2026-09-15T10:00:20.000Z', '2026-09-15T10:00:10.000Z', T0,
    ])
    await repo.saveConnection(connection({ id: 'other', accountId: 'other' }))
    await repo.recordEvent(event({ connectionId: 'other' }))
    await repo.recordEvent(event({ occurredAt: T2, jobId: 'second-job', code: 'FINISH' }))
    assert.equal((await repo.listEvents(null, 20)).length, 6)
    assert.equal((await repo.listEvents('household-a', 20, 'cloud-job-1')).length, 4)
    assert.equal((await repo.listEvents('household-a', 20, 'second-job')).length, 1)
    assert.equal((await repo.listEvents('other', 20, 'cloud-job-1')).length, 1)
    assert.deepEqual(await repo.listEvents(null, 20), await repo.listEvents(null, 20))
    assert.equal((await repo.listEvents(null, 2)).length, 2)
  })

  test('foreign keys and validation refuse orphaned, malformed or reassigned identities', async () => {
    const { repo } = await fixture()
    await assert.rejects(repo.saveSettings({
      enabled: true, activeConnectionId: 'missing', updatedAt: T0,
    }), /FOREIGN KEY/)
    await assert.rejects(repo.saveSyncState(sync('missing')), /FOREIGN KEY/)
    await assert.rejects(repo.recordSnapshot('missing', snapshot()), /FOREIGN KEY/)
    await assert.rejects(repo.recordEvent(event({ connectionId: 'missing' })), /FOREIGN KEY/)
    for (const bad of ['', ' ', ' x', 'x ', 'x\u0000y', 'x'.repeat(513)]) {
      await assert.rejects(repo.saveConnection(connection({ id: bad })), /identity/)
      await assert.rejects(repo.commitPage('household-a', [sparseJob({ id: bad })], T0, sync()), /identity/)
    }
    await assert.rejects(repo.commitPage('household-a', [completedJob()], 'not-a-time', sync()), /timestamp/)
    await assert.rejects(repo.saveSyncState(sync('household-a', {
      backfillCursor: 'x'.repeat(2_049),
    })), /history cursor/)
    await assert.rejects(repo.saveSyncState(sync('household-a', {
      backfillSeenCursors: Array.from({ length: 4_097 }, () => 'x'),
    })), /normalized list/)
    assert.deepEqual(await repo.listJobs(null, 10), [])
    assert.deepEqual(await repo.getSettings(), { enabled: false, activeConnectionId: null, updatedAt: null })
  })

  test('only public normalized fields can reach SQLite, including nested arrays and timestamp metadata', async () => {
    const { repo, database, path } = await fixture(false)
    const sentinel = 'RAW_PRIVATE_FIXTURE_MUST_NEVER_BE_PERSISTED'
    const contaminatedConnection = { ...connection(), password: sentinel, accessCode: sentinel }
    await repo.saveConnection(contaminatedConnection)
    const settings = {
      enabled: true, activeConnectionId: 'household-a', updatedAt: T0, accessToken: sentinel,
    }
    await repo.saveSettings(settings)
    const material = { ...completedJob().materials[0], secret: sentinel, rawPayload: { sentinel } }
    const job = { ...completedJob(), materials: [material], rawCloudPayload: { sentinel } }
    const state = {
      ...sync(), credential: sentinel,
      problem: { code: 'offline', message: 'Cloud unavailable.', rawError: { sentinel } },
    }
    await repo.commitPage('household-a', [job], T0, state)
    const observed = {
      ...snapshot(), accessCode: sentinel,
      hms: [{ code: '03008005', attribute: null, raw: { sentinel } }],
      ams: [{
        amsId: '0', slotId: '1', material: 'PLA', subBrand: null,
        color: 'FFFFFF', remainingPercent: 50, empty: false, password: sentinel,
      }],
      fieldUpdatedAt: { state: T0, accessToken: sentinel, rawPayload: sentinel },
    }
    await repo.recordSnapshot('household-a', observed)
    const recorded = { ...event(), rawCloudPayload: { sentinel } }
    await repo.recordEvent(recorded)
    const tables = database.handle.prepare<[], { name: string }>(`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name LIKE 'element_statistics_%'`).all()
    for (const { name } of tables) {
      const content = JSON.stringify(database.handle.prepare(`SELECT * FROM "${name}"`).all())
      assert.equal(content.includes(sentinel), false, name)
      assert.equal(/rawCloudPayload|rawPayload|accessToken|accessCode|password|credential/.test(content), false, name)
    }
    assert.equal(readFileSync(path).includes(Buffer.from(sentinel)), false)
    assert.deepEqual((await repo.getSnapshot('household-a'))?.fieldUpdatedAt, { state: T0 })
    assert.deepEqual((await repo.getJob('household-a', 'cloud-job-1'))?.materials, completedJob().materials)
    const malformed = sparseJob({ id: 'coercion', estimatedWeightGrams: Infinity, estimatedLength: NaN })
    Reflect.set(malformed, 'title', { toString: () => sentinel })
    await repo.commitPage('household-a', [malformed], T0, sync())
    const clean = await repo.getJob('household-a', 'coercion')
    assert.equal(clean?.title, null)
    assert.equal(clean?.estimatedWeightGrams, null)
    assert.equal(clean?.estimatedLength, null)
    assert.equal(readFileSync(path).includes(Buffer.from(sentinel)), false)
  })
})
