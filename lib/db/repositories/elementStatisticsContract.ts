import type {
  ElementConnection, ElementCoverage, ElementEvent, ElementEventInput, ElementJob,
  ElementJobInput, ElementSettings, ElementSnapshot, ElementSyncState,
} from '../../contracts/elementStatistics.ts'

export interface ElementStatisticsRepository {
  getSettings(): Promise<ElementSettings>
  saveSettings(settings: ElementSettings): Promise<void>
  listConnections(): Promise<ElementConnection[]>
  saveConnection(connection: ElementConnection): Promise<ElementConnection>
  getSyncState(connectionId: string): Promise<ElementSyncState>
  saveSyncState(state: ElementSyncState): Promise<void>
  /** The page and its resume checkpoint commit together, never separately. */
  commitPage(
    connectionId: string,
    jobs: readonly ElementJobInput[],
    observedAt: string,
    state: ElementSyncState,
  ): Promise<void>
  /** Bounds apply before the explicit limit; callers request limit+1 to detect overflow. */
  listJobs(
    connectionId: string | null,
    limit: number,
    bounds?: { fromInclusive?: string; toExclusive?: string },
  ): Promise<ElementJob[]>
  getJob(connectionId: string, id: string): Promise<ElementJob | null>
  coverage(): Promise<ElementCoverage[]>
  getSnapshot(connectionId: string): Promise<ElementSnapshot | null>
  /** Coalesces a minute's telemetry; only samples, never the job ledger, expire. */
  recordSnapshot(connectionId: string, snapshot: ElementSnapshot): Promise<void>
  pruneTelemetry(before: string): Promise<void>
  recordEvent(event: ElementEventInput): Promise<void>
  listEvents(connectionId: string | null, limit: number, jobId?: string): Promise<ElementEvent[]>
}

export const emptyElementSyncState = (connectionId: string): ElementSyncState => ({
  connectionId,
  backfillCursor: null,
  backfillComplete: false,
  backfillStartedAt: null,
  backfillCompletedAt: null,
  backfillPages: 0,
  backfillSeenCursors: [],
  refreshCursor: null,
  refreshBoundary: null,
  refreshSeenCursors: [],
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastFullScanAt: null,
  nextSyncAt: null,
  consecutiveFailures: 0,
  remoteTotal: null,
  problem: null,
})
