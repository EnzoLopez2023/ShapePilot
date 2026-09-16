// Public monitoring contracts. Credentials and raw upstream payloads never
// belong here: this module is also consumed by the browser.
export type BambuRegion = 'global' | 'china'
export type ElementJobResult = 'completed' | 'failed_or_aborted' | 'active' | 'unknown'
export type ElementGrain = 'day' | 'week' | 'month'

export interface ElementPrinter {
  id: string
  name: string
  model: string | null
  online: boolean | null
  state: string | null
}

export interface ElementAccount {
  accountId: string
  name: string | null
  region: BambuRegion
  printers: ElementPrinter[]
}

export interface ElementConnection {
  id: string
  accountId: string
  accountName: string | null
  region: BambuRegion
  printerId: string
  printerName: string
  printerModel: string | null
  createdAt: string
  updatedAt: string
}

export interface ElementSettings {
  enabled: boolean
  activeConnectionId: string | null
  updatedAt: string | null
}

export interface ElementMaterialUsage {
  material: string | null
  filamentId: string | null
  color: string | null
  estimatedWeightGrams: number | null
  nozzleId: string | null
  amsId: string | null
  slotId: string | null
}

export type ElementJobField =
  | 'title' | 'result' | 'rawStatus' | 'startedAt' | 'endedAt' | 'actualDurationSeconds'
  | 'estimatedDurationSeconds' | 'estimatedWeightGrams' | 'estimatedLength' | 'lengthUnit'
  | 'materials' | 'warnings'

export interface ElementJobInput {
  /** Ingestion metadata: omission differs from an explicitly unavailable value.
   *  Absent metadata denotes a complete normalized record, including nulls. */
  reportedFields?: readonly ElementJobField[]
  id: string
  title: string | null
  result: ElementJobResult
  rawStatus: string | null
  startedAt: string | null
  endedAt: string | null
  actualDurationSeconds: number | null
  estimatedDurationSeconds: number | null
  estimatedWeightGrams: number | null
  estimatedLength: number | null
  /** The community API does not promise a unit for an unqualified `length`. */
  lengthUnit: 'mm' | 'm' | null
  materials: ElementMaterialUsage[]
  warnings: string[]
}

export function elementElapsedSeconds(
  result: ElementJobResult,
  startedAt: string | null,
  endedAt: string | null,
  observedAt: string,
): number | null {
  if ((result !== 'completed' && result !== 'failed_or_aborted') || !startedAt || !endedAt) return null
  const start = Date.parse(startedAt)
  const end = Date.parse(endedAt)
  const observed = Date.parse(observedAt)
  if (![start, end, observed].every(Number.isFinite) || end > observed || start > observed) return null
  const seconds = (end - start) / 1000
  // Very short terminal intervals can be cloud placeholders, not completed elapsed time.
  return seconds > 60 ? seconds : null
}

export interface ElementJob extends ElementJobInput {
  connectionId: string
  firstSeenAt: string
  lastSeenAt: string
}

export interface ElementHistoryPage {
  jobs: ElementJobInput[]
  nextCursor: string | null
  total: number | null
}

export interface ElementAmsSlot {
  amsId: string
  slotId: string
  material: string | null
  subBrand: string | null
  color: string | null
  remainingPercent: number | null
  empty: boolean | null
}

export interface ElementHmsIssue {
  code: string
  attribute: string | null
}

export interface ElementSnapshot {
  receivedAt: string
  state: string | null
  jobId: string | null
  jobName: string | null
  progressPercent: number | null
  remainingMinutes: number | null
  currentLayer: number | null
  totalLayers: number | null
  nozzleActualC: number | null
  nozzleTargetC: number | null
  bedActualC: number | null
  bedTargetC: number | null
  wifiSignalDbm: number | null
  printError: string | null
  /** null means unreported, [] means explicitly reported without HMS issues. */
  hms: ElementHmsIssue[] | null
  ams: ElementAmsSlot[] | null
  fieldUpdatedAt: Record<string, string>
}

export interface ElementProblem {
  code: string
  message: string
}

export interface ElementSyncState {
  connectionId: string
  backfillCursor: string | null
  backfillComplete: boolean
  backfillStartedAt: string | null
  backfillCompletedAt: string | null
  backfillPages: number
  /** Bounded fingerprints/cursors detect a replay across restarts as well. */
  backfillSeenCursors: string[]
  refreshCursor: string | null
  refreshBoundary: string | null
  refreshSeenCursors: string[]
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  lastFullScanAt: string | null
  nextSyncAt: string | null
  consecutiveFailures: number
  remoteTotal: number | null
  problem: ElementProblem | null
}

export type ElementEventKind =
  | 'printer_state' | 'printer_error' | 'connection' | 'sync_error' | 'sync_recovered'
  | 'recording_gap'

export interface ElementEventInput {
  connectionId: string
  occurredAt: string
  kind: ElementEventKind
  code: string
  message: string
  jobId: string | null
}

export interface ElementEvent extends ElementEventInput {
  id: string
}

export interface ElementCoverage {
  connectionId: string
  jobCount: number
  earliestJobAt: string | null
  latestJobAt: string | null
  firstRecordedAt: string | null
  lastRecordedAt: string | null
  undatedJobs: number
  sync: ElementSyncState
}

export type ElementConnectionState =
  | 'unconfigured' | 'disabled' | 'connecting' | 'connected' | 'offline'
  | 'expired' | 'selection_required' | 'error'

export interface ElementStatus {
  settings: ElementSettings
  credential: {
    configured: boolean
    region: BambuRegion
    expiresAt: string | null
  }
  connectionState: ElementConnectionState
  problem: ElementProblem | null
  connections: ElementConnection[]
  snapshot: ElementSnapshot | null
  snapshotConnectionId: string | null
  freshness: 'unavailable' | 'fresh' | 'stale'
  syncing: boolean
  coverage: ElementCoverage[]
  events: ElementEvent[]
  checkedAt: string
}

export interface ElementFilters {
  /** Inclusive calendar dates in timeZone, not midnight in the server's zone. */
  from: string | null
  to: string | null
  timeZone: string
  connectionId: string | null
  material: string | null
  result: ElementJobResult | 'all'
  search: string
  grain: ElementGrain
  sort: 'started_desc' | 'started_asc' | 'weight_desc' | 'duration_desc'
}

export interface ElementQuery {
  filters: ElementFilters
  page: number
  pageSize: number
}

export interface ElementMeasure {
  /** null, not zero, when every contributing value is unreported. */
  value: number | null
  known: number
  missing: number
}

export interface ElementTotals {
  jobs: number
  results: Record<ElementJobResult, number>
  actualDurationSeconds: ElementMeasure
  estimatedDurationSeconds: ElementMeasure
  completedWeightGrams: ElementMeasure
  failedOrAbortedWeightGrams: ElementMeasure
  otherWeightGrams: ElementMeasure
  estimatedLengthMeters: ElementMeasure
  unreportedLengthUnitJobs: number
  unreportedMaterialJobs: number
  undatedJobs: number
}

export interface ElementTrendBucket {
  key: string
  from: string | null
  to: string | null
  totals: ElementTotals
}

export interface ElementMaterialSummary {
  material: string | null
  jobs: number
  completedWeightGrams: ElementMeasure
  failedOrAbortedWeightGrams: ElementMeasure
  otherWeightGrams: ElementMeasure
}

export interface ElementReport {
  generatedAt: string
  filters: ElementFilters
  totals: ElementTotals
  trend: ElementTrendBucket[]
  materials: ElementMaterialSummary[]
  materialWeightDiscrepancyJobs: number
  connections: ElementConnection[]
  availableMaterials: string[]
  coverage: ElementCoverage[]
  assumptions: string[]
  jobs: {
    items: ElementJob[]
    total: number
    page: number
    pageSize: number
  }
}

export interface ElementJobDetail {
  job: ElementJob
  connection: ElementConnection
  events: ElementEvent[]
}
