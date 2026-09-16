import { createHash } from 'node:crypto'
import { elementElapsedSeconds } from '../../contracts/elementStatistics.ts'
import type {
  ElementConnection, ElementEvent, ElementEventKind, ElementJob, ElementJobField, ElementJobInput,
  ElementMaterialUsage, ElementSnapshot, ElementSyncState,
} from '../../contracts/elementStatistics.ts'
import type { SqliteDatabase } from '../connection.ts'
import type { ElementStatisticsRepository } from './elementStatisticsContract.ts'
import { emptyElementSyncState } from './elementStatisticsContract.ts'

const JOB_RESULTS = new Set(['completed', 'failed_or_aborted', 'active', 'unknown'])
const JOB_FIELDS = new Set<ElementJobField>([
  'title', 'result', 'rawStatus', 'startedAt', 'endedAt', 'actualDurationSeconds',
  'estimatedDurationSeconds', 'estimatedWeightGrams', 'estimatedLength', 'lengthUnit',
  'materials', 'warnings',
])
const EVENT_KINDS = new Set<ElementEventKind>([
  'printer_state', 'printer_error', 'connection', 'sync_error',
  'sync_recovered', 'recording_gap',
])
const SNAPSHOT_FIELDS = [
  'state', 'jobId', 'jobName', 'progressPercent', 'remainingMinutes', 'currentLayer',
  'totalLayers', 'nozzleActualC', 'nozzleTargetC', 'bedActualC', 'bedTargetC',
  'wifiSignalDbm', 'printError', 'hms', 'ams',
] as const
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

// Identities and pagination cursors are never truncated or coerced: doing so
// could silently join two households or resume at a different history page.
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value || value.trim() !== value
    || value.length > 512 || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new TypeError('Invalid EL-ement identity')
  }
  return value
}

function cursor(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string' || value.length > 2_048 || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new TypeError('Invalid EL-ement history cursor')
  }
  return value
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value)
    || !Number.isFinite(Date.parse(value))) {
    throw new TypeError('Invalid EL-ement timestamp')
  }
  return new Date(value).toISOString()
}

const nullableTimestamp = (value: unknown): string | null =>
  value == null ? null : timestamp(value)

const text = (value: unknown, max = 512): string | null =>
  typeof value === 'string'
    ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim().slice(0, max) || null
    : null

function requiredText(value: unknown, max = 512): string {
  const clean = text(value, max)
  if (clean === null) throw new TypeError('Invalid EL-ement public text field')
  return clean
}

const number = (value: unknown, min = 0, max = Number.MAX_VALUE): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value : null

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Invalid EL-ement count')
  }
  return value
}

function boolean(value: unknown): number {
  if (typeof value !== 'boolean') throw new TypeError('Invalid EL-ement flag')
  return value ? 1 : 0
}

function limit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError('EL-ement limit must be a positive safe integer')
  }
  return value
}

function array<T>(value: readonly T[], max = 256): readonly T[] {
  if (!Array.isArray(value) || value.length > max) {
    throw new TypeError('Invalid EL-ement normalized list')
  }
  return value
}

const seenCursors = (values: string[]): string =>
  JSON.stringify(array(values, 4_096).map((value) => {
    const clean = cursor(value)
    if (clean === null) throw new TypeError('Invalid EL-ement history cursor')
    return clean
  }))

type JobValues = Omit<ElementJobInput, 'reportedFields'>
type StoredJob = Omit<ElementJob, 'reportedFields'>

interface JobRow extends Omit<StoredJob, 'materials' | 'warnings'> {
  materialsJson: string
  warningsJson: string
}

const JOB_COLUMNS = `
  connection_id AS connectionId, cloud_job_id AS id, title, result,
  raw_status AS rawStatus, started_at AS startedAt, ended_at AS endedAt,
  actual_duration_seconds AS actualDurationSeconds,
  estimated_duration_seconds AS estimatedDurationSeconds,
  estimated_weight_grams AS estimatedWeightGrams, estimated_length AS estimatedLength,
  length_unit AS lengthUnit, materials_json AS materialsJson, warnings_json AS warningsJson,
  first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt`

const jobFromRow = ({ materialsJson, warningsJson, ...row }: JobRow): ElementJob => ({
  ...row,
  materials: JSON.parse(materialsJson) as ElementMaterialUsage[],
  warnings: JSON.parse(warningsJson) as string[],
})

const jobToRow = ({ materials, warnings, ...job }: StoredJob): JobRow => ({
  ...job,
  materialsJson: JSON.stringify(materials),
  warningsJson: JSON.stringify(warnings),
})

function reportedJobFields(fields: ElementJobInput['reportedFields']): ReadonlySet<ElementJobField> | null {
  if (fields === undefined) return null
  const reported = new Set<ElementJobField>()
  for (const field of array(fields)) {
    if (!JOB_FIELDS.has(field)) throw new TypeError('Invalid EL-ement reported job field')
    reported.add(field)
  }
  return reported
}

function cleanJob(input: ElementJobInput): JobValues {
  if (!JOB_RESULTS.has(input.result)) throw new TypeError('Invalid EL-ement job result')
  const estimatedLength = number(input.estimatedLength)
  return {
    id: identifier(input.id),
    title: text(input.title),
    result: input.result,
    rawStatus: text(input.rawStatus, 128),
    startedAt: nullableTimestamp(input.startedAt),
    endedAt: nullableTimestamp(input.endedAt),
    actualDurationSeconds: number(input.actualDurationSeconds),
    estimatedDurationSeconds: number(input.estimatedDurationSeconds),
    estimatedWeightGrams: number(input.estimatedWeightGrams),
    estimatedLength,
    lengthUnit: input.lengthUnit === 'mm' || input.lengthUnit === 'm' ? input.lengthUnit : null,
    materials: array(input.materials).map((material) => ({
      material: text(material.material, 128),
      filamentId: text(material.filamentId, 128),
      color: text(material.color, 64),
      estimatedWeightGrams: number(material.estimatedWeightGrams),
      nozzleId: text(material.nozzleId, 128),
      amsId: text(material.amsId, 128),
      slotId: text(material.slotId, 128),
    })),
    warnings: [...new Set(array(input.warnings).map((warning) => requiredText(warning)))],
  }
}

/**
 * Absent ingestion metadata means full replacement, including nulls and [].
 * Sparse observations replace only reported fields; a reported array replaces
 * its whole value, including unavailable members. Metadata is never persisted.
 * Elapsed time is always derived from the merged timeline, never borrowed from
 * an old row or trusted from the incoming duration field. Active jobs cannot
 * keep an end time, and a missing length cannot carry a unit.
 */
function mergeJob(
  connectionId: string, input: JobValues, previous: ElementJob | null, observedAt: string,
  reported: ReadonlySet<ElementJobField> | null,
): StoredJob {
  if (previous && observedAt < previous.lastSeenAt) return previous
  const value = <Field extends ElementJobField>(field: Field, empty: JobValues[Field]): JobValues[Field] =>
    reported === null || reported.has(field) ? input[field] : previous ? previous[field] : empty
  const result = value('result', 'unknown')
  const startedAt = value('startedAt', null)
  const endedAt = result === 'active' ? null : value('endedAt', null)
  const estimatedLength = value('estimatedLength', null)
  return {
    id: input.id,
    connectionId,
    title: value('title', null),
    result,
    rawStatus: value('rawStatus', null),
    startedAt,
    endedAt,
    actualDurationSeconds: elementElapsedSeconds(result, startedAt, endedAt, observedAt),
    estimatedDurationSeconds: value('estimatedDurationSeconds', null),
    estimatedWeightGrams: value('estimatedWeightGrams', null),
    estimatedLength,
    lengthUnit: estimatedLength === null ? null : value('lengthUnit', null),
    materials: value('materials', []),
    warnings: value('warnings', []),
    firstSeenAt: previous?.firstSeenAt ?? observedAt,
    lastSeenAt: observedAt,
  }
}

interface SyncRow extends Omit<ElementSyncState,
  'backfillComplete' | 'backfillSeenCursors' | 'refreshSeenCursors' | 'problem'> {
  backfillComplete: number
  backfillSeenCursorsJson: string
  refreshSeenCursorsJson: string
  problemCode: string | null
  problemMessage: string | null
}

const SYNC_COLUMNS = `
  connection_id AS connectionId, backfill_cursor AS backfillCursor,
  backfill_complete AS backfillComplete, backfill_started_at AS backfillStartedAt,
  backfill_completed_at AS backfillCompletedAt, backfill_pages AS backfillPages,
  backfill_seen_cursors AS backfillSeenCursorsJson, refresh_cursor AS refreshCursor,
  refresh_boundary AS refreshBoundary, refresh_seen_cursors AS refreshSeenCursorsJson,
  last_attempt_at AS lastAttemptAt, last_success_at AS lastSuccessAt,
  last_full_scan_at AS lastFullScanAt, next_sync_at AS nextSyncAt,
  consecutive_failures AS consecutiveFailures, remote_total AS remoteTotal,
  problem_code AS problemCode, problem_message AS problemMessage`

const syncFromRow = ({
  backfillComplete, backfillSeenCursorsJson, refreshSeenCursorsJson,
  problemCode, problemMessage, ...row
}: SyncRow): ElementSyncState => ({
  ...row,
  backfillComplete: backfillComplete === 1,
  backfillSeenCursors: JSON.parse(backfillSeenCursorsJson) as string[],
  refreshSeenCursors: JSON.parse(refreshSeenCursorsJson) as string[],
  problem: problemCode === null ? null : { code: problemCode, message: problemMessage ?? '' },
})

const syncToRow = (state: ElementSyncState): SyncRow => ({
  connectionId: identifier(state.connectionId),
  backfillCursor: cursor(state.backfillCursor),
  backfillComplete: boolean(state.backfillComplete),
  backfillStartedAt: nullableTimestamp(state.backfillStartedAt),
  backfillCompletedAt: nullableTimestamp(state.backfillCompletedAt),
  backfillPages: count(state.backfillPages),
  backfillSeenCursorsJson: seenCursors(state.backfillSeenCursors),
  refreshCursor: cursor(state.refreshCursor),
  refreshBoundary: cursor(state.refreshBoundary),
  refreshSeenCursorsJson: seenCursors(state.refreshSeenCursors),
  lastAttemptAt: nullableTimestamp(state.lastAttemptAt),
  lastSuccessAt: nullableTimestamp(state.lastSuccessAt),
  lastFullScanAt: nullableTimestamp(state.lastFullScanAt),
  nextSyncAt: nullableTimestamp(state.nextSyncAt),
  consecutiveFailures: count(state.consecutiveFailures),
  remoteTotal: state.remoteTotal === null ? null : count(state.remoteTotal),
  problemCode: state.problem === null ? null : requiredText(state.problem.code, 128),
  problemMessage: state.problem === null ? null : requiredText(state.problem.message, 1_000),
})

interface SnapshotRow extends Omit<ElementSnapshot, 'hms' | 'ams' | 'fieldUpdatedAt'> {
  hmsJson: string | null
  amsJson: string | null
  fieldUpdatedAtJson: string
}

const SNAPSHOT_COLUMNS = `
  received_at AS receivedAt, state, job_id AS jobId, job_name AS jobName,
  progress_percent AS progressPercent, remaining_minutes AS remainingMinutes,
  current_layer AS currentLayer, total_layers AS totalLayers,
  nozzle_actual_c AS nozzleActualC, nozzle_target_c AS nozzleTargetC,
  bed_actual_c AS bedActualC, bed_target_c AS bedTargetC,
  wifi_signal_dbm AS wifiSignalDbm, print_error AS printError,
  hms_json AS hmsJson, ams_json AS amsJson, field_updated_at AS fieldUpdatedAtJson`

const snapshotFromRow = ({
  hmsJson, amsJson, fieldUpdatedAtJson, ...row
}: SnapshotRow): ElementSnapshot => ({
  ...row,
  hms: hmsJson === null ? null : JSON.parse(hmsJson) as ElementSnapshot['hms'],
  ams: amsJson === null ? null : JSON.parse(amsJson) as ElementSnapshot['ams'],
  fieldUpdatedAt: JSON.parse(fieldUpdatedAtJson) as Record<string, string>,
})

function snapshotToRow(snapshot: ElementSnapshot): SnapshotRow {
  const fieldUpdatedAt: Record<string, string> = {}
  for (const field of SNAPSHOT_FIELDS) {
    if (snapshot.fieldUpdatedAt && Object.hasOwn(snapshot.fieldUpdatedAt, field)) {
      fieldUpdatedAt[field] = timestamp(snapshot.fieldUpdatedAt[field])
    }
  }
  return {
    receivedAt: timestamp(snapshot.receivedAt),
    state: text(snapshot.state, 128),
    jobId: snapshot.jobId == null ? null : identifier(snapshot.jobId),
    jobName: text(snapshot.jobName),
    progressPercent: number(snapshot.progressPercent, 0, 100),
    remainingMinutes: number(snapshot.remainingMinutes),
    currentLayer: snapshot.currentLayer == null ? null : count(snapshot.currentLayer),
    totalLayers: snapshot.totalLayers == null ? null : count(snapshot.totalLayers),
    nozzleActualC: number(snapshot.nozzleActualC, -Number.MAX_VALUE),
    nozzleTargetC: number(snapshot.nozzleTargetC, -Number.MAX_VALUE),
    bedActualC: number(snapshot.bedActualC, -Number.MAX_VALUE),
    bedTargetC: number(snapshot.bedTargetC, -Number.MAX_VALUE),
    wifiSignalDbm: number(snapshot.wifiSignalDbm, -Number.MAX_VALUE),
    printError: text(snapshot.printError, 128),
    hmsJson: snapshot.hms == null ? null : JSON.stringify(array(snapshot.hms).map((issue) => ({
      code: requiredText(issue.code, 128),
      attribute: text(issue.attribute, 128),
    }))),
    amsJson: snapshot.ams == null ? null : JSON.stringify(array(snapshot.ams).map((slot) => ({
      amsId: identifier(slot.amsId),
      slotId: identifier(slot.slotId),
      material: text(slot.material, 128),
      subBrand: text(slot.subBrand, 128),
      color: text(slot.color, 64),
      remainingPercent: number(slot.remainingPercent, 0, 100),
      empty: typeof slot.empty === 'boolean' ? slot.empty : null,
    }))),
    fieldUpdatedAtJson: JSON.stringify(fieldUpdatedAt),
  }
}

interface EventRow extends Omit<ElementEvent, 'id'> {
  id: number
}

const EVENT_COLUMNS = `
  id, connection_id AS connectionId, occurred_at AS occurredAt, kind, code, message, job_id AS jobId`
const eventFromRow = (row: EventRow): ElementEvent => ({ ...row, id: String(row.id) })
const minuteOf = (at: string): string => `${at.slice(0, 16)}:00.000Z`

export function createElementStatisticsRepository(db: SqliteDatabase): ElementStatisticsRepository {
  const selectSettings = db.prepare<[], {
    enabled: number; activeConnectionId: string | null; updatedAt: string | null
  }>(`SELECT enabled, active_connection_id AS activeConnectionId, updated_at AS updatedAt
      FROM element_statistics_settings WHERE singleton = 1`)
  const saveSettings = db.prepare(`
    INSERT INTO element_statistics_settings (singleton, enabled, active_connection_id, updated_at)
    VALUES (1, ?, ?, ?)
    ON CONFLICT (singleton) DO UPDATE SET
      enabled = excluded.enabled, active_connection_id = excluded.active_connection_id,
      updated_at = excluded.updated_at`)

  const connectionColumns = `id, account_id AS accountId, account_name AS accountName, region,
    printer_id AS printerId, printer_name AS printerName, printer_model AS printerModel,
    created_at AS createdAt, updated_at AS updatedAt`
  const selectConnection = db.prepare<[string], ElementConnection>(
    `SELECT ${connectionColumns} FROM element_statistics_connections WHERE id = ?`)
  const selectConnections = db.prepare<[], ElementConnection>(
    `SELECT ${connectionColumns} FROM element_statistics_connections ORDER BY created_at, id`)
  const saveConnection = db.prepare(`
    INSERT INTO element_statistics_connections
      (id, account_id, account_name, region, printer_id, printer_name, printer_model, created_at, updated_at)
    VALUES (@id, @accountId, @accountName, @region, @printerId, @printerName, @printerModel, @createdAt, @updatedAt)
    ON CONFLICT (id) DO UPDATE SET
      account_name = COALESCE(excluded.account_name, element_statistics_connections.account_name),
      printer_name = excluded.printer_name,
      printer_model = COALESCE(excluded.printer_model, element_statistics_connections.printer_model),
      updated_at = excluded.updated_at
    WHERE account_id = excluded.account_id AND region = excluded.region AND printer_id = excluded.printer_id`)

  const selectSync = db.prepare<[string], SyncRow>(
    `SELECT ${SYNC_COLUMNS} FROM element_statistics_sync_state WHERE connection_id = ?`)
  const readSync = (connectionId: string): ElementSyncState => {
    const row = selectSync.get(connectionId)
    return row ? syncFromRow(row) : emptyElementSyncState(connectionId)
  }
  const saveSync = db.prepare(`
    INSERT INTO element_statistics_sync_state (
      connection_id, backfill_cursor, backfill_complete, backfill_started_at,
      backfill_completed_at, backfill_pages, backfill_seen_cursors,
      refresh_cursor, refresh_boundary, refresh_seen_cursors, last_attempt_at,
      last_success_at, last_full_scan_at, next_sync_at, consecutive_failures,
      remote_total, problem_code, problem_message
    ) VALUES (
      @connectionId, @backfillCursor, @backfillComplete, @backfillStartedAt,
      @backfillCompletedAt, @backfillPages, @backfillSeenCursorsJson,
      @refreshCursor, @refreshBoundary, @refreshSeenCursorsJson, @lastAttemptAt,
      @lastSuccessAt, @lastFullScanAt, @nextSyncAt, @consecutiveFailures,
      @remoteTotal, @problemCode, @problemMessage
    )
    ON CONFLICT (connection_id) DO UPDATE SET
      backfill_cursor = excluded.backfill_cursor, backfill_complete = excluded.backfill_complete,
      backfill_started_at = excluded.backfill_started_at, backfill_completed_at = excluded.backfill_completed_at,
      backfill_pages = excluded.backfill_pages, backfill_seen_cursors = excluded.backfill_seen_cursors,
      refresh_cursor = excluded.refresh_cursor, refresh_boundary = excluded.refresh_boundary,
      refresh_seen_cursors = excluded.refresh_seen_cursors, last_attempt_at = excluded.last_attempt_at,
      last_success_at = excluded.last_success_at, last_full_scan_at = excluded.last_full_scan_at,
      next_sync_at = excluded.next_sync_at, consecutive_failures = excluded.consecutive_failures,
      remote_total = excluded.remote_total, problem_code = excluded.problem_code,
      problem_message = excluded.problem_message`)

  const selectJob = db.prepare<[string, string], JobRow>(
    `SELECT ${JOB_COLUMNS} FROM element_statistics_jobs WHERE connection_id = ? AND cloud_job_id = ?`)
  const saveJob = db.prepare(`
    INSERT INTO element_statistics_jobs (
      connection_id, cloud_job_id, title, result, raw_status, started_at, ended_at,
      actual_duration_seconds, estimated_duration_seconds, estimated_weight_grams,
      estimated_length, length_unit, materials_json, warnings_json, first_seen_at, last_seen_at
    ) VALUES (
      @connectionId, @id, @title, @result, @rawStatus, @startedAt, @endedAt,
      @actualDurationSeconds, @estimatedDurationSeconds, @estimatedWeightGrams,
      @estimatedLength, @lengthUnit, @materialsJson, @warningsJson, @firstSeenAt, @lastSeenAt
    )
    ON CONFLICT (connection_id, cloud_job_id) DO UPDATE SET
      title = excluded.title, result = excluded.result, raw_status = excluded.raw_status,
      started_at = excluded.started_at, ended_at = excluded.ended_at,
      actual_duration_seconds = excluded.actual_duration_seconds,
      estimated_duration_seconds = excluded.estimated_duration_seconds,
      estimated_weight_grams = excluded.estimated_weight_grams, estimated_length = excluded.estimated_length,
      length_unit = excluded.length_unit, materials_json = excluded.materials_json,
      warnings_json = excluded.warnings_json, last_seen_at = excluded.last_seen_at`)
  const commitPage = db.transaction((
    connectionId: string, jobs: readonly ElementJobInput[], observedAt: string, state: ElementSyncState,
  ) => {
    for (const job of jobs) {
      const claimedConnection = (job as Partial<ElementJob>).connectionId
      if (claimedConnection !== undefined && claimedConnection !== connectionId) {
        throw new TypeError('EL-ement job belongs to another connection')
      }
      const reported = reportedJobFields(job.reportedFields)
      const input = cleanJob(job)
      const row = selectJob.get(connectionId, input.id)
      saveJob.run(jobToRow(mergeJob(connectionId, input, row ? jobFromRow(row) : null, observedAt, reported)))
    }
    saveSync.run(syncToRow(state))
  })

  const selectSnapshot = db.prepare<[string], SnapshotRow>(
    `SELECT ${SNAPSHOT_COLUMNS} FROM element_statistics_telemetry
     WHERE connection_id = ? ORDER BY sampled_minute DESC LIMIT 1`)
  const saveSnapshot = db.prepare(`
    INSERT INTO element_statistics_telemetry (
      connection_id, sampled_minute, received_at, state, job_id, job_name, progress_percent,
      remaining_minutes, current_layer, total_layers, nozzle_actual_c, nozzle_target_c,
      bed_actual_c, bed_target_c, wifi_signal_dbm, print_error, hms_json, ams_json, field_updated_at
    ) VALUES (
      @connectionId, @sampledMinute, @receivedAt, @state, @jobId, @jobName, @progressPercent,
      @remainingMinutes, @currentLayer, @totalLayers, @nozzleActualC, @nozzleTargetC,
      @bedActualC, @bedTargetC, @wifiSignalDbm, @printError, @hmsJson, @amsJson, @fieldUpdatedAtJson
    )
    ON CONFLICT (connection_id, sampled_minute) DO UPDATE SET
      received_at = excluded.received_at, state = excluded.state, job_id = excluded.job_id,
      job_name = excluded.job_name, progress_percent = excluded.progress_percent,
      remaining_minutes = excluded.remaining_minutes, current_layer = excluded.current_layer,
      total_layers = excluded.total_layers, nozzle_actual_c = excluded.nozzle_actual_c,
      nozzle_target_c = excluded.nozzle_target_c, bed_actual_c = excluded.bed_actual_c,
      bed_target_c = excluded.bed_target_c, wifi_signal_dbm = excluded.wifi_signal_dbm,
      print_error = excluded.print_error, hms_json = excluded.hms_json, ams_json = excluded.ams_json,
      field_updated_at = excluded.field_updated_at
    WHERE excluded.received_at >= element_statistics_telemetry.received_at`)
  const pruneSamples = db.prepare('DELETE FROM element_statistics_telemetry WHERE received_at < ?')

  const selectLatestEvent = db.prepare<[string], EventRow>(
    `SELECT ${EVENT_COLUMNS} FROM element_statistics_events
     WHERE connection_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 1`)
  const insertEvent = db.prepare(`
    INSERT INTO element_statistics_events
      (connection_id, occurred_at, kind, code, message, job_id, replay_key)
    VALUES (@connectionId, @occurredAt, @kind, @code, @message, @jobId, @replayKey)
    ON CONFLICT (replay_key) DO NOTHING`)
  const recordEvent = db.transaction((event: Omit<ElementEvent, 'id'>) => {
    const previous = selectLatestEvent.get(event.connectionId)
    // Only consecutive identical observations coalesce. A -> B -> A is a
    // meaningful transition even in one minute; exact replays stay idempotent.
    if (previous && minuteOf(previous.occurredAt) === minuteOf(event.occurredAt)
      && previous.kind === event.kind && previous.code === event.code
      && previous.message === event.message && previous.jobId === event.jobId) return
    const replayKey = createHash('sha256').update(JSON.stringify([
      event.connectionId, event.occurredAt, event.kind, event.code, event.message, event.jobId,
    ])).digest('hex')
    insertEvent.run({ ...event, replayKey })
  })

  return {
    async getSettings() {
      const row = selectSettings.get()
      return row ? { ...row, enabled: row.enabled === 1 }
        : { enabled: false, activeConnectionId: null, updatedAt: null }
    },
    async saveSettings(settings) {
      saveSettings.run(boolean(settings.enabled),
        settings.activeConnectionId === null ? null : identifier(settings.activeConnectionId),
        nullableTimestamp(settings.updatedAt))
    },
    async listConnections() {
      return selectConnections.all()
    },
    async saveConnection(connection) {
      if (connection.region !== 'global' && connection.region !== 'china') {
        throw new TypeError('Invalid EL-ement region')
      }
      const clean: ElementConnection = {
        id: identifier(connection.id),
        accountId: identifier(connection.accountId),
        accountName: text(connection.accountName, 256),
        region: connection.region,
        printerId: identifier(connection.printerId),
        printerName: requiredText(connection.printerName, 256),
        printerModel: text(connection.printerModel, 128),
        createdAt: timestamp(connection.createdAt),
        updatedAt: timestamp(connection.updatedAt),
      }
      if (saveConnection.run(clean).changes !== 1) {
        throw new TypeError('EL-ement connection identity cannot be reassigned')
      }
      return selectConnection.get(clean.id)!
    },
    async getSyncState(connectionId) {
      return readSync(identifier(connectionId))
    },
    async saveSyncState(state) {
      saveSync.run(syncToRow(state))
    },
    async commitPage(connectionId, jobs, observedAt, state) {
      identifier(connectionId)
      if (state.connectionId !== connectionId) {
        throw new TypeError('EL-ement checkpoint belongs to another connection')
      }
      commitPage(connectionId, jobs, timestamp(observedAt), state)
    },
    async listJobs(connectionId, requestedLimit, bounds) {
      const boundedLimit = limit(requestedLimit)
      const where: string[] = []
      const params: (string | number)[] = []
      if (connectionId !== null) {
        where.push('connection_id = ?')
        params.push(identifier(connectionId))
      }
      if (bounds?.fromInclusive !== undefined) {
        where.push('started_at >= ?')
        params.push(timestamp(bounds.fromInclusive))
      }
      if (bounds?.toExclusive !== undefined) {
        where.push('started_at < ?')
        params.push(timestamp(bounds.toExclusive))
      }
      return db.prepare<(string | number)[], JobRow>(`
        SELECT ${JOB_COLUMNS} FROM element_statistics_jobs
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY started_at DESC, connection_id, cloud_job_id LIMIT ?`)
        .all(...params, boundedLimit).map(jobFromRow)
    },
    async getJob(connectionId, id) {
      const row = selectJob.get(identifier(connectionId), identifier(id))
      return row ? jobFromRow(row) : null
    },
    async coverage() {
      const rows = db.prepare<[], {
        connectionId: string; jobCount: number; earliestJobAt: string | null;
        latestJobAt: string | null; firstRecordedAt: string | null;
        lastRecordedAt: string | null; undatedJobs: number
      }>(`
        SELECT c.id AS connectionId, COUNT(j.cloud_job_id) AS jobCount,
          MIN(j.started_at) AS earliestJobAt, MAX(j.started_at) AS latestJobAt,
          MIN(j.first_seen_at) AS firstRecordedAt, MAX(j.last_seen_at) AS lastRecordedAt,
          SUM(CASE WHEN j.cloud_job_id IS NOT NULL AND j.started_at IS NULL THEN 1 ELSE 0 END) AS undatedJobs
        FROM element_statistics_connections c
        LEFT JOIN element_statistics_jobs j ON j.connection_id = c.id
        GROUP BY c.id ORDER BY c.created_at, c.id`).all()
      return rows.map((row) => ({ ...row, sync: readSync(row.connectionId) }))
    },
    async getSnapshot(connectionId) {
      const row = selectSnapshot.get(identifier(connectionId))
      return row ? snapshotFromRow(row) : null
    },
    async recordSnapshot(connectionId, snapshot) {
      const row = snapshotToRow(snapshot)
      saveSnapshot.run({
        ...row, connectionId: identifier(connectionId), sampledMinute: minuteOf(row.receivedAt),
      })
    },
    async pruneTelemetry(before) {
      pruneSamples.run(timestamp(before))
    },
    async recordEvent(event) {
      if (!EVENT_KINDS.has(event.kind)) throw new TypeError('Invalid EL-ement event kind')
      recordEvent({
        connectionId: identifier(event.connectionId),
        occurredAt: timestamp(event.occurredAt),
        kind: event.kind,
        code: requiredText(event.code, 128),
        message: requiredText(event.message, 1_000),
        jobId: event.jobId === null ? null : identifier(event.jobId),
      })
    },
    async listEvents(connectionId, requestedLimit, jobId) {
      const boundedLimit = limit(requestedLimit)
      const where: string[] = []
      const params: (string | number)[] = []
      if (connectionId !== null) {
        where.push('connection_id = ?')
        params.push(identifier(connectionId))
      }
      if (jobId !== undefined) {
        where.push('job_id = ?')
        params.push(identifier(jobId))
      }
      return db.prepare<(string | number)[], EventRow>(`
        SELECT ${EVENT_COLUMNS} FROM element_statistics_events
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY occurred_at DESC, id DESC LIMIT ?`)
        .all(...params, boundedLimit).map(eventFromRow)
    },
  }
}
