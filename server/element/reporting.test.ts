import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import type {
  ElementConnection, ElementCoverage, ElementJob, ElementJobResult,
  ElementMaterialUsage, ElementTotals,
} from '../../lib/contracts/elementStatistics.ts'
import { ApiError } from '../errors/ApiError.ts'
import { createElementReport, elementUtcBounds, filteredElementJobs, parseElementQuery } from './reporting.ts'

const NOW = new Date('2026-03-15T12:00:00.000Z')

function usage(material: string | null, estimatedWeightGrams: number | null): ElementMaterialUsage {
  return {
    material, estimatedWeightGrams, filamentId: null, color: null,
    nozzleId: null, amsId: null, slotId: null,
  }
}

function job(id: string, overrides: Partial<ElementJob> = {}): ElementJob {
  return {
    id, connectionId: 'c1', title: null, result: 'unknown', rawStatus: null,
    startedAt: null, endedAt: null, actualDurationSeconds: null, estimatedDurationSeconds: null,
    estimatedWeightGrams: null, estimatedLength: null, lengthUnit: null,
    materials: [], warnings: [], firstSeenAt: NOW.toISOString(), lastSeenAt: NOW.toISOString(),
    ...overrides,
  }
}

function connection(id: string): ElementConnection {
  return {
    id, accountId: 'account', accountName: 'Account', region: 'global',
    printerId: `printer-${id}`, printerName: `Printer ${id}`, printerModel: null,
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  }
}

function coverage(connectionId: string): ElementCoverage {
  return {
    connectionId, jobCount: 500, earliestJobAt: '2025-01-01T12:00:00Z',
    latestJobAt: NOW.toISOString(), firstRecordedAt: NOW.toISOString(),
    lastRecordedAt: NOW.toISOString(), undatedJobs: 2,
    sync: {
      connectionId, backfillCursor: null, backfillComplete: true,
      backfillStartedAt: NOW.toISOString(), backfillCompletedAt: NOW.toISOString(),
      backfillPages: 8, backfillSeenCursors: [], refreshCursor: null,
      refreshBoundary: null, refreshSeenCursors: [], lastAttemptAt: NOW.toISOString(),
      lastSuccessAt: NOW.toISOString(), lastFullScanAt: NOW.toISOString(), nextSyncAt: null,
      consecutiveFailures: 0, remoteTotal: null, problem: null,
    },
  }
}

function report(jobs: readonly ElementJob[], input: Record<string, unknown> = {}) {
  return createElementReport(jobs, [], [], parseElementQuery(input), NOW)
}

function badRequest(callback: () => unknown): void {
  assert.throws(callback, error => error instanceof ApiError
    && error.status === 400 && error.code === 'bad_request' && typeof error.details?.field === 'string')
}

const measureFields = [
  'actualDurationSeconds', 'estimatedDurationSeconds', 'completedWeightGrams',
  'failedOrAbortedWeightGrams', 'otherWeightGrams', 'estimatedLengthMeters',
] as const

function sumTrend(result: ReturnType<typeof report>): void {
  assert.equal(result.trend.reduce((sum, bucket) => sum + bucket.totals.jobs, 0), result.totals.jobs)
  for (const key of ['completed', 'failed_or_aborted', 'active', 'unknown'] as const) {
    assert.equal(result.trend.reduce((sum, bucket) => sum + bucket.totals.results[key], 0), result.totals.results[key])
  }
  for (const key of measureFields) {
    const aggregate = result.trend.reduce((sum, bucket) => ({
      value: sum.value + (bucket.totals[key].value ?? 0),
      known: sum.known + bucket.totals[key].known,
      missing: sum.missing + bucket.totals[key].missing,
    }), { value: 0, known: 0, missing: 0 })
    assert.deepEqual(result.totals[key], { ...aggregate, value: aggregate.known ? aggregate.value : null })
  }
}

describe('statistics query validation', () => {
  test('defaults are all recorded dates, UTC, and zero-based pagination, regardless of now', () => {
    const query = parseElementQuery({}, NOW)
    assert.deepEqual(query, {
      filters: {
        from: null, to: null, timeZone: 'UTC', connectionId: null, material: null,
        result: 'all', search: '', grain: 'day', sort: 'started_desc',
      },
      page: 0, pageSize: 25,
    })
    assert.deepEqual(query, parseElementQuery({}, new Date('2099-01-01T00:00:00Z')))
  })

  test('accepts exact calendar dates, IANA aliases, all filters and bounded integer pagination', () => {
    assert.deepEqual(parseElementQuery({
      from: '2000-02-29', to: '2000-03-01', timeZone: 'america/new_york',
      connectionId: 'c1', material: ' pla   basic ', result: 'failed_or_aborted',
      search: '  Gear  ', grain: 'week', sort: 'duration_desc', page: '2', pageSize: '100',
    }), {
      filters: {
        from: '2000-02-29', to: '2000-03-01', timeZone: 'America/New_York',
        connectionId: 'c1', material: 'PLA BASIC', result: 'failed_or_aborted',
        search: 'Gear', grain: 'week', sort: 'duration_desc',
      },
      page: 2, pageSize: 100,
    })
    assert.equal(parseElementQuery({ material: '__UNREPORTED__' }).filters.material, '__unreported__')
    assert.equal(parseElementQuery({ page: 0, pageSize: 1 }).pageSize, 1)
    assert.equal(parseElementQuery({
      connectionId: 'c'.repeat(128), material: 'P'.repeat(128), search: 's'.repeat(150),
    }).filters.search.length, 150)
  })

  test('case-expanding Unicode material names cannot create a query that fails its own normalized bounds', () => {
    const query = parseElementQuery({ material: 'ß'.repeat(64) })
    assert.equal(query.filters.material, 'SS'.repeat(64))
    assert.deepEqual(createElementReport([], [], [], query, NOW).filters, query.filters)
    badRequest(() => parseElementQuery({ material: 'ß'.repeat(65) }))
  })

  test.each([
    { unsupported: 'value' },
    { from: '' }, { from: null }, { from: '1999-12-31' }, { from: '10000-01-01' },
    { from: '2026-2-01' }, { from: '2026-02-30' }, { from: '2100-02-29' },
    { from: '2026-04-31' }, { from: '2026-00-01' }, { from: '2026-01-00' },
    { from: '2026-13-01' }, { from: '2026-03-01T00:00:00Z' }, { from: ' 2026-03-01' },
    { to: '2026-02-29' }, { from: '2026-03-02', to: '2026-03-01' },
    { timeZone: 'Not/A_Zone' }, { timeZone: '+01:00' }, { timeZone: '-0500' },
    { timeZone: ' UTC ' }, { timeZone: '' }, { timeZone: null }, { timeZone: {} },
    { connectionId: '' }, { connectionId: '   ' }, { connectionId: 'c'.repeat(129) },
    { connectionId: 12 }, { connectionId: {} }, { connectionId: null },
    { material: '' }, { material: ' ' }, { material: 'm'.repeat(129) }, { material: null },
    { result: 'success' }, { result: 'aborted' }, { result: '' }, { result: false },
    { search: 'x'.repeat(151) }, { search: null }, { search: true },
    { grain: 'hour' }, { grain: 'Week' }, { grain: '' }, { sort: 'unknown' },
    { page: -1 }, { page: 0.5 }, { page: NaN }, { page: Infinity }, { page: true },
    { page: '01' }, { page: '1e2' }, { page: '0x10' }, { page: ' 1' }, { page: '' },
    { page: '+1' }, { page: '-0' }, { page: '9007199254740992' },
    { page: Number.MAX_SAFE_INTEGER, pageSize: 100 },
    { pageSize: 0 }, { pageSize: 101 }, { pageSize: -1 }, { pageSize: '1.1' },
    { pageSize: {} }, { pageSize: null }, { pageSize: Infinity },
  ])('rejects invalid parameters with a typed 400: %j', input => {
    badRequest(() => parseElementQuery(input))
  })

  test.each([
    'from', 'to', 'timeZone', 'connectionId', 'material', 'result', 'search', 'grain', 'sort', 'page', 'pageSize',
  ])('rejects arrays/duplicate parameters even for a single %s value', key => {
    badRequest(() => parseElementQuery({ [key]: ['value'] }))
    badRequest(() => parseElementQuery({ [key]: [] }))
  })

  test('rejects malformed top-level inputs and accepts a null-prototype query object', () => {
    badRequest(() => parseElementQuery(null as unknown as Record<string, unknown>))
    badRequest(() => parseElementQuery([] as unknown as Record<string, unknown>))
    assert.equal(parseElementQuery(Object.create(null) as Record<string, unknown>).filters.timeZone, 'UTC')
  })

  test.each(['day', 'week', 'month'])('accepts the maximum supported calendar date for %s', grain => {
    const result = report([], { from: '9999-12-31', to: '9999-12-31', grain })
    assert.equal(result.trend.length, 1)
    assert.equal(result.trend[0].from, '9999-12-31')
    assert.equal(result.trend[0].to, '9999-12-31')
  })

  test('caps excessive bucket ranges without silently changing filters or grain', () => {
    const start = '2020-01-01'
    const thousandth = new Date(Date.UTC(2020, 0, 1 + 999)).toISOString().slice(0, 10)
    const extra = new Date(Date.UTC(2020, 0, 1 + 1000)).toISOString().slice(0, 10)
    assert.equal(report([], { from: start, to: thousandth }).trend.length, 1000)
    assert.throws(() => parseElementQuery({ from: start, to: extra }), /Narrow.*week or month/)
    assert.throws(() => parseElementQuery({ from: start, to: '2050-01-01', grain: 'week' }), /choose month/)
    assert.throws(() => parseElementQuery({ from: start, to: '9999-01-01', grain: 'month' }), /Narrow the date range/)
    const jobs = [
      job('early', { startedAt: '2020-01-01T12:00:00Z' }),
      job('late', { startedAt: '2026-01-01T12:00:00Z' }),
    ]
    badRequest(() => report(jobs))
    const monthly = report(jobs, { grain: 'month' })
    assert.equal(monthly.totals.jobs, 2)
    assert.equal(monthly.filters.from, null)
    assert.equal(monthly.trend.length, 73)
  })
})

describe('honest totals, material accounting and raw-data preservation', () => {
  const jobs = [
    job('complete', {
      result: 'completed', rawStatus: 'FINISHED', startedAt: '2026-03-01T12:00:00Z',
      endedAt: '2026-03-01T12:30:00Z', actualDurationSeconds: 333, estimatedDurationSeconds: 9000,
      estimatedWeightGrams: 100, estimatedLength: 1200, lengthUnit: 'mm',
      materials: [usage(' pla ', 40), usage('PLA', 10), usage('PETG', 30)],
    }),
    job('aborted', {
      result: 'failed_or_aborted', rawStatus: 'ABORTED', startedAt: '2026-03-02T00:20:00Z',
      endedAt: '2026-03-02T00:40:00Z', estimatedDurationSeconds: 7200,
      estimatedWeightGrams: 60, estimatedLength: 2, lengthUnit: 'm', materials: [usage('petg', 60)],
    }),
    job('active', {
      result: 'active', startedAt: '2026-03-03T12:00:00Z', actualDurationSeconds: 9999,
      estimatedDurationSeconds: 18000, estimatedWeightGrams: 80, estimatedLength: 100,
      materials: [usage('PLA', 80)],
    }),
    job('unknown', { rawStatus: 'SUCCEEDED', actualDurationSeconds: 456 }),
    job('zero', {
      result: 'completed', startedAt: '2026-03-04T12:00:00Z', endedAt: '2026-03-04T12:00:00Z',
      estimatedDurationSeconds: 0, estimatedWeightGrams: 0,
      estimatedLength: 0, lengthUnit: 'mm', materials: [usage('PLA', 0)],
    }),
  ]

  test('uses valid actual elapsed time, separates full-job outcome estimates, and reconciles trend totals', () => {
    const result = report(jobs)
    assert.deepEqual(result.totals, {
      jobs: 5, results: { completed: 2, failed_or_aborted: 1, active: 1, unknown: 1 },
      actualDurationSeconds: { value: 3000, known: 2, missing: 3 },
      estimatedDurationSeconds: { value: 34200, known: 4, missing: 1 },
      completedWeightGrams: { value: 100, known: 2, missing: 0 },
      failedOrAbortedWeightGrams: { value: 60, known: 1, missing: 0 },
      otherWeightGrams: { value: 80, known: 1, missing: 1 },
      estimatedLengthMeters: { value: 3.2, known: 3, missing: 2 },
      unreportedLengthUnitJobs: 2, unreportedMaterialJobs: 1, undatedJobs: 1,
    } satisfies ElementTotals)
    assert.equal(result.jobs.items.find(item => item.id === 'complete')?.actualDurationSeconds, 333)
    assert.equal(result.jobs.items.find(item => item.id === 'active')?.actualDurationSeconds, 9999)
    assert.equal(result.trend.at(-1)?.key, 'undated')
    assert.equal(result.trend.at(-1)?.from, null)
    assert.equal(result.trend.at(-1)?.to, null)
    sumTrend(result)
  })

  test('deduplicates material jobs but counts each reported mapping contribution and never scales mismatches', () => {
    const result = report(jobs)
    assert.equal(result.materialWeightDiscrepancyJobs, 1)
    assert.deepEqual(result.materials.find(row => row.material === 'PLA'), {
      material: 'PLA', jobs: 3,
      results: { completed: 2, failed_or_aborted: 0, active: 1, unknown: 0 },
      completedWeightGrams: { value: 50, known: 3, missing: 0 },
      failedOrAbortedWeightGrams: { value: null, known: 0, missing: 0 },
      otherWeightGrams: { value: 80, known: 1, missing: 0 },
    })
    assert.deepEqual(result.materials.find(row => row.material === 'PETG'), {
      material: 'PETG', jobs: 2,
      results: { completed: 1, failed_or_aborted: 1, active: 0, unknown: 0 },
      completedWeightGrams: { value: 30, known: 1, missing: 0 },
      failedOrAbortedWeightGrams: { value: 60, known: 1, missing: 0 },
      otherWeightGrams: { value: null, known: 0, missing: 0 },
    })
    assert.deepEqual(result.materials.at(-1)?.otherWeightGrams, { value: null, known: 0, missing: 1 })
    assert.match(result.assumptions.join('\n'), /20 g are unallocated/)
    assert.match(result.assumptions.join('\n'), /not assigned to a material/)
  })

  test('a material filter selects complete jobs, and choices can switch away from that material', () => {
    const result = report(jobs, { material: 'pla' })
    assert.equal(result.totals.jobs, 3)
    assert.equal(result.totals.completedWeightGrams.value, 100)
    assert.equal(result.materials.find(row => row.material === 'PETG')?.completedWeightGrams.value, 30)
    assert.deepEqual(result.availableMaterials, ['PETG', 'PLA', '__unreported__'])
    assert.match(result.assumptions.join('\n'), /whole jobs.*ALL materials/)
    const missing = report(jobs, { material: '__unreported__' })
    assert.deepEqual(missing.jobs.items.map(item => item.id), ['unknown'])
    assert.equal(missing.totals.results.unknown, 1)
    assert.equal(missing.totals.otherWeightGrams.value, null)
  })

  test('unknown result and raw statuses do not become completed or failed', () => {
    const result = report([
      job('status', { result: 'unknown', rawStatus: 'completed' }),
      job('unexpected', { result: 'NEW_VENDOR_STATE' as ElementJobResult, rawStatus: 'ABORTED' }),
    ])
    assert.deepEqual(result.totals.results, { completed: 0, failed_or_aborted: 0, active: 0, unknown: 2 })
    assert.equal(result.jobs.items[0].rawStatus, 'completed')
    assert.equal(report(jobs, { result: 'completed' }).totals.jobs, 2)
  })

  test('zero is only an explicitly known zero, not an empty or missing measurement', () => {
    const empty = report([])
    for (const key of measureFields) assert.deepEqual(empty.totals[key], { value: null, known: 0, missing: 0 })
    assert.equal(empty.totals.jobs, 0)
    assert.deepEqual(empty.trend, [])
    assert.deepEqual(empty.materials, [])
    assert.deepEqual(report([job('missing')]).totals.otherWeightGrams, { value: null, known: 0, missing: 1 })
    const zero = report([jobs[4]])
    assert.deepEqual(zero.totals.actualDurationSeconds, { value: null, known: 0, missing: 1 })
    assert.deepEqual(zero.totals.estimatedDurationSeconds, { value: 0, known: 1, missing: 0 })
    assert.deepEqual(zero.totals.completedWeightGrams, { value: 0, known: 1, missing: 0 })
    assert.deepEqual(zero.totals.failedOrAbortedWeightGrams, { value: null, known: 0, missing: 0 })
    assert.deepEqual(zero.totals.estimatedLengthMeters, { value: 0, known: 1, missing: 0 })
  })

  test('empty bounded ranges keep empty calendar buckets with unavailable measures', () => {
    const result = report([], { from: '2026-03-01', to: '2026-03-03' })
    assert.deepEqual(result.trend.map(bucket => bucket.key), ['2026-03-01', '2026-03-02', '2026-03-03'])
    for (const bucket of result.trend) {
      assert.equal(bucket.totals.jobs, 0)
      assert.deepEqual(bucket.totals.actualDurationSeconds, { value: null, known: 0, missing: 0 })
    }
    sumTrend(result)
  })

  test.each([
    [null, '2026-03-01T12:00:00Z'],
    ['2026-03-01T12:00:00Z', null],
    ['2026-03-01T12:00:00Z', '2026-03-01T11:59:59Z'],
    ['2026-03-01', '2026-03-01T12:00:00Z'],
    ['2026-03-01T11:00:00', '2026-03-01T12:00:00Z'],
    ['2026-02-30T11:00:00Z', '2026-03-02T12:00:00Z'],
    ['2026-03-01T24:00:00Z', '2026-03-02T12:00:00Z'],
    ['not-a-date', '2026-03-01T12:00:00Z'],
    ['2026-03-01T12:00:00Z', '2026-03-01T13:00:00+25:00'],
  ])('never fills missing/invalid runtime from sliced or reported durations: %s / %s', (startedAt, endedAt) => {
    const result = report([job('pair', {
      result: 'completed', startedAt, endedAt, actualDurationSeconds: 900, estimatedDurationSeconds: 1200,
    })])
    assert.deepEqual(result.totals.actualDurationSeconds, { value: null, known: 0, missing: 1 })
    assert.equal(result.totals.estimatedDurationSeconds.value, 1200)
    assert.equal(result.jobs.items[0].actualDurationSeconds, 900)
  })

  test('a material carries its jobs by outcome, counting a job once per material', () => {
    const rows = report([
      job('a', { result: 'completed', materials: [usage('PLA', 10)] }),
      job('b', { result: 'failed_or_aborted', materials: [usage('PLA', 20)] }),
      // Two mappings of the same material are one job for that material.
      job('c', { result: 'completed', materials: [usage('PLA', 5), usage('PLA', 5)] }),
      // A multi-material job counts under each of them.
      job('d', { result: 'completed', materials: [usage('PLA', 5), usage('PETG', 5)] }),
      job('e', { result: 'active', materials: [usage('PETG', 5)] }),
    ]).materials
    const pla = rows.find(row => row.material === 'PLA')!
    const petg = rows.find(row => row.material === 'PETG')!
    assert.equal(pla.jobs, 4)
    assert.deepEqual(pla.results, { completed: 3, failed_or_aborted: 1, active: 0, unknown: 0 })
    assert.equal(petg.jobs, 2)
    assert.deepEqual(petg.results, { completed: 1, failed_or_aborted: 0, active: 1, unknown: 0 })
    // Outcomes account for exactly the jobs the row claims.
    for (const row of rows) {
      const counted = Object.values(row.results).reduce((sum, value) => sum + value, 0)
      assert.equal(counted, row.jobs)
    }
  })

  test.each([null, NaN, Infinity, -Infinity, -1])('invalid or missing numbers stay missing: %s', value => {
    const result = report([job('numeric', {
      estimatedDurationSeconds: value, estimatedWeightGrams: value,
      estimatedLength: value, lengthUnit: 'mm', materials: [usage('PLA', value)],
    })])
    assert.deepEqual(result.totals.estimatedDurationSeconds, { value: null, known: 0, missing: 1 })
    assert.deepEqual(result.totals.otherWeightGrams, { value: null, known: 0, missing: 1 })
    assert.deepEqual(result.totals.estimatedLengthMeters, { value: null, known: 0, missing: 1 })
    assert.deepEqual(result.materials[0].otherWeightGrams, { value: null, known: 0, missing: 1 })
  })

  test('preserves fractional precision and converts length only with explicitly compatible units', () => {
    const result = report([
      job('fractional', {
        result: 'completed', startedAt: '2026-03-01T12:00:00.000Z', endedAt: '2026-03-01T12:01:01.234Z',
        estimatedDurationSeconds: 1.23456789, estimatedWeightGrams: 0.123456789,
        estimatedLength: 123.456789, lengthUnit: 'mm',
      }),
      job('meters', { estimatedLength: 1.5, lengthUnit: 'm' }),
      job('unknown-unit-zero', { estimatedLength: 0 }),
      job('unknown-unit', { estimatedLength: 999999 }),
      job('invalid-unit', { estimatedLength: 10, lengthUnit: 'cm' as ElementJob['lengthUnit'] }),
    ])
    assert.equal(result.totals.actualDurationSeconds.value, 61.234)
    assert.equal(result.totals.estimatedDurationSeconds.value, 1.23456789)
    assert.equal(result.totals.completedWeightGrams.value, 0.123456789)
    assert.deepEqual(result.totals.estimatedLengthMeters, { value: 1.623456789, known: 2, missing: 3 })
    assert.equal(result.totals.unreportedLengthUnitJobs, 3)
  })

  test('missing mappings use a single unreported task estimate, never zero or an invented allocation', () => {
    const result = report([
      job('no-mappings', { result: 'failed_or_aborted', estimatedWeightGrams: 90 }),
      job('blank-mapping', { result: 'completed', estimatedWeightGrams: 9, materials: [usage(' ', 5)] }),
      job('missing-weight', { materials: [usage(null, null)] }),
    ], { material: '__unreported__' })
    assert.equal(result.materials.length, 1)
    assert.equal(result.materials[0].material, null)
    assert.equal(result.materials[0].jobs, 3)
    assert.equal(result.materials[0].failedOrAbortedWeightGrams.value, 90)
    assert.equal(result.materials[0].completedWeightGrams.value, 5)
    assert.equal(result.totals.completedWeightGrams.value, 9)
    assert.equal(result.materials[0].otherWeightGrams.value, null)
    assert.equal(result.materials[0].otherWeightGrams.missing, 1)
    assert.equal(result.totals.unreportedMaterialJobs, 3)
    assert.equal(result.materialWeightDiscrepancyJobs, 1)
  })

  test('partial mappings retain missing counts and only prove excess, not an invented remainder', () => {
    const result = report([
      job('partial', { estimatedWeightGrams: 100, materials: [usage('PLA', 40), usage('PLA', null)] }),
      job('over', { estimatedWeightGrams: 100, materials: [usage('PETG', 110), usage('PETG', null)] }),
    ])
    assert.deepEqual(result.materials.find(row => row.material === 'PLA')?.otherWeightGrams,
      { value: 40, known: 1, missing: 1 })
    assert.equal(result.materials.find(row => row.material === 'PLA')?.jobs, 1)
    assert.deepEqual(result.materials.find(row => row.material === 'PETG')?.otherWeightGrams,
      { value: 110, known: 1, missing: 1 })
    assert.equal(result.materialWeightDiscrepancyJobs, 1)
    assert.match(result.assumptions.join('\n'), /0 g are unallocated.*10 g are excess/)
    assert.match(result.assumptions.join('\n'), /2 jobs have incomplete mapping weights/)
  })

  test('floating-point addition noise is not a material discrepancy and raw sums are not rounded', () => {
    const result = report([job('float', {
      estimatedWeightGrams: 0.3, materials: [usage('PLA', 0.1), usage('PLA', 0.2)],
    })])
    assert.equal(result.materialWeightDiscrepancyJobs, 0)
    assert.equal(result.totals.otherWeightGrams.value, 0.3)
    assert.equal(result.materials[0].otherWeightGrams.value, 0.1 + 0.2)
  })

  test.each(['completed', 'failed_or_aborted'] as const)(
    'uses the shared ingestion threshold for terminal %s elapsed intervals', result => {
      const start = Date.parse('2026-03-01T12:00:00.000Z')
      for (const seconds of [0, 1, 59, 60, 60.001, 61, 3600]) {
        const value = report([job('elapsed', {
          result, startedAt: new Date(start).toISOString(),
          endedAt: new Date(start + seconds * 1000).toISOString(),
          actualDurationSeconds: seconds,
        })])
        assert.deepEqual(value.totals.actualDurationSeconds, seconds > 60
          ? { value: seconds, known: 1, missing: 0 }
          : { value: null, known: 0, missing: 1 })
        sumTrend(value)
      }
    })

  test.each(['active', 'unknown'] as const)('non-terminal %s jobs do not acquire runtime from paired timestamps', result => {
    const value = report([job('non-terminal', {
      result, startedAt: '2026-03-01T12:00:00Z', endedAt: '2026-03-01T13:00:00Z',
      actualDurationSeconds: 3600, estimatedDurationSeconds: 7200,
    })])
    assert.deepEqual(value.totals.actualDurationSeconds, { value: null, known: 0, missing: 1 })
    assert.equal(value.totals.estimatedDurationSeconds.value, 7200)
    assert.equal(value.jobs.items[0].actualDurationSeconds, 3600)
    sumTrend(value)
  })

  test.each([
    { startedAt: '2026-03-16T12:00:00Z', endedAt: '2026-03-16T13:00:00Z', lastSeenAt: NOW.toISOString() },
    { startedAt: '2026-03-14T12:00:00Z', endedAt: '2026-03-16T13:00:00Z', lastSeenAt: NOW.toISOString() },
    { startedAt: '2026-03-01T12:00:00Z', endedAt: '2026-03-01T13:00:00Z', lastSeenAt: 'invalid' },
  ])('future or unbounded observation timestamps cannot resurrect unavailable elapsed time: %j', times => {
    const value = report([job('future', { ...times, result: 'completed', actualDurationSeconds: 3600 })])
    assert.deepEqual(value.totals.actualDurationSeconds, { value: null, known: 0, missing: 1 })
    assert.equal(value.jobs.items[0].actualDurationSeconds, 3600)
  })

  test('consumes persisted retained/cleared values without treating presence metadata or lastSeenAt as field provenance', () => {
    const retained = job('retained', {
      reportedFields: ['title'], title: 'Updated observation',
      estimatedWeightGrams: 12.5, materials: [usage('PLA', 12.5)],
    })
    const value = report([retained])
    assert.deepEqual(value.totals.otherWeightGrams, { value: 12.5, known: 1, missing: 0 })
    assert.deepEqual(value.jobs.items[0].reportedFields, ['title'])
    const cleared = report([{
      ...retained, reportedFields: ['estimatedWeightGrams', 'materials'],
      estimatedWeightGrams: null, materials: [usage('PLA', null)],
    }])
    assert.deepEqual(cleared.totals.otherWeightGrams, { value: null, known: 0, missing: 1 })
    assert.deepEqual(cleared.materials[0].otherWeightGrams, { value: null, known: 0, missing: 1 })
    const definitions = value.assumptions.join('\n')
    assert.match(definitions, /retain previously reported values only when a field is omitted/)
    assert.match(definitions, /Explicit null or invalid fields clear earlier values/)
    assert.match(definitions, /lastSeenAt is the job-observation time, not per-field provenance or freshness/)
    assert.match(definitions, /Intervals of 60 seconds or less may be cloud placeholders/)
  })

  test('does not mutate persisted jobs, mappings, warnings, connections or filters', () => {
    const input = structuredClone(jobs)
    for (const value of input) {
      Object.freeze(value)
      value.materials.forEach(Object.freeze)
      Object.freeze(value.materials)
      Object.freeze(value.warnings)
    }
    Object.freeze(input)
    const before = JSON.stringify(input)
    const query = parseElementQuery({ sort: 'weight_desc', material: 'pla', pageSize: 1 })
    Object.freeze(query.filters)
    Object.freeze(query)
    const connections = Object.freeze([Object.freeze(connection('c1'))])
    createElementReport(input, connections, [], query, NOW)
    assert.equal(JSON.stringify(input), before)
    assert.deepEqual(query, parseElementQuery({ sort: 'weight_desc', material: 'pla', pageSize: 1 }))
  })
})

describe('IANA calendar filters, DST and calendar-grain buckets', () => {
  test('spring-forward day is 23 hours, includes both calendar edges and rejects adjacent dates', () => {
    const result = report([
      job('before', { startedAt: '2026-03-08T04:59:59.999Z' }),
      job('entire-day', { result: 'completed', startedAt: '2026-03-08T05:00:00Z', endedAt: '2026-03-09T04:00:00Z' }),
      job('skip-hour', { result: 'completed', startedAt: '2026-03-08T01:30:00-05:00', endedAt: '2026-03-08T03:30:00-04:00' }),
      job('last', { startedAt: '2026-03-09T03:59:59.999Z' }),
      job('after', { startedAt: '2026-03-09T04:00:00Z' }),
    ], { from: '2026-03-08', to: '2026-03-08', timeZone: 'America/New_York', sort: 'started_asc' })
    assert.deepEqual(result.jobs.items.map(value => value.id), ['entire-day', 'skip-hour', 'last'])
    assert.equal(result.trend.length, 1)
    assert.deepEqual(result.totals.actualDurationSeconds, { value: 23 * 3600 + 3600, known: 2, missing: 1 })
    assert.equal(result.trend[0].from, '2026-03-08')
    sumTrend(result)
  })

  test('fall-back day is 25 hours and repeated local clock hours sort by actual instants', () => {
    const result = report([
      job('before', { startedAt: '2026-11-01T03:59:59.999Z' }),
      job('day', {
        result: 'completed', startedAt: '2026-11-01T04:00:00Z', endedAt: '2026-11-02T05:00:00Z',
        lastSeenAt: '2026-11-03T00:00:00Z',
      }),
      job('later-0130', { startedAt: '2026-11-01T01:30:00-05:00' }),
      job('earlier-0130', {
        result: 'completed', startedAt: '2026-11-01T01:30:00-04:00', endedAt: '2026-11-01T01:30:00-05:00',
        lastSeenAt: '2026-11-03T00:00:00Z',
      }),
      job('last', { startedAt: '2026-11-02T04:59:59.999Z' }),
      job('after', { startedAt: '2026-11-02T05:00:00Z' }),
    ], { from: '2026-11-01', to: '2026-11-01', timeZone: 'America/New_York', sort: 'started_asc' })
    assert.deepEqual(result.jobs.items.map(value => value.id), ['day', 'earlier-0130', 'later-0130', 'last'])
    assert.deepEqual(result.totals.actualDurationSeconds, { value: 26 * 3600, known: 2, missing: 2 })
    sumTrend(result)
  })

  test('calendar-day generation crosses DST without missing or duplicating a day', () => {
    const result = report([], {
      from: '2026-03-07', to: '2026-03-10', timeZone: 'America/New_York',
    })
    assert.deepEqual(result.trend.map(bucket => bucket.from),
      ['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10'])
  })

  test('month boundaries respect a half-hour time zone rather than UTC', () => {
    const result = report([
      job('before', { startedAt: '2026-01-31T18:29:59.999Z' }),
      job('first', { startedAt: '2026-01-31T18:30:00Z' }),
      job('last', { startedAt: '2026-02-28T18:29:59.999Z' }),
      job('after', { startedAt: '2026-02-28T18:30:00Z' }),
    ], { from: '2026-02-01', to: '2026-02-28', timeZone: 'Asia/Kolkata', grain: 'month', sort: 'started_asc' })
    assert.deepEqual(result.jobs.items.map(value => value.id), ['first', 'last'])
    assert.deepEqual(result.trend.map(({ key, from, to }) => ({ key, from, to })),
      [{ key: '2026-02-01', from: '2026-02-01', to: '2026-02-28' }])
    sumTrend(result)
  })

  test('quarter-hour offsets also use the correct near-midnight boundary', () => {
    const result = report([
      job('before', { startedAt: '2026-01-01T10:14:59.999Z' }),
      job('first', { startedAt: '2026-01-01T10:15:00Z' }),
    ], { from: '2026-01-02', to: '2026-01-02', timeZone: 'Pacific/Chatham' })
    assert.deepEqual(result.jobs.items.map(value => value.id), ['first'])
  })

  test('Monday weeks span year boundaries and drilldown dates intersect the active range', () => {
    const result = report([
      job('sunday', { startedAt: '2026-01-05T04:59:59Z' }),
      job('monday', { startedAt: '2026-01-05T05:00:00Z' }),
    ], { from: '2026-01-01', to: '2026-01-07', timeZone: 'America/New_York', grain: 'week' })
    assert.deepEqual(result.trend.map(({ key, from, to }) => ({ key, from, to })), [
      { key: '2025-12-29', from: '2026-01-01', to: '2026-01-04' },
      { key: '2026-01-05', from: '2026-01-05', to: '2026-01-07' },
    ])
    for (const bucket of result.trend) {
      const drilldown = report(result.jobs.items, {
        from: bucket.from, to: bucket.to, timeZone: result.filters.timeZone,
      })
      assert.equal(drilldown.totals.jobs, bucket.totals.jobs)
    }
  })

  test('leap-year months retain empty months and intersect partial-month drilldown dates', () => {
    const result = report([job('march', { startedAt: '2024-03-01T12:00:00Z' })], {
      from: '2024-02-15', to: '2024-03-02', grain: 'month',
    })
    assert.deepEqual(result.trend.map(({ key, from, to }) => ({ key, from, to })), [
      { key: '2024-02-01', from: '2024-02-15', to: '2024-02-29' },
      { key: '2024-03-01', from: '2024-03-01', to: '2024-03-02' },
    ])
    assert.equal(result.trend[0].totals.jobs, 0)
    assert.equal(result.trend[1].totals.jobs, 1)
  })

  test('one-sided bounds fill toward observed dates without introducing a now-based filter', () => {
    const jobs = [job('observed', { startedAt: '2026-03-03T12:00:00Z' })]
    assert.deepEqual(report(jobs, { from: '2026-03-01' }).trend.map(bucket => bucket.key),
      ['2026-03-01', '2026-03-02', '2026-03-03'])
    assert.deepEqual(report(jobs, { to: '2026-03-05' }).trend.map(bucket => bucket.key),
      ['2026-03-03', '2026-03-04', '2026-03-05'])
    assert.deepEqual(report([], { from: '2026-03-01' }).trend, [])
  })

  test('runtime is wholly attributed to the start date, not clipped or split into occupancy', () => {
    const result = report([
      job('overnight', { result: 'completed', startedAt: '2026-03-01T23:00:00Z', endedAt: '2026-03-02T03:00:00Z' }),
      job('next-day', { result: 'completed', startedAt: '2026-03-02T00:00:00Z', endedAt: '2026-03-02T01:00:00Z' }),
    ], { from: '2026-03-01', to: '2026-03-01' })
    assert.equal(result.totals.jobs, 1)
    assert.equal(result.totals.actualDurationSeconds.value, 14400)
    assert.equal(result.trend[0].totals.actualDurationSeconds.value, 14400)
    assert.match(result.assumptions.join('\n'), /not an occupancy odometer/)
  })

  test('undated jobs never use first-seen or end dates and exclusions respect other filters', () => {
    const jobs = [
      job('missing', { endedAt: '2026-03-01T12:00:00Z', materials: [usage('PLA', 1)] }),
      job('invalid', { startedAt: 'invalid', materials: [usage('PLA', 2)] }),
      job('other-material', { materials: [usage('PETG', 3)] }),
      job('other-connection', { connectionId: 'c2', materials: [usage('PLA', 4)] }),
    ]
    const noDate = report(jobs, { material: 'PLA', connectionId: 'c1' })
    assert.equal(noDate.trend[0].key, 'undated')
    assert.equal(noDate.totals.undatedJobs, 2)
    const dated = report(jobs, { material: 'PLA', connectionId: 'c1', from: '2026-03-01', to: '2026-03-15' })
    assert.equal(dated.totals.jobs, 0)
    assert.match(dated.assumptions.join('\n'), /2 otherwise-matching undated jobs were excluded/)
  })
})

describe('UTC candidate bounds before the repository limit', () => {
  const bounds = (input: Record<string, unknown>) => elementUtcBounds(parseElementQuery(input).filters)

  test('unbounded and one-sided filters omit the corresponding SQL bounds', () => {
    assert.deepEqual(bounds({}), {})
    assert.deepEqual(bounds({ from: '2026-03-01' }), { fromInclusive: '2026-03-01T00:00:00.000Z' })
    assert.deepEqual(bounds({ to: '2026-03-01' }), { toExclusive: '2026-03-02T00:00:00.000Z' })
    assert.deepEqual(bounds({ from: '2026-03-01', to: '2026-03-01' }), {
      fromInclusive: '2026-03-01T00:00:00.000Z', toExclusive: '2026-03-02T00:00:00.000Z',
    })
  })

  test.each([
    ['2026-03-08', 'America/New_York', '2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'],
    ['2026-11-01', 'America/New_York', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z'],
    ['2026-03-29', 'Europe/Berlin', '2026-03-28T23:00:00.000Z', '2026-03-29T22:00:00.000Z'],
    ['2026-10-25', 'Europe/Berlin', '2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z'],
    ['2026-02-01', 'Asia/Kolkata', '2026-01-31T18:30:00.000Z', '2026-02-01T18:30:00.000Z'],
    ['2026-01-02', 'Pacific/Chatham', '2026-01-01T10:15:00.000Z', '2026-01-02T10:15:00.000Z'],
    ['2026-04-05', 'Australia/Lord_Howe', '2026-04-04T13:00:00.000Z', '2026-04-05T13:30:00.000Z'],
    ['2026-10-04', 'Australia/Lord_Howe', '2026-10-03T13:30:00.000Z', '2026-10-04T13:00:00.000Z'],
    ['2000-01-01', 'Pacific/Kiritimati', '1999-12-31T10:00:00.000Z', '2000-01-01T10:00:00.000Z'],
  ])('resolves %s in %s without assuming a 24-hour day', (date, timeZone, fromInclusive, toExclusive) => {
    const filters = parseElementQuery({ from: date, to: date, timeZone }).filters
    assert.deepEqual(elementUtcBounds(filters), { fromInclusive, toExclusive })
    const before = new Date(Date.parse(fromInclusive) - 1).toISOString()
    const last = new Date(Date.parse(toExclusive) - 1).toISOString()
    const jobs = [before, fromInclusive, last, toExclusive].map((startedAt, index) =>
      job(String(index), { startedAt }))
    assert.deepEqual(filteredElementJobs(jobs, filters).map(value => value.id), ['2', '1'])
  })

  test('leap-day/month endpoints use the next calendar date, regardless of trend grain', () => {
    for (const grain of ['day', 'week', 'month']) {
      assert.deepEqual(bounds({ from: '2024-02-01', to: '2024-02-29', timeZone: 'Asia/Kathmandu', grain }), {
        fromInclusive: '2024-01-31T18:15:00.000Z', toExclusive: '2024-02-29T18:15:00.000Z',
      })
    }
  })

  test('a midnight gap begins at the first valid local time, not a nonexistent midnight', () => {
    assert.deepEqual(bounds({ from: '2019-09-08', to: '2019-09-08', timeZone: 'America/Santiago' }), {
      fromInclusive: '2019-09-08T04:00:00.000Z', toExclusive: '2019-09-09T03:00:00.000Z',
    })
    assert.deepEqual(bounds({ to: '2019-09-07', timeZone: 'America/Santiago' }), {
      toExclusive: '2019-09-08T04:00:00.000Z',
    })
  })

  test('a repeated midnight includes both occurrences, without extending the preceding date', () => {
    assert.deepEqual(bounds({ from: '2020-11-01', to: '2020-11-01', timeZone: 'America/Havana' }), {
      fromInclusive: '2020-11-01T04:00:00.000Z', toExclusive: '2020-11-02T05:00:00.000Z',
    })
    assert.deepEqual(bounds({ to: '2020-10-31', timeZone: 'America/Havana' }), {
      toExclusive: '2020-11-01T04:00:00.000Z',
    })
  })

  test('a skipped calendar date produces an empty half-open range; one-sided bounds remain correct', () => {
    const instant = '2011-12-30T10:00:00.000Z'
    assert.deepEqual(bounds({ from: '2011-12-30', to: '2011-12-30', timeZone: 'Pacific/Apia' }), {
      fromInclusive: instant, toExclusive: instant,
    })
    assert.deepEqual(bounds({ from: '2011-12-30', timeZone: 'Pacific/Apia' }), { fromInclusive: instant })
    assert.deepEqual(bounds({ to: '2011-12-30', timeZone: 'Pacific/Apia' }), { toExclusive: instant })
    assert.deepEqual(bounds({ from: '2011-12-29', to: '2011-12-31', timeZone: 'Pacific/Apia' }), {
      fromInclusive: '2011-12-29T10:00:00.000Z', toExclusive: '2011-12-31T10:00:00.000Z',
    })
  })

  test('a midnight date rollback retains the brief next-date interval and the repeated previous date', () => {
    const zone = 'America/Goose_Bay'
    assert.deepEqual(bounds({ from: '2009-11-01', timeZone: zone }), {
      fromInclusive: '2009-11-01T03:00:00.000Z',
    })
    assert.deepEqual(bounds({ to: '2009-10-31', timeZone: zone }), {
      toExclusive: '2009-11-01T04:00:00.000Z',
    })
    const jobs = [
      '2009-11-01T02:59:59.999Z',
      '2009-11-01T03:00:00.000Z',
      '2009-11-01T03:00:59.999Z',
      '2009-11-01T03:01:00.000Z',
      '2009-11-01T03:59:59.999Z',
      '2009-11-01T04:00:00.000Z',
    ].map((startedAt, index) => job(String(index), { startedAt }))
    for (const date of ['2009-10-31', '2009-11-01']) {
      const filters = parseElementQuery({ from: date, to: date, timeZone: zone }).filters
      const { fromInclusive, toExclusive } = elementUtcBounds(filters)
      const candidates = jobs.filter(value => value.startedAt! >= fromInclusive! && value.startedAt! < toExclusive!)
      assert.deepEqual(filteredElementJobs(candidates, filters), filteredElementJobs(jobs, filters))
      assert.ok(candidates.length > filteredElementJobs(candidates, filters).length,
        'Single UTC ranges are candidate envelopes; exact calendar post-filtering is still required')
    }
  })

  test('maximum-year ceilings never emit a lexicographically unsafe extended-year ISO bound', () => {
    assert.deepEqual(bounds({ from: '9999-12-31', to: '9999-12-31' }), {
      fromInclusive: '9999-12-31T00:00:00.000Z',
    })
    assert.deepEqual(bounds({ to: '9999-12-31', timeZone: 'America/New_York' }), {})
    assert.deepEqual(bounds({ to: '9999-12-31', timeZone: 'Pacific/Kiritimati' }), {
      toExclusive: '9999-12-31T10:00:00.000Z',
    })
  })

  test('the helper validates date and timezone bounds without changing or depending on other filters', () => {
    const filters = parseElementQuery({
      from: '2026-03-08', to: '2026-03-08', timeZone: 'America/New_York',
      material: '__unreported__', result: 'unknown', grain: 'month', sort: 'weight_desc', page: 9,
    }).filters
    const before = structuredClone(filters)
    Object.freeze(filters)
    assert.deepEqual(elementUtcBounds(filters), {
      fromInclusive: '2026-03-08T05:00:00.000Z', toExclusive: '2026-03-09T04:00:00.000Z',
    })
    assert.deepEqual(filters, before)
    badRequest(() => elementUtcBounds({ ...filters, from: '2026-02-30' }))
    badRequest(() => elementUtcBounds({ ...filters, from: '2026-03-09' }))
    badRequest(() => elementUtcBounds({ ...filters, timeZone: '+02:00' }))
    badRequest(() => elementUtcBounds({ ...filters, timeZone: 'Not/A_Zone' }))
  })

  test('reports do not claim candidate-set undated exclusions cover jobs omitted by repository bounds', () => {
    const query = parseElementQuery({ from: '2026-03-01', to: '2026-03-01' })
    const result = createElementReport([], [connection('c1')], [coverage('c1')], query, NOW)
    assert.equal(result.coverage[0].undatedJobs, 2)
    assert.match(result.assumptions.join('\n'), /0 otherwise-matching undated jobs were excluded/)
    assert.match(result.assumptions.join('\n'), /This count excludes undated jobs already omitted by repository bounds/)
  })
})

describe('one shared filter, sort, pagination and connection scope', () => {
  test('intersects every filter before totals, trend, materials and pagination', () => {
    const base: Partial<ElementJob> = {
      title: 'Gear', result: 'failed_or_aborted', startedAt: '2026-03-02T12:00:00Z',
      materials: [usage('PLA', 20), usage('PETG', 10)],
    }
    const jobs = [
      job('a', { ...base, estimatedWeightGrams: 30 }),
      job('b', { ...base, estimatedWeightGrams: 50, startedAt: '2026-03-03T12:00:00Z' }),
      job('c', { ...base, connectionId: 'c2' }),
      job('d', { ...base, result: 'completed' }),
      job('e', { ...base, title: 'Bracket' }),
      job('f', { ...base, materials: [usage('PETG', 15)] }),
      job('g', { ...base, startedAt: '2026-02-28T12:00:00Z' }),
    ]
    const input = {
      from: '2026-03-01', to: '2026-03-03', connectionId: 'c1', material: 'pla',
      result: 'failed_or_aborted', search: 'gEaR', sort: 'weight_desc', page: 1, pageSize: 1,
    }
    const result = report(jobs, input)
    assert.equal(result.jobs.total, 2)
    assert.deepEqual(result.jobs.items.map(value => value.id), ['a'])
    assert.equal(result.jobs.page, 1)
    assert.equal(result.totals.failedOrAbortedWeightGrams.value, 80)
    assert.equal(result.materials.find(row => row.material === 'PETG')?.jobs, 2)
    assert.deepEqual(result.trend.map(bucket => bucket.totals.jobs), [0, 1, 1])
    assert.deepEqual(filteredElementJobs(jobs, result.filters).map(value => value.id), ['b', 'a'])
    sumTrend(result)
    const beyond = report(jobs, { ...input, page: 999 })
    assert.deepEqual(beyond.jobs.items, [])
    assert.deepEqual(beyond.totals, result.totals)
    assert.deepEqual(beyond.trend, result.trend)
  })

  test.each([
    ['CODE', 'code-match'], ['GEAR', 'title-match'], ['retry', 'status-match'], ['pLa', 'material-match'],
  ])('search matches reported public job fields case-insensitively: %s', (search, expected) => {
    const result = report([
      job('code-match'),
      job('title-match', { title: 'Gear housing' }),
      job('status-match', { rawStatus: 'RETRYING' }),
      job('material-match', { materials: [usage('PLA', 5)] }),
      job('private', { warnings: [search] }),
    ], { search })
    assert.deepEqual(result.jobs.items.map(value => value.id), [expected])
  })

  test.each(['started_desc', 'started_asc', 'weight_desc', 'duration_desc'])(
    'sorting is stable, keeps missing values last, and does not mutate input: %s', sort => {
      const jobs = [
        job('missing'),
        job('tie-b', {
          result: 'completed', startedAt: '2026-03-01T12:00:00Z', endedAt: '2026-03-01T12:02:00Z', estimatedWeightGrams: 0,
        }),
        job('tie-a', {
          result: 'completed', startedAt: '2026-03-01T12:00:00Z', endedAt: '2026-03-01T12:02:00Z', estimatedWeightGrams: 0,
        }),
      ]
      const result = filteredElementJobs(Object.freeze(jobs), parseElementQuery({ sort }).filters)
      assert.deepEqual(result.map(value => value.id), ['tie-b', 'tie-a', 'missing'])
      assert.deepEqual(jobs.map(value => value.id), ['missing', 'tie-b', 'tie-a'])
    })

  test('duration sorting uses actual runtime, never raw duration or full-slice estimates', () => {
    const result = report([
      job('long-slice', {
        result: 'completed', startedAt: '2026-03-01T12:00:00Z', endedAt: '2026-03-01T12:02:00Z',
        actualDurationSeconds: 10000, estimatedDurationSeconds: 999999,
      }),
      job('long-runtime', {
        result: 'completed', startedAt: '2026-03-01T12:00:00Z', endedAt: '2026-03-01T13:00:00Z',
        actualDurationSeconds: 1, estimatedDurationSeconds: 1,
      }),
      job('unknown-runtime', { actualDurationSeconds: 9999999, estimatedDurationSeconds: 9999999 }),
    ], { sort: 'duration_desc' })
    assert.deepEqual(result.jobs.items.map(value => value.id), ['long-runtime', 'long-slice', 'unknown-runtime'])
  })

  test('defaults to 25 rows, keeps totals across all pages and preserves all-connection coverage', () => {
    const jobs = Array.from({ length: 30 }, (_, index) => job(String(index)))
    const first = report(jobs)
    const second = report(jobs, { page: 1 })
    assert.equal(first.jobs.items.length, 25)
    assert.equal(second.jobs.items.length, 5)
    assert.equal(first.totals.jobs, 30)
    assert.deepEqual(first.totals, second.totals)
    const scoped = createElementReport(jobs, [connection('c1'), connection('c2')],
      [coverage('c1'), coverage('c2')], parseElementQuery({ connectionId: 'c1', from: '2026-03-01' }), NOW)
    assert.deepEqual(scoped.connections.map(value => value.id), ['c1'])
    assert.deepEqual(scoped.coverage.map(value => value.connectionId), ['c1'])
    assert.equal(scoped.coverage[0].jobCount, 500)
    assert.equal(scoped.totals.jobs, 0)
    assert.match(scoped.assumptions.join('\n'), /available cloud pages were observed, not lifetime completeness/)
    const all = createElementReport([], [connection('c1'), connection('c2')],
      [coverage('c1'), coverage('c2')], parseElementQuery({}), NOW)
    assert.equal(all.connections.length, 2)
    assert.equal(all.coverage.length, 2)
  })
})
