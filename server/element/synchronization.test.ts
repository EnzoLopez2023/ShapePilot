import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createTempDatabase } from '../../test/helpers/server.ts'
import type { TempDatabase } from '../../test/helpers/server.ts'
import {
  ELEMENT_TEST_NOW, syntheticElementAccount, syntheticElementConnection, syntheticElementJob,
} from '../../test/fixtures/elementStatistics.ts'
import { emptyElementSyncState } from '../../lib/db/repositories/elementStatisticsContract.ts'
import type { ElementHistoryPage } from '../../lib/contracts/elementStatistics.ts'
import { BambuProviderError } from './provider.ts'
import type { BambuProvider } from './provider.ts'
import { synchronizeHistory, HISTORY_PAGE_SIZE, HISTORY_PAGES_PER_PASS } from './synchronization.ts'

let temp: TempDatabase
let now: number
const connectionId = syntheticElementConnection.id

function providerWith(history: BambuProvider['history']): BambuProvider {
  return {
    expiresAt: null, history,
    discover: async () => syntheticElementAccount,
    subscribe: async () => ({ close: async () => {} }),
    close: async () => {},
  }
}

const sync = (provider: BambuProvider) => synchronizeHistory({
  repository: temp.repos.elementStatistics, provider, connectionId,
  printerId: syntheticElementConnection.printerId,
  signal: new AbortController().signal, now: () => now,
})

beforeEach(async () => {
  temp = createTempDatabase('element-sync')
  now = Date.parse(ELEMENT_TEST_NOW)
  await temp.repos.elementStatistics.saveConnection(syntheticElementConnection)
})
afterEach(() => temp.cleanup())

describe('durable bounded history synchronization', () => {
  test('backfills four pages per pass, rechecks the head and resumes without duplicates', async () => {
    // One job per page, newest first, addressed by offset as Bambu pages.
    const history = vi.fn(async (_printer: string, cursor: string | null, limit: number): Promise<ElementHistoryPage> => {
      expect(limit).toBe(HISTORY_PAGE_SIZE)
      const offset = cursor === null ? 0 : Number(cursor)
      return {
        jobs: [syntheticElementJob({ id: String(1000 - offset) })],
        nextCursor: offset + 1 < 9 ? String(offset + 1) : null, total: 9,
      }
    })
    const provider = providerWith(history)
    let state = await sync(provider)
    expect(history).toHaveBeenCalledTimes(HISTORY_PAGES_PER_PASS)
    expect(state.backfillCursor).toBe('4')
    expect(state.backfillComplete).toBe(false)
    now += 300_000
    state = await sync(provider)
    expect(history).toHaveBeenCalledTimes(9)
    expect(state.backfillCursor).toBe('8')
    expect((await temp.repos.elementStatistics.listJobs(connectionId, 100)).length).toBe(8)
    now += 300_000
    state = await sync(provider)
    expect(state.backfillComplete).toBe(true)
    expect(state.backfillPages).toBe(9)
    expect((await temp.repos.elementStatistics.listJobs(connectionId, 100)).length).toBe(9)
    expect((await temp.repos.elementStatistics.getJob(connectionId, '1000'))?.firstSeenAt).toBe(ELEMENT_TEST_NOW)
    expect(state.lastFullScanAt).toBe(new Date(now).toISOString())
  })

  test('a failed later page retains the committed page and resumes its checkpoint', async () => {
    let fail = true
    const history = vi.fn(async (_printer: string, cursor: string | null): Promise<ElementHistoryPage> => {
      if (cursor === '1' && fail) throw new BambuProviderError('provider_error')
      return cursor === null
        ? { jobs: [syntheticElementJob({ id: '100' })], nextCursor: '1', total: 2 }
        : { jobs: [syntheticElementJob({ id: '99' })], nextCursor: null, total: 2 }
    })
    await expect(sync(providerWith(history))).rejects.toBeInstanceOf(BambuProviderError)
    const checkpoint = await temp.repos.elementStatistics.getSyncState(connectionId)
    expect(checkpoint.backfillCursor).toBe('1')
    expect(checkpoint.lastSuccessAt).toBeNull()
    expect(await temp.repos.elementStatistics.getJob(connectionId, '100')).not.toBeNull()
    fail = false
    await sync(providerWith(history))
    expect((await temp.repos.elementStatistics.listJobs(connectionId, 10)).length).toBe(2)
    expect((await temp.repos.elementStatistics.getSyncState(connectionId)).backfillComplete).toBe(true)
  })

  // Production, 2026-09-16: Bambu ignored the page parameter and served the
  // newest page for every request. That must fail loudly, not loop or skip.
  test('detects a provider that serves the same page whatever the offset', async () => {
    const history = vi.fn(async (): Promise<ElementHistoryPage> => ({
      jobs: [syntheticElementJob({ id: '101' }), syntheticElementJob({ id: '100' })],
      nextCursor: '2', total: 4,
    }))
    await expect(sync(providerWith(history))).rejects.toMatchObject({ code: 'history_replayed' })
    expect((await temp.repos.elementStatistics.getSyncState(connectionId)).backfillCursor).toBe('2')
    expect((await temp.repos.elementStatistics.listJobs(connectionId, 10)).length).toBe(2)
  })

  test('recovers a backfill stuck on a task-ID cursor saved before offsets', async () => {
    await temp.repos.elementStatistics.saveSyncState({
      ...emptyElementSyncState(connectionId),
      backfillCursor: '1220177551', backfillPages: 1,
      backfillSeenCursors: ['page:old', 'cursor:1220177551'],
      consecutiveFailures: 18,
    })
    const jobs = ['1255374033', '1244482609', '1220177551', '1219600163']
    const history = vi.fn(async (_printer: string, cursor: string | null): Promise<ElementHistoryPage> => {
      expect(cursor === null || /^\d{1,7}$/.test(cursor)).toBe(true)
      const offset = cursor === null ? 0 : Number(cursor)
      const slice = jobs.slice(offset, offset + 2)
      return {
        jobs: slice.map(id => syntheticElementJob({ id })),
        nextCursor: offset + 2 < jobs.length ? String(offset + 2) : null, total: jobs.length,
      }
    })
    const state = await sync(providerWith(history))
    expect(state.backfillComplete).toBe(true)
    expect(state.consecutiveFailures).toBe(0)
    expect(state.problem).toBeNull()
    // The oldest print, beyond the old cursor, is finally recorded.
    expect(await temp.repos.elementStatistics.getJob(connectionId, '1219600163')).not.toBeNull()
    expect((await temp.repos.elementStatistics.listJobs(connectionId, 10)).length).toBe(4)
  })

  test('detects replayed pages across a persisted checkpoint without advancing it', async () => {
    const history = vi.fn(async (_printer: string, cursor: string | null): Promise<ElementHistoryPage> => ({
      jobs: [syntheticElementJob({ id: '100' })], nextCursor: cursor === null ? '1' : '1', total: 3,
    }))
    await expect(sync(providerWith(history))).rejects.toMatchObject({ code: 'history_replayed' })
    expect((await temp.repos.elementStatistics.getSyncState(connectionId)).backfillCursor).toBe('1')
    await expect(sync(providerWith(history))).rejects.toMatchObject({ code: 'history_replayed' })
    expect((await temp.repos.elementStatistics.listJobs(connectionId, 10)).length).toBe(1)
  })

  test('rejects an offset that does not advance and malformed empty continuation', async () => {
    await temp.repos.elementStatistics.saveSyncState({
      ...emptyElementSyncState(connectionId), backfillCursor: '100',
    })
    await expect(sync(providerWith(async (_printer, cursor) => cursor === null
      ? { jobs: [], nextCursor: null, total: 200 }
      : { jobs: [syntheticElementJob({ id: '101' })], nextCursor: '100', total: 200 })))
      .rejects.toMatchObject({ code: 'history_replayed' })
    await expect(sync(providerWith(async () => ({ jobs: [], nextCursor: '50', total: 2 }))))
      .rejects.toMatchObject({ code: 'history_replayed' })
  })

  test.each(['active', 'unknown'] as const)('rechecks %s jobs older than seven days before ending a recent refresh', async result => {
    const state = {
      ...emptyElementSyncState(connectionId), backfillComplete: true,
      lastFullScanAt: ELEMENT_TEST_NOW, backfillCompletedAt: ELEMENT_TEST_NOW,
    }
    await temp.repos.elementStatistics.commitPage(connectionId, [
      syntheticElementJob({
        id: '100', startedAt: '2026-07-01T00:00:00.000Z', endedAt: null,
        result, rawStatus: '1', actualDurationSeconds: null,
      }),
    ], ELEMENT_TEST_NOW, state)
    const history = vi.fn(async (_printer: string, cursor: string | null): Promise<ElementHistoryPage> => {
      if (cursor === null) return { jobs: [syntheticElementJob({ id: '300' })], nextCursor: '1', total: 3 }
      if (cursor === '1') return { jobs: [syntheticElementJob({ id: '200', startedAt: '2026-08-01T00:00:00.000Z' })], nextCursor: '2', total: 3 }
      return { jobs: [syntheticElementJob({ id: '100', startedAt: '2026-07-01T00:00:00.000Z' })], nextCursor: null, total: 3 }
    })
    await sync(providerWith(history))
    expect(history).toHaveBeenCalledTimes(3)
    expect((await temp.repos.elementStatistics.getJob(connectionId, '100'))?.result).toBe('completed')
  })

  test('a newly encountered unknown result is not a terminal boundary for a recent refresh', async () => {
    await temp.repos.elementStatistics.saveSyncState({
      ...emptyElementSyncState(connectionId), backfillComplete: true,
      lastFullScanAt: ELEMENT_TEST_NOW, backfillCompletedAt: ELEMENT_TEST_NOW,
    })
    const history = vi.fn(async (_printer: string, cursor: string | null): Promise<ElementHistoryPage> => {
      if (cursor === null) return { jobs: [syntheticElementJob({ id: '300' })], nextCursor: '1', total: 3 }
      if (cursor === '1') return {
        jobs: [syntheticElementJob({
          id: '200', startedAt: '2026-08-01T00:00:00.000Z',
          result: 'unknown', rawStatus: '1', endedAt: null, actualDurationSeconds: null,
        })],
        nextCursor: '2', total: 3,
      }
      return {
        jobs: [syntheticElementJob({ id: '199', startedAt: '2026-07-31T00:00:00.000Z' })],
        nextCursor: null, total: 3,
      }
    })
    await sync(providerWith(history))
    expect(history).toHaveBeenCalledTimes(3)
    expect((await temp.repos.elementStatistics.getJob(connectionId, '200'))?.result).toBe('unknown')
    expect(await temp.repos.elementStatistics.getJob(connectionId, '199')).not.toBeNull()
  })

  test('daily full rescan preserves jobs that have expired from cloud pages', async () => {
    await temp.repos.elementStatistics.commitPage(connectionId, [syntheticElementJob({ id: 'old' })],
      ELEMENT_TEST_NOW, {
        ...emptyElementSyncState(connectionId), backfillComplete: true,
        lastFullScanAt: '2026-09-13T18:30:00.000Z',
      })
    const state = await sync(providerWith(async () => ({ jobs: [], nextCursor: null, total: 0 })))
    expect(state.backfillComplete).toBe(true)
    expect(await temp.repos.elementStatistics.getJob(connectionId, 'old')).not.toBeNull()
  })

  test('cancellation never commits a response received after disabling monitoring', async () => {
    const controller = new AbortController()
    const provider = providerWith(async () => {
      controller.abort()
      return { jobs: [syntheticElementJob()], nextCursor: null, total: 1 }
    })
    await expect(synchronizeHistory({
      repository: temp.repos.elementStatistics, provider, connectionId, printerId: 'SYNTHETIC123',
      signal: controller.signal, now: () => now,
    })).rejects.toThrow()
    expect(await temp.repos.elementStatistics.listJobs(connectionId, 10)).toEqual([])
  })
})
