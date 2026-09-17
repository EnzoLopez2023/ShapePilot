import type {
  ElementJob, ElementMaterialSummary, ElementMeasure, ElementReport, ElementTotals,
} from '../../lib/contracts/elementStatistics.ts'
import { ApiError } from '../errors/ApiError.ts'
import {
  createElementReport, elementJobValues, elementMaterialValues, filteredElementJobs,
} from './reporting.ts'

type Cell = string | number | boolean | null
type CsvRecord = Record<string, Cell>
type MeasureKey = {
  [K in keyof ElementTotals]: ElementTotals[K] extends ElementMeasure ? K : never
}[keyof ElementTotals]

const MEASURES: readonly { key: MeasureKey; metric: string; label: string; unit: string }[] = [
  { key: 'actualDurationSeconds', metric: 'actual_elapsed_seconds', label: 'Actual elapsed runtime', unit: 's' },
  { key: 'estimatedDurationSeconds', metric: 'full_slice_estimated_seconds', label: 'Full-slice duration estimate', unit: 's' },
  { key: 'completedWeightGrams', metric: 'completed_estimated_grams', label: 'Completed full-job filament estimate', unit: 'g' },
  { key: 'failedOrAbortedWeightGrams', metric: 'failed_or_aborted_full_job_estimated_grams', label: 'Failed / aborted FULL-job filament estimate', unit: 'g' },
  { key: 'otherWeightGrams', metric: 'active_or_unknown_full_job_estimated_grams', label: 'Active / unknown FULL-job filament estimate', unit: 'g' },
  { key: 'estimatedLengthMeters', metric: 'compatible_estimated_length_meters', label: 'Compatible estimated filament length', unit: 'm' },
]
const COMMON_COLUMNS = ['record_type', 'section', 'key', 'metric', 'unit', 'value', 'known', 'missing']
const JOB_COLUMNS = [
  'job_id', 'connection_id', 'printer_name', 'title', 'result', 'raw_status',
  'reported_started_at', 'reported_ended_at', 'actual_elapsed_seconds',
  'reported_actual_duration_seconds', 'full_slice_estimated_seconds', 'full_job_estimated_grams',
  'completed_estimated_grams', 'failed_or_aborted_full_job_estimated_grams',
  'active_or_unknown_full_job_estimated_grams', 'reported_estimated_length', 'reported_length_unit',
  'compatible_estimated_length_meters', 'actual_elapsed_missing', 'full_slice_estimate_missing',
  'full_job_weight_missing', 'compatible_length_missing', 'length_unit_unreported',
  'material_names', 'reported_material_weights_grams', 'unreported_material',
  'material_weight_known_entries', 'material_weight_missing_entries',
]
const MATERIAL_COLUMNS = [
  'material', 'material_filter_value', 'jobs',
  'completed_estimated_grams', 'completed_weight_known_entries', 'completed_weight_missing_entries',
  'failed_or_aborted_full_job_estimated_grams', 'failed_weight_known_entries', 'failed_weight_missing_entries',
  'active_or_unknown_full_job_estimated_grams', 'other_weight_known_entries', 'other_weight_missing_entries',
]

function exportJobs(report: ElementReport, jobs: readonly ElementJob[]): ElementJob[] {
  const filtered = filteredElementJobs(jobs, report.filters)
  const current = createElementReport(filtered, report.connections, report.coverage, {
    filters: report.filters, page: report.jobs.page, pageSize: report.jobs.pageSize,
  }, new Date(report.generatedAt))
  const fingerprint = (value: ElementReport): string => JSON.stringify([
    value.totals, value.trend, value.materials, value.materialWeightDiscrepancyJobs,
  ])
  if (filtered.length !== report.jobs.total || fingerprint(current) !== fingerprint(report)) {
    throw ApiError.conflict('Export requires all filtered jobs from the same report snapshot. Refresh the report and retry.')
  }
  return filtered
}

function csvCell(value: Cell): string {
  let text = value === null ? '' : String(value)
  // Quoting alone does not stop spreadsheet formula execution, even after invisible prefixes.
  if (typeof value === 'string' && /^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

function metricRecord(
  section: string, key: string, metric: string, unit: string, value: Cell,
  known: number | null = null, missing: number | null = null,
): CsvRecord {
  return { record_type: 'metric', section, key, metric, unit, value, known, missing }
}

function totalRecords(totals: ElementTotals, section: string, key: string): CsvRecord[] {
  return [
    metricRecord(section, key, 'jobs', 'jobs', totals.jobs),
    ...Object.entries(totals.results).map(([result, count]) =>
      metricRecord(section, key, `${result}_jobs`, 'jobs', count)),
    ...MEASURES.map(({ key: field, metric, unit }) => {
      const measure = totals[field]
      return metricRecord(section, key, metric, unit, measure.value, measure.known, measure.missing)
    }),
    metricRecord(section, key, 'unreported_length_unit_jobs', 'jobs', totals.unreportedLengthUnitJobs),
    metricRecord(section, key, 'unreported_material_jobs', 'jobs', totals.unreportedMaterialJobs),
    metricRecord(section, key, 'undated_jobs', 'jobs', totals.undatedJobs),
  ]
}

function coverageRecords(report: ElementReport): CsvRecord[] {
  return report.coverage
    .filter(item => report.filters.connectionId === null || item.connectionId === report.filters.connectionId)
    .flatMap(item => {
      // Never serialize cursors, upstream payloads, connection credentials or raw error messages.
      const fields: [string, string, Cell][] = [
        ['recorded_jobs', 'jobs', item.jobCount],
        ['undated_jobs', 'jobs', item.undatedJobs],
        ['earliest_job_at', 'timestamp', item.earliestJobAt],
        ['latest_job_at', 'timestamp', item.latestJobAt],
        ['first_recorded_at', 'timestamp', item.firstRecordedAt],
        ['last_recorded_at', 'timestamp', item.lastRecordedAt],
        ['available_cloud_pages_observed', 'pages', item.sync.backfillPages],
        ['available_cloud_backfill_complete', 'boolean', item.sync.backfillComplete],
        ['backfill_started_at', 'timestamp', item.sync.backfillStartedAt],
        ['backfill_completed_at', 'timestamp', item.sync.backfillCompletedAt],
        ['last_sync_attempt_at', 'timestamp', item.sync.lastAttemptAt],
        ['last_sync_success_at', 'timestamp', item.sync.lastSuccessAt],
        ['last_full_scan_at', 'timestamp', item.sync.lastFullScanAt],
        ['next_sync_at', 'timestamp', item.sync.nextSyncAt],
        ['consecutive_sync_failures', 'attempts', item.sync.consecutiveFailures],
        ['reported_remote_total', 'jobs', item.sync.remoteTotal],
        ['problem_code', 'text', item.sync.problem?.code ?? null],
        ['gap_free_history', 'text', 'Not established by cloud page coverage'],
      ]
      return fields.map(([metric, unit, value]) => ({
        ...metricRecord('coverage', item.connectionId, metric, unit, value), record_type: 'coverage',
      }))
    })
}

function commonRecords(report: ElementReport): CsvRecord[] {
  const fields: [string, string, Cell][] = [
    ['generated_at_utc', 'timestamp', report.generatedAt],
    ['from_date_inclusive', 'calendar_date', report.filters.from],
    ['to_date_inclusive', 'calendar_date', report.filters.to],
    ['time_zone', 'IANA', report.filters.timeZone],
    ['connection_filter', 'connection_id', report.filters.connectionId],
    ['material_filter', 'normalized_material_or___unreported__', report.filters.material],
    ['result_filter', 'result', report.filters.result],
    ['search_filter', 'text', report.filters.search],
    ['grain', 'calendar_grain', report.filters.grain],
    ['sort', 'sort', report.filters.sort],
    ['export_scope', 'text', 'All filtered jobs; not the current table page'],
    ['date_filter_meaning', 'text', 'Inclusive job start-date calendar range in time_zone; empty bounds are unrestricted'],
    ['material_filter_meaning', 'text', 'Whole jobs containing the material; job totals include all their materials'],
    ['runtime_meaning', 'text', 'Elapsed end minus start, assigned entirely to start-date bucket; not bucket occupancy'],
    ['weight_meaning', 'text', 'Full-job estimates, including failed/aborted jobs; not measured consumption or waste'],
    ['spreadsheet_safety', 'text', 'Text beginning with =, +, -, or @ after whitespace/control characters is prefixed with an apostrophe to prevent formula execution'],
  ]
  const records: CsvRecord[] = fields.map(([key, unit, value]) => ({
    record_type: 'metadata', section: 'scope', key, unit, value,
  }))
  for (const connection of report.connections) {
    if (report.filters.connectionId !== null && connection.id !== report.filters.connectionId) continue
    records.push({
      record_type: 'metadata', section: 'connections', key: connection.id,
      metric: 'printer_name', unit: 'text', value: connection.printerName,
    })
  }
  records.push(
    ...totalRecords(report.totals, 'totals', 'all'),
    metricRecord('totals', 'all', 'material_weight_discrepancy_jobs', 'jobs', report.materialWeightDiscrepancyJobs),
    ...coverageRecords(report),
    ...report.assumptions.map((value, index) => ({
      record_type: 'assumption', section: 'assumptions', key: String(index + 1), unit: 'text', value,
    })),
  )
  return records
}

function materialRecord(row: ElementMaterialSummary): CsvRecord {
  return {
    record_type: 'material', section: 'materials', key: row.material ?? '__unreported__',
    material: row.material,
    material_filter_value: row.material ?? '__unreported__',
    jobs: row.jobs,
    completed_estimated_grams: row.completedWeightGrams.value,
    completed_weight_known_entries: row.completedWeightGrams.known,
    completed_weight_missing_entries: row.completedWeightGrams.missing,
    failed_or_aborted_full_job_estimated_grams: row.failedOrAbortedWeightGrams.value,
    failed_weight_known_entries: row.failedOrAbortedWeightGrams.known,
    failed_weight_missing_entries: row.failedOrAbortedWeightGrams.missing,
    active_or_unknown_full_job_estimated_grams: row.otherWeightGrams.value,
    other_weight_known_entries: row.otherWeightGrams.known,
    other_weight_missing_entries: row.otherWeightGrams.missing,
  }
}

function materialMetricRecords(report: ElementReport): CsvRecord[] {
  return report.materials.flatMap(row => {
    const key = row.material ?? '__unreported__'
    return [
      metricRecord('materials', key, 'jobs', 'jobs', row.jobs),
      // A job counts under every material it reported, so these can sum past
      // the job total; they are what a per-material success rate reads from.
      metricRecord('materials', key, 'completed_jobs', 'jobs', row.results.completed),
      metricRecord('materials', key, 'failed_or_aborted_jobs', 'jobs', row.results.failed_or_aborted),
      metricRecord('materials', key, 'active_jobs', 'jobs', row.results.active),
      metricRecord('materials', key, 'unknown_jobs', 'jobs', row.results.unknown),
      ...MEASURES.filter(item =>
        item.key === 'completedWeightGrams' || item.key === 'failedOrAbortedWeightGrams' || item.key === 'otherWeightGrams')
        .map(({ key: field, metric, unit }) => {
          const value = row[field as 'completedWeightGrams' | 'failedOrAbortedWeightGrams' | 'otherWeightGrams']
          return metricRecord('materials', key, metric, unit, value.value, value.known, value.missing)
        }),
    ]
  })
}

function jobRecord(report: ElementReport, job: ElementJob): CsvRecord {
  const values = elementJobValues(job)
  const usages = elementMaterialValues(job)
  return {
    record_type: 'job', section: 'jobs', key: job.id,
    job_id: job.id,
    connection_id: job.connectionId,
    printer_name: report.connections.find(connection => connection.id === job.connectionId)?.printerName ?? null,
    title: job.title,
    result: values.result,
    raw_status: job.rawStatus,
    reported_started_at: job.startedAt,
    reported_ended_at: job.endedAt,
    actual_elapsed_seconds: values.actualDurationSeconds,
    reported_actual_duration_seconds: values.reportedActualDurationSeconds,
    full_slice_estimated_seconds: values.estimatedDurationSeconds,
    full_job_estimated_grams: values.estimatedWeightGrams,
    completed_estimated_grams: values.result === 'completed' ? values.estimatedWeightGrams : null,
    failed_or_aborted_full_job_estimated_grams: values.result === 'failed_or_aborted' ? values.estimatedWeightGrams : null,
    active_or_unknown_full_job_estimated_grams: values.result === 'active' || values.result === 'unknown'
      ? values.estimatedWeightGrams : null,
    reported_estimated_length: values.estimatedLength,
    reported_length_unit: values.lengthUnit ?? 'unknown',
    compatible_estimated_length_meters: values.estimatedLengthMeters,
    actual_elapsed_missing: Number(values.actualDurationSeconds === null),
    full_slice_estimate_missing: Number(values.estimatedDurationSeconds === null),
    full_job_weight_missing: Number(values.estimatedWeightGrams === null),
    compatible_length_missing: Number(values.estimatedLengthMeters === null),
    length_unit_unreported: Number(values.lengthUnit === null),
    material_names: [...new Set(usages.map(usage => usage.material ?? '__unreported__'))].join('; '),
    reported_material_weights_grams: JSON.stringify(job.materials.map(usage => ({
      material: usage.material,
      estimatedWeightGrams: typeof usage.estimatedWeightGrams === 'number'
        && Number.isFinite(usage.estimatedWeightGrams) && usage.estimatedWeightGrams >= 0
        ? usage.estimatedWeightGrams : null,
    }))),
    unreported_material: Number(usages.some(usage => usage.material === null)),
    material_weight_known_entries: usages.filter(usage => usage.estimatedWeightGrams !== null).length,
    material_weight_missing_entries: usages.filter(usage => usage.estimatedWeightGrams === null).length,
  }
}

/** A single header per file; record_type separates metadata, measures and kind-specific rows. */
export function elementCsv(
  report: ElementReport, allFilteredJobs: readonly ElementJob[], kind: 'jobs' | 'materials' | 'summary',
): string {
  if (!['jobs', 'materials', 'summary'].includes(kind)) {
    throw ApiError.badRequest('CSV kind must be jobs, materials or summary.', { field: 'kind' })
  }
  const jobs = exportJobs(report, allFilteredJobs)
  const columns = [...COMMON_COLUMNS, ...(kind === 'jobs' ? JOB_COLUMNS
    : kind === 'materials' ? MATERIAL_COLUMNS : ['from_date_inclusive', 'to_date_inclusive'])]
  const records = commonRecords(report)
  if (kind === 'jobs') records.push(...materialMetricRecords(report), ...jobs.map(job => jobRecord(report, job)))
  else if (kind === 'materials') records.push(...report.materials.map(materialRecord))
  else {
    records.push(...materialMetricRecords(report))
    for (const bucket of report.trend) {
      records.push(...totalRecords(bucket.totals, 'trend', bucket.key).map(row => ({
        ...row, from_date_inclusive: bucket.from, to_date_inclusive: bucket.to,
      })))
    }
  }
  return [
    columns.map(csvCell).join(','),
    ...records.map(record => columns.map(column => csvCell(record[column] ?? null)).join(',')),
  ].join('\r\n') + '\r\n'
}

function html(value: Cell | undefined): string {
  return String(value ?? 'Unavailable').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
}

const displayNumber = new Intl.NumberFormat('en', { maximumFractionDigits: 3 })

function numeric(value: number | null): string {
  return value === null ? 'Unavailable' : displayNumber.format(value)
}

function measured(value: ElementMeasure): string {
  return `${html(numeric(value.value))}<small>${value.known} known · ${value.missing} missing</small>`
}

function table(headers: readonly string[], rows: readonly string[][], caption: string): string {
  return `<table><caption>${html(caption)}</caption><thead><tr>${headers.map(header =>
    `<th scope="col">${html(header)}</th>`).join('')}</tr></thead><tbody>${rows.length
    ? rows.map(row => `<tr>${row.map((cell, index) => index === 0
      ? `<th scope="row">${cell}</th>` : `<td>${cell}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}">No records in this scope.</td></tr>`
  }</tbody></table>`
}

function jobLabel(job: ElementJob): string {
  return `${html(job.title ?? 'Untitled job')}<small>ID: ${html(job.id)}</small>`
}

function printerLabel(report: ElementReport, connectionId: string): string {
  const connection = report.connections.find(item => item.id === connectionId)
  return `${html(connection?.printerName ?? 'Unreported printer')}<small>Connection: ${html(connectionId)}</small>`
}

export function elementPrintableHtml(report: ElementReport, allFilteredJobs: readonly ElementJob[]): string {
  const jobs = exportJobs(report, allFilteredJobs)
  const localTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: report.filters.timeZone, dateStyle: 'medium', timeStyle: 'long',
  })
  const scope = [
    ['From (inclusive)', report.filters.from ?? 'All recorded start dates'],
    ['To (inclusive)', report.filters.to ?? 'No upper date bound'],
    ['Calendar time zone', report.filters.timeZone],
    ['Connection', report.filters.connectionId ?? 'All supplied connections'],
    ['Material', report.filters.material === '__unreported__' ? 'Unreported material'
      : report.filters.material ?? 'All materials'],
    ['Result', report.filters.result],
    ['Search', report.filters.search || 'No search filter'],
    ['Trend grain', report.filters.grain === 'week' ? 'Week (Monday start)' : report.filters.grain],
    ['Job order', report.filters.sort],
    ['Exported jobs', `${jobs.length}; all filtered pages`],
  ]
  const results = table(['Result', 'Jobs'], [
    ['Completed', String(report.totals.results.completed)],
    ['Failed / aborted', String(report.totals.results.failed_or_aborted)],
    ['Active', String(report.totals.results.active)],
    ['Unknown', String(report.totals.results.unknown)],
    ['Total', String(report.totals.jobs)],
  ], 'Job results — unknown statuses remain unknown')
  const totals = table(['Measure', 'Value', 'Unit', 'Known', 'Missing'],
    MEASURES.map(item => {
      const value = report.totals[item.key]
      return [html(item.label), html(numeric(value.value)), item.unit, String(value.known), String(value.missing)]
    }), 'Known contributions are summed without replacing missing values with zero')
  const missing = table(['Coverage within the filtered jobs', 'Jobs'], [
    ['Unreported length unit (including unavailable length)', String(report.totals.unreportedLengthUnitJobs)],
    ['Containing unreported material', String(report.totals.unreportedMaterialJobs)],
    ['Undated / invalid start', String(report.totals.undatedJobs)],
    ['Material mapping / task weight discrepancy', String(report.materialWeightDiscrepancyJobs)],
  ], 'Missing data and mapping discrepancies')
  const trend = table([
    'Start-date bucket', 'Jobs', 'Completed / Failed / Active / Unknown', 'Actual elapsed (s)', 'Full-slice estimate (s)',
  ], report.trend.map(bucket => [
    bucket.key === 'undated' ? 'Undated' : `${html(bucket.from)} – ${html(bucket.to)}`,
    String(bucket.totals.jobs),
    `${bucket.totals.results.completed} / ${bucket.totals.results.failed_or_aborted} / ${bucket.totals.results.active} / ${bucket.totals.results.unknown}`,
    measured(bucket.totals.actualDurationSeconds), measured(bucket.totals.estimatedDurationSeconds),
  ]), `Entire runtime attributed to the start-date bucket in ${report.filters.timeZone}; not occupancy within the bucket`)
  const materials = table([
    'Material', 'Jobs', 'Completed estimate (g)', 'Failed / aborted FULL estimate (g)', 'Active / unknown FULL estimate (g)',
  ], report.materials.map(row => [
    html(row.material ?? 'Unreported material'), String(row.jobs), measured(row.completedWeightGrams),
    measured(row.failedOrAbortedWeightGrams), measured(row.otherWeightGrams),
  ]), 'Reported material weights; job counts deduplicate slots, known/missing counts refer to mapping entries')
  const timing = table([
    'Job', 'Printer', 'Result / raw status', `Start / end (${report.filters.timeZone})`,
    'Actual elapsed (s)', 'Full-slice estimate (s)',
  ], jobs.map(job => {
    const values = elementJobValues(job)
    const start = values.startedAt === null ? 'Unavailable' : localTime.format(values.startedAt)
    const end = values.endedAt === null ? 'Unavailable' : localTime.format(values.endedAt)
    return [
      jobLabel(job), printerLabel(report, job.connectionId),
      `${html(values.result)}<small>Raw status: ${html(job.rawStatus)}</small>`,
      `${html(start)}<small>End: ${html(end)}</small><small>Reported start: ${html(job.startedAt)}<br>Reported end: ${html(job.endedAt)}</small>`,
      `${html(numeric(values.actualDurationSeconds))}<small>Reported duration: ${html(numeric(values.reportedActualDurationSeconds))} s</small>`,
      html(numeric(values.estimatedDurationSeconds)),
    ]
  }), 'All filtered jobs, in the selected order; reported timestamps and duration are retained separately')
  const filament = table([
    'Job', 'Result', 'FULL-job estimate (g)', 'Reported length / unit', 'Compatible length (m)', 'Material estimates (g)',
  ], jobs.map(job => {
    const values = elementJobValues(job)
    return [
      jobLabel(job), html(values.result), html(numeric(values.estimatedWeightGrams)),
      `${html(numeric(values.estimatedLength))}<small>Unit: ${html(values.lengthUnit ?? 'unknown')}</small>`,
      html(numeric(values.estimatedLengthMeters)),
      elementMaterialValues(job).map(usage =>
        `${html(usage.material ?? 'Unreported material')}: ${html(numeric(usage.estimatedWeightGrams))}`).join('<br>')
        + (!job.materials.length ? '<small>No mappings: task estimate shown once as unreported material.</small>' : ''),
    ]
  }), 'Full-job estimates are not measured consumption; failed/aborted estimates are not waste')
  const coverage = table([
    'Printer', 'Recorded / undated jobs', 'Job / recording range', 'Available cloud pages', 'Sync freshness', 'Potential gaps',
  ], report.coverage
    .filter(item => report.filters.connectionId === null || item.connectionId === report.filters.connectionId)
    .map(item => [
      printerLabel(report, item.connectionId),
      `${html(item.jobCount)}<small>Undated: ${html(item.undatedJobs)}</small>`,
      `${html(item.earliestJobAt)} – ${html(item.latestJobAt)}<small>Recorded: ${html(item.firstRecordedAt)} – ${html(item.lastRecordedAt)}</small>`,
      `${html(item.sync.backfillPages)} observed<small>Available-page backfill: ${item.sync.backfillComplete ? 'complete' : 'not complete'}</small><small>Started: ${html(item.sync.backfillStartedAt)}<br>Completed: ${html(item.sync.backfillCompletedAt)}</small>`,
      `Last success: ${html(item.sync.lastSuccessAt)}<small>Last attempt: ${html(item.sync.lastAttemptAt)}<br>Last full scan: ${html(item.sync.lastFullScanAt)}</small>`,
      `Gap-free history not established<small>Consecutive failures: ${html(item.sync.consecutiveFailures)}<br>Problem code: ${html(item.sync.problem?.code ?? 'None reported')}</small>`,
    ]), 'Whole-connection cloud recording coverage, not restricted by date, material, result or search filters')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>EL-ement Statistics — print report</title>
<style>
@page { size: A4 landscape; margin: 12mm; }
* { box-sizing: border-box; }
body { margin: 0 auto; padding: 24px; max-width: 1400px; color: #18212b; background: #fff; font: 15px/1.45 system-ui, sans-serif; }
h1 { margin-bottom: .25em; font-size: 2rem; }
h2 { margin: 1.5em 0 .5em; font-size: 1.35rem; break-after: avoid; }
p, li, dd, th, td { overflow-wrap: anywhere; }
.scope { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 24px; }
.scope div { min-width: 0; }
dt { font-weight: 650; }
dd { margin: 0; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 1em 0; }
caption { text-align: left; font-weight: 600; margin: .5em 0; }
th, td { padding: .55em; border: 1px solid #bbc4ce; text-align: left; vertical-align: top; white-space: normal; }
thead th { background: #edf1f5; }
tbody th { font-weight: 500; }
small { display: block; margin-top: .3em; font-size: .85em; color: #3f4b58; }
li { margin-bottom: .5em; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
@media print {
  body { padding: 0; max-width: none; font-size: 10pt; }
  h1 { font-size: 20pt; } h2 { font-size: 14pt; }
  table { break-inside: auto; }
}
@media screen and (max-width: 600px) { body { padding: 12px; } .scope { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header><h1>EL-ement Statistics</h1><p>Recorded cloud-job report · generated ${html(report.generatedAt)}</p></header>
<main>
<section aria-labelledby="scope"><h2 id="scope">Report scope</h2>
<dl class="scope">${scope.map(([label, value]) => `<div><dt>${html(label)}</dt><dd>${html(value)}</dd></div>`).join('')}</dl>
<p>Material selection includes whole jobs and all their materials. Date bounds select the job’s start date. This report includes all filtered pages, not only the visible jobs table.</p></section>
<section aria-labelledby="summary"><h2 id="summary">Results and estimates</h2>${results}${totals}${missing}</section>
<section aria-labelledby="trend"><h2 id="trend">Printing-time and result trend</h2>${trend}</section>
<section aria-labelledby="materials"><h2 id="materials">Material breakdown</h2>${materials}</section>
<section aria-labelledby="jobs"><h2 id="jobs">Jobs — timing and results</h2>${timing}</section>
<section aria-labelledby="filament"><h2 id="filament">Jobs — filament estimates</h2>${filament}</section>
<section aria-labelledby="coverage"><h2 id="coverage">Recording coverage and potential gaps</h2>
<p>Backfill completion means available cloud pages were observed. It does not establish lifetime completeness, continuous recording, or capture of all local/offline jobs.</p>${coverage}</section>
<section aria-labelledby="assumptions"><h2 id="assumptions">Definitions and limitations</h2>
<p>Display values are rounded to at most three decimal places. CSV measurements and aggregation retain numeric precision. Unavailable does not mean zero.</p>
<ol>${report.assumptions.map(assumption => `<li>${html(assumption)}</li>`).join('')}</ol></section>
</main>
</body>
</html>`
}
