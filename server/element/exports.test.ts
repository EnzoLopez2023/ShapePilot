import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import type {
  ElementConnection, ElementCoverage, ElementJob, ElementMaterialUsage, ElementReport,
} from '../../lib/contracts/elementStatistics.ts'
import { ApiError } from '../errors/ApiError.ts'
import { elementCsv, elementPrintableHtml } from './exports.ts'
import { createElementReport, filteredElementJobs, parseElementQuery } from './reporting.ts'

const NOW = new Date('2026-03-15T12:00:00.000Z')
const PRIVATE = 'SYNTHETIC_PRIVATE_MARKER_NOT_A_CREDENTIAL'

function usage(material: string | null, estimatedWeightGrams: number | null): ElementMaterialUsage {
  return {
    material, estimatedWeightGrams, filamentId: null, color: null,
    nozzleId: null, amsId: null, slotId: null,
  }
}

function job(id: string, overrides: Partial<ElementJob> = {}): ElementJob {
  return {
    id, connectionId: 'c1', title: 'Gear', result: 'unknown', rawStatus: null,
    startedAt: null, endedAt: null, actualDurationSeconds: null, estimatedDurationSeconds: null,
    estimatedWeightGrams: null, estimatedLength: null, lengthUnit: null,
    materials: [], warnings: [], firstSeenAt: NOW.toISOString(), lastSeenAt: NOW.toISOString(),
    ...overrides,
  }
}

function connection(id = 'c1', printerName = 'Printer One'): ElementConnection {
  return {
    id, accountId: PRIVATE, accountName: PRIVATE, region: 'global',
    printerId: 'printer', printerName, printerModel: null,
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  }
}

function coverage(connectionId = 'c1'): ElementCoverage {
  return {
    connectionId, jobCount: 500, earliestJobAt: '2025-01-01T12:00:00Z',
    latestJobAt: NOW.toISOString(), firstRecordedAt: '2026-03-01T01:00:00Z',
    lastRecordedAt: NOW.toISOString(), undatedJobs: 2,
    sync: {
      connectionId, backfillCursor: PRIVATE, backfillComplete: true,
      backfillStartedAt: '2026-03-01T01:00:00Z', backfillCompletedAt: '2026-03-03T01:00:00Z',
      backfillPages: 8, backfillSeenCursors: [PRIVATE], refreshCursor: PRIVATE,
      refreshBoundary: PRIVATE, refreshSeenCursors: [PRIVATE], lastAttemptAt: NOW.toISOString(),
      lastSuccessAt: '2026-03-14T10:00:00Z', lastFullScanAt: '2026-03-10T10:00:00Z', nextSyncAt: null,
      consecutiveFailures: 2, remoteTotal: null, problem: { code: 'sync_unavailable', message: PRIVATE },
    },
  }
}

function report(jobs: readonly ElementJob[], input: Record<string, unknown> = {}): ElementReport {
  return createElementReport(jobs, [connection()], [coverage()], parseElementQuery(input), NOW)
}

function readCsv(source: string): { columns: string[]; rows: Record<string, string>[] } {
  const records: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"'
        index++
      } else quoted = !quoted
    } else if (!quoted && character === ',') {
      row.push(field)
      field = ''
    } else if (!quoted && character === '\r' && source[index + 1] === '\n') {
      row.push(field)
      records.push(row)
      row = []
      field = ''
      index++
    } else field += character
  }
  assert.equal(quoted, false, 'CSV quotes must be balanced')
  assert.equal(field, '', 'CSV ends with a complete CRLF-terminated row')
  assert.deepEqual(row, [])
  const columns = records.shift()!
  assert.equal(new Set(columns).size, columns.length, 'CSV columns have unique names')
  return {
    columns,
    rows: records.map(record => {
      assert.equal(record.length, columns.length, 'Every CSV record uses the same rectangular schema')
      return Object.fromEntries(columns.map((column, index) => [column, record[index]]))
    }),
  }
}

function fixture(): { jobs: ElementJob[]; result: ElementReport } {
  const jobs = [
    job('complete', {
      result: 'completed', rawStatus: 'FINISHED',
      startedAt: '2026-03-01T23:30:00-05:00', endedAt: '2026-03-02T00:00:00-05:00',
      actualDurationSeconds: 9000, estimatedDurationSeconds: 7200, estimatedWeightGrams: 100,
      estimatedLength: 1000, lengthUnit: 'mm', materials: [usage('PLA', 70), usage('PETG', 20)],
    }),
    job('aborted', {
      result: 'failed_or_aborted', rawStatus: 'ABORTED',
      startedAt: '2026-03-02T12:00:00-05:00', endedAt: '2026-03-02T12:10:00-05:00',
      estimatedDurationSeconds: 6000, estimatedWeightGrams: 60,
      estimatedLength: 2, lengthUnit: 'm', materials: [usage('PLA', 60)],
    }),
    job('unknown', {
      rawStatus: 'VENDOR_NEW_STATUS', startedAt: '2026-03-02T13:00:00-05:00',
      estimatedLength: 7, materials: [usage('PLA', null)],
    }),
    job('undated', { materials: [usage('PLA', 1)] }),
    job('outside-scope', {
      connectionId: 'c2', title: 'OUTSIDE_SCOPE_NAME', estimatedWeightGrams: 999999,
      startedAt: '2026-03-02T12:00:00Z', materials: [usage('ABS', 999999)],
    }),
  ]
  const result = createElementReport(jobs,
    [connection(), connection('c2', 'OUTSIDE_SCOPE_PRINTER')], [coverage(), coverage('c2')], parseElementQuery({
      from: '2026-03-01', to: '2026-03-02', timeZone: 'America/New_York',
      connectionId: 'c1', material: 'pla', search: 'Gear', sort: 'weight_desc', page: 1, pageSize: 1,
    }), NOW)
  return { jobs, result }
}

describe('scoped, rectangular CSV exports', () => {
  test.each(['jobs', 'materials', 'summary'] as const)('%s CSV contains scope, results, missing counts, coverage and assumptions', kind => {
    const { jobs, result } = fixture()
    const source = elementCsv(result, jobs, kind)
    const { rows } = readCsv(source)
    const metadata = (key: string) => rows.find(row => row.section === 'scope' && row.key === key)?.value
    assert.equal(metadata('generated_at_utc'), NOW.toISOString())
    assert.equal(metadata('from_date_inclusive'), '2026-03-01')
    assert.equal(metadata('to_date_inclusive'), '2026-03-02')
    assert.equal(metadata('time_zone'), 'America/New_York')
    assert.equal(metadata('connection_filter'), 'c1')
    assert.equal(metadata('material_filter'), 'PLA')
    assert.equal(metadata('search_filter'), 'Gear')
    assert.equal(metadata('sort'), 'weight_desc')
    assert.match(metadata('material_filter_meaning')!, /Whole jobs.*all their materials/)
    assert.match(metadata('export_scope')!, /All filtered jobs/)
    assert.match(metadata('runtime_meaning')!, /not bucket occupancy/)
    const metric = (name: string) => rows.find(row => row.section === 'totals' && row.metric === name)!
    assert.equal(metric('jobs').value, '3')
    assert.equal(metric('completed_jobs').value, '1')
    assert.equal(metric('failed_or_aborted_jobs').value, '1')
    assert.equal(metric('active_jobs').value, '0')
    assert.equal(metric('unknown_jobs').value, '1')
    assert.equal(metric('actual_elapsed_seconds').value, '2400')
    assert.equal(metric('actual_elapsed_seconds').known, '2')
    assert.equal(metric('actual_elapsed_seconds').missing, '1')
    assert.equal(metric('full_slice_estimated_seconds').value, '13200')
    assert.equal(metric('failed_or_aborted_full_job_estimated_grams').value, '60')
    assert.equal(metric('active_or_unknown_full_job_estimated_grams').value, '')
    assert.equal(metric('active_or_unknown_full_job_estimated_grams').known, '0')
    assert.equal(metric('active_or_unknown_full_job_estimated_grams').missing, '1')
    assert.equal(metric('compatible_estimated_length_meters').unit, 'm')
    assert.equal(metric('compatible_estimated_length_meters').value, '3')
    assert.equal(metric('unreported_length_unit_jobs').value, '1')
    assert.equal(metric('material_weight_discrepancy_jobs').value, '1')
    assert.equal(rows.find(row => row.section === 'coverage' && row.metric === 'recorded_jobs')?.value, '500')
    assert.equal(rows.find(row => row.section === 'coverage' && row.metric === 'last_sync_success_at')?.value,
      '2026-03-14T10:00:00Z')
    assert.equal(rows.find(row => row.section === 'coverage' && row.metric === 'consecutive_sync_failures')?.value, '2')
    assert.equal(rows.find(row => row.section === 'coverage' && row.metric === 'available_cloud_backfill_complete')?.value, 'true')
    assert.match(rows.filter(row => row.record_type === 'assumption').map(row => row.value).join('\n'),
      /1 otherwise-matching undated jobs were excluded/)
    assert.ok(!source.includes(PRIVATE))
    assert.ok(!source.includes('OUTSIDE_SCOPE_NAME'))
    assert.ok(!source.includes('OUTSIDE_SCOPE_PRINTER'))
    assert.ok(!source.includes('999999'))
  })

  test('jobs CSV exports all filtered pages in exactly the selected order and preserves canonical versus reported values', () => {
    const { jobs, result } = fixture()
    assert.deepEqual(result.jobs.items.map(value => value.id), ['aborted'])
    const { rows } = readCsv(elementCsv(result, [...jobs].reverse(), 'jobs'))
    const exported = rows.filter(row => row.record_type === 'job')
    assert.deepEqual(exported.map(row => row.job_id), ['complete', 'aborted', 'unknown'])
    assert.equal(exported[0].actual_elapsed_seconds, '1800')
    assert.equal(exported[0].reported_actual_duration_seconds, '9000')
    assert.equal(exported[0].full_slice_estimated_seconds, '7200')
    assert.equal(exported[0].full_job_estimated_grams, '100')
    assert.equal(exported[0].completed_estimated_grams, '100')
    assert.equal(exported[0].reported_started_at, '2026-03-01T23:30:00-05:00')
    assert.equal(exported[0].reported_estimated_length, '1000')
    assert.equal(exported[0].reported_length_unit, 'mm')
    assert.equal(exported[0].compatible_estimated_length_meters, '1')
    assert.equal(exported[0].material_names, 'PLA; PETG')
    assert.deepEqual(JSON.parse(exported[0].reported_material_weights_grams), [
      { material: 'PLA', estimatedWeightGrams: 70 }, { material: 'PETG', estimatedWeightGrams: 20 },
    ])
    assert.equal(exported[1].actual_elapsed_seconds, '600')
    assert.equal(exported[1].failed_or_aborted_full_job_estimated_grams, '60')
    assert.equal(exported[1].raw_status, 'ABORTED')
    assert.equal(exported[2].result, 'unknown')
    assert.equal(exported[2].raw_status, 'VENDOR_NEW_STATUS')
    assert.equal(exported[2].actual_elapsed_seconds, '')
    assert.equal(exported[2].full_job_estimated_grams, '')
    assert.equal(exported[2].actual_elapsed_missing, '1')
    assert.equal(exported[2].reported_estimated_length, '7')
    assert.equal(exported[2].reported_length_unit, 'unknown')
    assert.equal(exported[2].compatible_estimated_length_meters, '')
    assert.equal(exported[2].compatible_length_missing, '1')
    assert.equal(exported[2].material_weight_missing_entries, '1')
  })

  test('materials CSV retains whole-job materials, slot missing counts and differences from task totals', () => {
    const { jobs, result } = fixture()
    const { rows } = readCsv(elementCsv(result, jobs, 'materials'))
    const materials = rows.filter(row => row.record_type === 'material')
    assert.deepEqual(materials.map(row => row.material), ['PETG', 'PLA'])
    const pla = materials.find(row => row.material === 'PLA')!
    assert.equal(pla.jobs, '3')
    assert.equal(pla.completed_estimated_grams, '70')
    assert.equal(pla.completed_weight_known_entries, '1')
    assert.equal(pla.failed_or_aborted_full_job_estimated_grams, '60')
    assert.equal(pla.active_or_unknown_full_job_estimated_grams, '')
    assert.equal(pla.other_weight_known_entries, '0')
    assert.equal(pla.other_weight_missing_entries, '1')
    assert.equal(materials.find(row => row.material === 'PETG')?.completed_estimated_grams, '20')
    assert.ok(!rows.some(row => row.record_type === 'job'))
  })

  test('summary CSV exposes the exact trend totals and intersected date bounds for drilldown', () => {
    const { jobs, result } = fixture()
    const { rows } = readCsv(elementCsv(result, jobs, 'summary'))
    const trends = rows.filter(row => row.section === 'trend')
    for (const bucket of result.trend) {
      const bucketRows = trends.filter(row => row.key === bucket.key)
      assert.equal(bucketRows.find(row => row.metric === 'jobs')?.value, String(bucket.totals.jobs))
      const runtime = bucketRows.find(row => row.metric === 'actual_elapsed_seconds')!
      assert.equal(runtime.value, String(bucket.totals.actualDurationSeconds.value))
      assert.equal(runtime.known, String(bucket.totals.actualDurationSeconds.known))
      assert.equal(runtime.missing, String(bucket.totals.actualDurationSeconds.missing))
      assert.equal(runtime.from_date_inclusive, bucket.from)
      assert.equal(runtime.to_date_inclusive, bucket.to)
    }
    assert.equal(trends.filter(row => row.metric === 'actual_elapsed_seconds')
      .reduce((sum, row) => sum + Number(row.value), 0), result.totals.actualDurationSeconds.value)
    assert.equal(trends.filter(row => row.metric === 'jobs')
      .reduce((sum, row) => sum + Number(row.value), 0), result.totals.jobs)
    assert.equal(rows.find(row => row.section === 'materials' && row.key === 'PETG'
      && row.metric === 'completed_estimated_grams')?.value, '20')
    assert.ok(!rows.some(row => row.record_type === 'job'))
  })

  test('undated records and missing material have explicit export keys, never an invented date', () => {
    const jobs = [job('undated', { estimatedWeightGrams: 5 })]
    const result = report(jobs)
    const summary = readCsv(elementCsv(result, jobs, 'summary')).rows
    const bucket = summary.find(row => row.section === 'trend' && row.metric === 'jobs')!
    assert.equal(bucket.key, 'undated')
    assert.equal(bucket.from_date_inclusive, '')
    assert.equal(bucket.to_date_inclusive, '')
    const material = readCsv(elementCsv(result, jobs, 'materials')).rows.find(row => row.record_type === 'material')!
    assert.equal(material.material, '')
    assert.equal(material.material_filter_value, '__unreported__')
    assert.equal(material.active_or_unknown_full_job_estimated_grams, '5')
    const exported = readCsv(elementCsv(result, jobs, 'jobs')).rows.find(row => row.record_type === 'job')!
    assert.equal(exported.reported_started_at, '')
    assert.equal(exported.reported_material_weights_grams, '[]')
    assert.equal(exported.unreported_material, '1')
    assert.equal(exported.material_weight_known_entries, '1')
  })

  test.each(['jobs', 'materials', 'summary'] as const)('no-data %s CSV still has scope and honest null measures', kind => {
    const result = report([], { from: '2026-03-01', to: '2026-03-03' })
    const { rows } = readCsv(elementCsv(result, [], kind))
    assert.equal(rows.find(row => row.section === 'scope' && row.key === 'time_zone')?.value, 'UTC')
    assert.equal(rows.find(row => row.section === 'totals' && row.metric === 'jobs')?.value, '0')
    const value = rows.find(row => row.section === 'totals' && row.metric === 'actual_elapsed_seconds')!
    assert.equal(value.value, '')
    assert.equal(value.known, '0')
    assert.equal(value.missing, '0')
    assert.equal(rows.filter(row => row.record_type === 'job' || row.record_type === 'material').length, 0)
    if (kind === 'summary') {
      assert.equal(rows.filter(row => row.section === 'trend' && row.metric === 'jobs').length, 3)
    }
  })

  test('does not round measured values in CSV and distinguishes explicit zero from unavailable', () => {
    const jobs = [job('precise', {
      estimatedWeightGrams: 0.123456789, estimatedDurationSeconds: 0,
      estimatedLength: 0.123456789, lengthUnit: 'm',
    })]
    const rows = readCsv(elementCsv(report(jobs), jobs, 'jobs')).rows
    const exported = rows.find(row => row.record_type === 'job')!
    assert.equal(exported.full_job_estimated_grams, '0.123456789')
    assert.equal(exported.full_slice_estimated_seconds, '0')
    assert.equal(exported.full_slice_estimate_missing, '0')
    assert.equal(exported.actual_elapsed_seconds, '')
    assert.equal(exported.compatible_estimated_length_meters, '0.123456789')
  })

  test('CSV and print use shared elapsed eligibility and carry omission/invalidation provenance caveats', () => {
    const times = {
      startedAt: '2026-03-01T12:00:00Z', endedAt: '2026-03-01T13:00:00Z',
      actualDurationSeconds: 3600, estimatedDurationSeconds: 7200,
    }
    const jobs = [
      job('non-terminal', { ...times, result: 'active' }),
      job('short', { ...times, result: 'completed', endedAt: '2026-03-01T12:01:00Z', actualDurationSeconds: 60 }),
      job('future', { ...times, result: 'failed_or_aborted', endedAt: '2026-03-16T13:00:00Z' }),
      job('eligible', { ...times, result: 'completed', endedAt: '2026-03-01T12:02:00Z', reportedFields: ['title'] }),
    ]
    const result = report(jobs)
    assert.deepEqual(result.totals.actualDurationSeconds, { value: 120, known: 1, missing: 3 })
    const records = readCsv(elementCsv(result, jobs, 'jobs')).rows
    const total = records.find(row => row.section === 'totals' && row.metric === 'actual_elapsed_seconds')!
    assert.equal(total.value, '120')
    assert.equal(total.known, '1')
    assert.equal(total.missing, '3')
    const entries = records.filter(row => row.record_type === 'job')
    for (const entry of entries) {
      assert.equal(entry.actual_elapsed_seconds, entry.job_id === 'eligible' ? '120' : '')
      assert.equal(entry.actual_elapsed_missing, entry.job_id === 'eligible' ? '0' : '1')
    }
    assert.equal(entries.find(row => row.job_id === 'short')?.reported_actual_duration_seconds, '60')
    const assumptions = records.filter(row => row.record_type === 'assumption').map(row => row.value).join('\n')
    assert.match(assumptions, /Explicit null or invalid fields clear earlier values/)
    assert.match(assumptions, /not per-field provenance or freshness/)
    const document = elementPrintableHtml(result, jobs)
    assert.match(document, /Intervals of 60 seconds or less may be cloud placeholders/)
    assert.match(document, /lastSeenAt is the job-observation time/)
    assert.match(document, /Reported end: 2026-03-01T12:01:00Z/)
  })

  test('a paginated, stale or inconsistent dataset is refused instead of producing a misleading export', () => {
    const { jobs, result } = fixture()
    const stale = filteredElementJobs(jobs, result.filters).map(value =>
      value.id === 'complete' ? { ...value, estimatedWeightGrams: 999 } : value)
    for (const input of [result.jobs.items, stale]) {
      assert.throws(() => elementCsv(result, input, 'jobs'), error => error instanceof ApiError && error.status === 409)
      assert.throws(() => elementPrintableHtml(result, input), error => error instanceof ApiError && error.status === 409)
    }
    const corrupted = { ...result, totals: { ...result.totals, jobs: 40 } }
    assert.throws(() => elementCsv(corrupted, jobs, 'summary'), /same report snapshot/)
  })

  test('rejects unsupported CSV kinds with the existing typed error pattern', () => {
    assert.throws(() => elementCsv(report([]), [], 'anything' as 'jobs'),
      error => error instanceof ApiError && error.status === 400 && error.details?.field === 'kind')
  })
})

describe('CSV quoting, spreadsheet safety and public-field allowlisting', () => {
  test('quotes comma, quotation mark, CR and LF without changing the underlying public text', () => {
    const title = 'Gear, "quoted"\r\nnext line\nlast\rcarriage'
    const jobs = [job('quoted', { title, rawStatus: title, materials: [usage(title, 5)] })]
    const before = structuredClone(jobs)
    const source = elementCsv(report(jobs), jobs, 'jobs')
    const exported = readCsv(source).rows.find(row => row.record_type === 'job')!
    assert.equal(exported.title, title)
    assert.equal(exported.raw_status, title)
    assert.equal(JSON.parse(exported.reported_material_weights_grams)[0].material, title)
    assert.ok(source.includes('""quoted""'))
    assert.deepEqual(jobs, before)
  })

  test.each([
    '=SUM(1,2)', '+SUM(1,2)', '-1+2', '@SUM(1,2)',
    ' \t=1', '\r\n+1', '\u0000-1', '\u0001@1', '\ufeff=1', '\u200b=1', '\u2028=1',
    ' \u0007 \t =SUM(1,2)',
  ])('neutralizes formula cells even with leading whitespace/control prefixes: %j', value => {
    const jobs = [job(value, { title: value, rawStatus: value })]
    const source = elementCsv(report(jobs), jobs, 'jobs')
    const row = readCsv(source).rows.find(item => item.record_type === 'job')!
    assert.equal(row.job_id, `'${value}`)
    assert.equal(row.key, `'${value}`)
    assert.equal(row.title, `'${value}`)
    assert.equal(row.raw_status, `'${value}`)
    assert.equal(jobs[0].title, value)
  })

  test('protects metadata, connections, material names and assumptions, not only job titles', () => {
    const value = ' \t=SUM(1,2)'
    const jobs = [job('safe-id', { title: value, materials: [usage(value, 5)] })]
    const result = createElementReport(jobs, [connection('c1', value)], [], parseElementQuery({
      material: value, search: value,
    }), NOW)
    result.assumptions.push(value)
    for (const kind of ['jobs', 'materials', 'summary'] as const) {
      const rows = readCsv(elementCsv(result, jobs, kind)).rows
      assert.equal(rows.find(row => row.section === 'connections')?.value, `'${value}`)
      assert.equal(rows.find(row => row.section === 'scope' && row.key === 'search_filter')?.value, "'=SUM(1,2)")
      assert.equal(rows.find(row => row.section === 'scope' && row.key === 'material_filter')?.value, "'=SUM(1,2)")
      assert.equal(rows.filter(row => row.record_type === 'assumption').at(-1)?.value, `'${value}`)
      if (kind === 'materials') {
        assert.equal(rows.find(row => row.record_type === 'material')?.material, "'=SUM(1,2)")
      }
    }
  })

  test('exports whitelist public fields rather than stringifying job/connection/sync objects', () => {
    const jobs = [Object.assign(job('safe'), {
      rawMetadata: { secret: PRIVATE }, credential: PRIVATE, cameraUrl: PRIVATE,
    })]
    const result = report(jobs)
    Object.assign(result.connections[0], { credentials: PRIVATE, cameraUrl: PRIVATE })
    for (const kind of ['jobs', 'materials', 'summary'] as const) {
      assert.ok(!elementCsv(result, jobs, kind).includes(PRIVATE))
    }
    assert.ok(!elementPrintableHtml(result, jobs).includes(PRIVATE))
  })
})

describe('standalone, scoped and safely escaped printable reports', () => {
  test('embeds a static CSP before styles so authenticated blob documents retain their policy', () => {
    const document = elementPrintableHtml(report([]), [])
    const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">`
    assert.equal(document.split(policy).length - 1, 1)
    assert.ok(document.indexOf('<head>') < document.indexOf(policy))
    assert.ok(document.indexOf(policy) < document.indexOf('<style>'))
    assert.ok(document.indexOf(policy) < document.indexOf('</head>'))
  })

  test('includes every filtered job, results, missing counts, timing, materials and coverage, not only the page', () => {
    const { jobs, result } = fixture()
    const document = elementPrintableHtml(result, jobs)
    assert.ok(document.startsWith('<!doctype html>'))
    assert.ok(document.endsWith('</html>'))
    assert.match(document, /<html lang="en">/)
    assert.match(document, /<meta charset="utf-8">/)
    assert.match(document, /Report scope/)
    assert.match(document, /2026-03-01/)
    assert.match(document, /2026-03-02/)
    assert.match(document, /America\/New_York/)
    assert.match(document, /3; all filtered pages/)
    assert.match(document, /ID: complete/)
    assert.match(document, /ID: aborted/)
    assert.match(document, /ID: unknown/)
    assert.ok(!document.includes('ID: undated'))
    assert.ok(!document.includes('OUTSIDE_SCOPE'))
    assert.match(document, /2,400/)
    assert.match(document, /13,200/)
    assert.match(document, /Failed \/ aborted FULL-job filament estimate/)
    assert.match(document, /Raw status: VENDOR_NEW_STATUS/)
    assert.match(document, /Reported duration: 9,000 s/)
    assert.match(document, /Unit: unknown/)
    assert.match(document, /2 known · 0 missing|1 known · 1 missing/)
    assert.match(document, /PETG/)
    assert.match(document, /2026-03-14T10:00:00Z/)
    assert.match(document, /Consecutive failures: 2/)
    assert.match(document, /Gap-free history not established/)
    assert.match(document, /available cloud pages were observed/i)
    assert.match(document, /not an occupancy odometer/)
    assert.match(document, /not measured consumption/)
    assert.match(document, /1 otherwise-matching undated jobs were excluded/)
    assert.ok(!document.includes(PRIVATE))
  })

  test('escapes every external text field and never creates active markup or external resources', () => {
    const attack = '<img src="x" onerror="alert(1)"><script>alert("x")</script>&\''
    const jobs = [job(attack, { title: attack, rawStatus: attack, materials: [usage(attack, 1)] })]
    const result = createElementReport(jobs, [connection('c1', attack)], [coverage()], parseElementQuery({}), NOW)
    result.assumptions.push(attack)
    const document = elementPrintableHtml(result, jobs)
    assert.ok(!document.includes(attack))
    assert.ok(document.includes('&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;'))
    assert.ok(document.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;'))
    assert.ok(!/<(?:script|img|iframe|object|embed|link|video|audio|form)\b/i.test(document))
    for (const tag of document.match(/<[^>]+>/g) ?? []) {
      assert.ok(!/\b(?:src|href|onerror|onclick|onload)\s*=/i.test(tag), `No active/resource attributes: ${tag}`)
    }
    assert.ok(!/@import\b|url\s*\(/i.test(document))
  })

  test('has accessible sections and tables, repeating print headers and wrapping without clipping', () => {
    const longName = 'Very long part name '.repeat(100)
    const jobs = [job('long-name', { title: longName })]
    const document = elementPrintableHtml(report(jobs), jobs)
    assert.ok(document.includes(longName))
    assert.match(document, /overflow-wrap: anywhere/)
    assert.match(document, /white-space: normal/)
    assert.match(document, /table-layout: fixed/)
    assert.match(document, /thead \{ display: table-header-group; \}/)
    assert.match(document, /break-inside: avoid/)
    assert.match(document, /@media print/)
    assert.ok(!/overflow:\s*hidden|text-overflow:\s*ellipsis|white-space:\s*nowrap/.test(document))
    const tables = document.match(/<table>/g)?.length
    assert.equal(tables, document.match(/<caption>/g)?.length)
    assert.equal(tables, document.match(/<thead>/g)?.length)
    assert.equal(tables, document.match(/<tbody>/g)?.length)
    assert.match(document, /<th scope="col">/)
    assert.match(document, /<th scope="row">/)
    for (const id of ['scope', 'summary', 'trend', 'materials', 'jobs', 'filament', 'coverage', 'assumptions']) {
      assert.ok(document.includes(`<section aria-labelledby="${id}">`))
      assert.ok(document.includes(`<h2 id="${id}">`))
    }
  })

  test('no-data print report retains scope and explicit unavailable states without fake zeros', () => {
    const document = elementPrintableHtml(report([], { from: '2026-03-01', to: '2026-03-02' }), [])
    assert.match(document, /0; all filtered pages/)
    assert.match(document, /No records in this scope/)
    assert.match(document, /Unavailable/)
    assert.match(document, /0 known · 0 missing/)
    assert.match(document, /2026-03-01/)
    assert.match(document, /2026-03-02/)
    assert.match(document, /Unavailable does not mean zero/)
  })
})
