import { createHash } from 'node:crypto'
import type {
  ElementHistoryPage, ElementSyncState,
} from '../../lib/contracts/elementStatistics.ts'
import type { ElementStatisticsRepository } from '../../lib/db/repositories/elementStatisticsContract.ts'
import { ApiError } from '../errors/ApiError.ts'
import type { BambuProvider } from './provider.ts'

export const HISTORY_PAGE_SIZE = 50
export const HISTORY_PAGES_PER_PASS = 4
export const SYNC_INTERVAL_MS = 5 * 60_000
export const REPORT_JOB_LIMIT = 50_000
const DAY_MS = 86_400_000
const CURSOR_MEMORY = 256

interface SynchronizationOptions {
  repository: ElementStatisticsRepository
  provider: BambuProvider
  connectionId: string
  printerId: string
  signal: AbortSignal
  now: () => number
}

function pageProgress(page: ElementHistoryPage, cursor: string | null, seen: string[]): string[] {
  const ids = page.jobs.map(job => job.id)
  if (new Set(ids).size !== ids.length) {
    throw new ApiError(502, 'history_replayed', 'Bambu returned duplicate jobs in a history page.')
  }
  if (ids.length === 0) {
    if (page.nextCursor !== null) {
      throw new ApiError(502, 'history_replayed', 'Bambu returned an empty page with a resume cursor.')
    }
    return seen
  }
  const fingerprint = createHash('sha256').update([...ids].sort().join('\0')).digest('hex')
  const marker = `page:${fingerprint}`
  const cursorMarker = `cursor:${page.nextCursor ?? 'end'}`
  if (seen.includes(marker) || (page.nextCursor !== null && (
    page.nextCursor === cursor || seen.includes(cursorMarker)
    || (cursor !== null && /^\d+$/.test(cursor) && /^\d+$/.test(page.nextCursor)
      && BigInt(page.nextCursor) >= BigInt(cursor))
  ))) {
    throw new ApiError(
      502, 'history_replayed',
      'Bambu history did not advance. Imported jobs are safe; use Rescan available history to retry.',
    )
  }
  return [...seen, marker, cursorMarker].slice(-CURSOR_MEMORY)
}

/**
 * Each bounded pass checkpoints every page. Head refreshes keep new jobs and
 * recent updates moving while a long backfill resumes further down the ledger.
 */
export async function synchronizeHistory(options: SynchronizationOptions): Promise<ElementSyncState> {
  const { repository, provider, connectionId, printerId, signal, now } = options
  let state = await repository.getSyncState(connectionId)
  const isoNow = () => new Date(now()).toISOString()
  const fetchPage = (cursor: string | null) =>
    provider.history(printerId, cursor, HISTORY_PAGE_SIZE, signal)
  const commit = async (page: ElementHistoryPage) => {
    signal.throwIfAborted()
    state.remoteTotal = page.total ?? state.remoteTotal
    await repository.commitPage(connectionId, page.jobs, isoNow(), state)
  }

  if (state.backfillComplete && (
    state.lastFullScanAt === null || now() - Date.parse(state.lastFullScanAt) >= DAY_MS
  )) {
    state = {
      ...state, backfillComplete: false, backfillCursor: null,
      backfillStartedAt: isoNow(), backfillPages: 0, backfillSeenCursors: [],
    }
  }

  if (!state.backfillComplete) {
    state.backfillStartedAt ??= isoNow()
    if (state.backfillCursor !== null) {
      const head = await fetchPage(null)
      pageProgress(head, null, [])
      await commit(head)
    }
    for (let index = 0; index < HISTORY_PAGES_PER_PASS; index += 1) {
      signal.throwIfAborted()
      const page = await fetchPage(state.backfillCursor)
      state.backfillSeenCursors = pageProgress(page, state.backfillCursor, state.backfillSeenCursors)
      state.backfillCursor = page.nextCursor
      state.backfillPages += 1
      state.backfillComplete = page.nextCursor === null
      if (state.backfillComplete) {
        state.backfillCompletedAt = isoNow()
        state.lastFullScanAt = isoNow()
        state.refreshCursor = null
        state.refreshSeenCursors = []
      }
      await commit(page)
      if (state.backfillComplete) break
    }
  } else {
    if (state.refreshCursor === null) {
      // Unknown cloud statuses are not proof of completion. Recheck them without
      // labelling them active; daily full scans also revisit undated jobs.
      const jobs = await repository.listJobs(connectionId, REPORT_JOB_LIMIT + 1)
      const unfinishedStarts = jobs
        .filter(job => (job.result === 'active' || job.result === 'unknown') && job.startedAt !== null)
        .map(job => Date.parse(job.startedAt!))
        .filter(Number.isFinite)
      state.refreshBoundary = new Date(
        Math.min(now() - 7 * DAY_MS, ...unfinishedStarts),
      ).toISOString()
      state.refreshSeenCursors = []
    } else {
      const head = await fetchPage(null)
      pageProgress(head, null, [])
      await commit(head)
    }
    for (let index = 0; index < HISTORY_PAGES_PER_PASS; index += 1) {
      signal.throwIfAborted()
      const page = await fetchPage(state.refreshCursor)
      const seen = pageProgress(page, state.refreshCursor, state.refreshSeenCursors)
      const reachedBoundary = page.jobs.length > 0 && page.jobs.every(job =>
        job.startedAt !== null && job.startedAt < (state.refreshBoundary ?? '')
        && (job.result === 'completed' || job.result === 'failed_or_aborted'))
      const finished = page.nextCursor === null || reachedBoundary
      state.refreshCursor = finished ? null : page.nextCursor
      state.refreshSeenCursors = finished ? [] : seen
      await commit(page)
      if (finished) break
    }
  }

  state.lastSuccessAt = isoNow()
  state.nextSyncAt = new Date(now() + SYNC_INTERVAL_MS).toISOString()
  state.consecutiveFailures = 0
  state.problem = null
  await repository.saveSyncState(state)
  return state
}
