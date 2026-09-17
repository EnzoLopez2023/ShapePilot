import type {
  ElementConnection, ElementCoverage, ElementFilters, ElementGrain, ElementJob,
  ElementHourBucket, ElementJobResult, ElementMaterialSummary, ElementMeasure, ElementQuery,
  ElementReport, ElementTotals, ElementTrendBucket,
} from '../../lib/contracts/elementStatistics.ts'
import { elementElapsedSeconds } from '../../lib/contracts/elementStatistics.ts'
import { ApiError } from '../errors/ApiError.ts'

const UNREPORTED_MATERIAL = '__unreported__'
const MAX_TREND_BUCKETS = 1_000
const QUERY_KEYS = new Set([
  'from', 'to', 'timeZone', 'connectionId', 'material', 'result', 'search',
  'grain', 'sort', 'page', 'pageSize',
])
const RESULTS: readonly ElementJobResult[] = [
  'completed', 'failed_or_aborted', 'active', 'unknown',
]

function bad(field: string, message: string): never {
  throw ApiError.badRequest(message, { field })
}

function text(
  input: Record<string, unknown>, field: string, maximum: number,
): string | undefined {
  const value = input[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string') bad(field, `${field} must be a single text value.`)
  if (value.length > maximum) bad(field, `${field} must be at most ${maximum} characters.`)
  return value
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function realDate(value: string, minimumYear: number): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  return year >= minimumYear && year <= 9999 && month >= 1 && month <= 12
    && day >= 1 && day <= daysInMonth(year, month)
}

function queryDate(input: Record<string, unknown>, field: string): string | null {
  const value = text(input, field, 10)
  if (value === undefined) return null
  if (!realDate(value, 2000)) {
    bad(field, `${field} must be a real YYYY-MM-DD calendar date between 2000 and 9999.`)
  }
  return value
}

function timeZone(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z_]+(?:\/[A-Za-z0-9._+-]+)*$/.test(value)) {
    bad('timeZone', 'timeZone must be a valid IANA time zone, such as UTC or America/New_York.')
  }
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone
  } catch {
    return bad('timeZone', 'timeZone must be a valid IANA time zone, such as UTC or America/New_York.')
  }
}

function enumValue<T extends string>(
  input: Record<string, unknown>, field: string, values: readonly T[], fallback: T,
): T {
  const value = input[field]
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !values.includes(value as T)) {
    bad(field, `${field} must be one of: ${values.join(', ')}.`)
  }
  return value as T
}

function integer(
  input: Record<string, unknown>, field: string, fallback: number, minimum: number, maximum: number,
): number {
  const value = input[field]
  if (value === undefined) return fallback
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value))) {
    bad(field, `${field} must be a single whole number between ${minimum} and ${maximum}.`)
  }
  const numeric = Number(value)
  if (!Number.isSafeInteger(numeric) || numeric < minimum || numeric > maximum) {
    bad(field, `${field} must be a single whole number between ${minimum} and ${maximum}.`)
  }
  return numeric
}

/** Case/spacing normalization does not change the raw material mappings on jobs. */
export function normalizedElementMaterial(value: string | null): string | null {
  return value?.trim().replace(/\s+/gu, ' ').toUpperCase() || null
}

export function parseElementQuery(input: Record<string, unknown>, _now?: Date): ElementQuery {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    bad('query', 'Statistics query parameters must be an object of single values.')
  }
  for (const key of Object.keys(input)) {
    if (!QUERY_KEYS.has(key)) bad('query', 'The statistics query contains an unsupported parameter.')
    if (Array.isArray(input[key])) bad(key, `${key} must be supplied only once.`)
  }
  const from = queryDate(input, 'from')
  const to = queryDate(input, 'to')
  if (from !== null && to !== null && from > to) {
    bad('to', 'to must be on or after from in the selected time zone.')
  }
  const connection = text(input, 'connectionId', 128)
  const material = text(input, 'material', 128)
  if (connection !== undefined && !connection.trim()) bad('connectionId', 'connectionId must not be empty.')
  if (material !== undefined && !material.trim()) bad('material', 'material must not be empty.')
  const selectedMaterial = material === undefined ? null
    : material.trim().toLowerCase() === UNREPORTED_MATERIAL ? UNREPORTED_MATERIAL
      : normalizedElementMaterial(material)
  if (selectedMaterial !== null && selectedMaterial.length > 128) {
    bad('material', 'material must be at most 128 characters after case and whitespace normalization.')
  }
  const filters: ElementFilters = {
    from,
    to,
    timeZone: timeZone(text(input, 'timeZone', 128) ?? 'UTC'),
    connectionId: connection ?? null,
    material: selectedMaterial,
    result: enumValue(input, 'result', ['all', ...RESULTS], 'all'),
    search: (text(input, 'search', 150) ?? '').trim(),
    grain: enumValue(input, 'grain', ['day', 'week', 'month'], 'day'),
    sort: enumValue(input, 'sort', ['started_desc', 'started_asc', 'weight_desc', 'duration_desc'], 'started_desc'),
  }
  const pageSize = integer(input, 'pageSize', 25, 1, 100)
  const page = integer(input, 'page', 0, 0, Math.floor(Number.MAX_SAFE_INTEGER / pageSize))
  if (from !== null && to !== null) calendarBuckets(from, to, filters)
  return { filters, page, pageSize }
}

function utcCalendarBoundary(
  nominalMidnight: number, edge: 'from' | 'to', formatter: Intl.DateTimeFormat,
): number {
  const hour = 3_600_000
  const windowStart = nominalMidnight - 48 * hour
  const windowEnd = nominalMidnight + 48 * hour
  const offsetAt = (instant: number): number => {
    const name = formatter.formatToParts(instant).find(part => part.type === 'timeZoneName')?.value
    const match = /^GMT(?:([+-])(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(name ?? '')
    if (!match) bad('timeZone', 'The UTC offset could not be resolved for this time zone.')
    const offset = match[1] === undefined ? 0
      : (Number(match[2]) * hour + Number(match[3]) * 60_000 + Number(match[4] ?? 0) * 1_000)
        * (match[1] === '-' ? -1 : 1)
    if (Math.abs(offset) >= 24 * hour) bad('timeZone', 'This time zone exceeds the supported UTC offset range.')
    return offset
  }
  let segmentStart = windowStart
  let segmentOffset = offsetAt(windowStart)
  let boundary = edge === 'from' ? Infinity : -Infinity
  const includeSegment = (segmentEnd: number): void => {
    const midnightAtOffset = nominalMidnight - segmentOffset
    if (edge === 'from') {
      const candidate = Math.max(segmentStart, midnightAtOffset)
      if (candidate < segmentEnd) boundary = Math.min(boundary, candidate)
    } else {
      const candidate = Math.min(segmentEnd, midnightAtOffset)
      if (candidate > segmentStart) boundary = Math.max(boundary, candidate)
    }
  }
  // Supported-era IANA transitions are separated by more than an hour.
  // Split at each transition before resolving wall-clock dates: a midnight
  // rollback can briefly enter the next date, then return to the previous one.
  for (let probe = windowStart + hour; probe <= windowEnd; probe += hour) {
    const offset = offsetAt(probe)
    if (offset === segmentOffset) continue
    let low = probe - hour
    let high = probe
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2)
      if (offsetAt(middle) === segmentOffset) low = middle
      else high = middle
    }
    includeSegment(high)
    segmentStart = high
    segmentOffset = offset
  }
  includeSegment(windowEnd)
  if (!Number.isFinite(boundary)) bad('timeZone', 'The calendar boundary could not be resolved for this time zone.')
  return boundary
}

/**
 * Tight UTC candidate bounds for canonical UTC ISO timestamps in the repository.
 * Retain filteredElementJobs: historical date rollbacks can make the matching
 * instants non-contiguous. Missing dates produce no corresponding SQL bound.
 * A ceiling beyond year 9999 is omitted rather than emitting an extended-year
 * ISO string, whose lexicographic order is unsuitable for four-digit ISO storage.
 */
export function elementUtcBounds(filters: ElementFilters): {
  fromInclusive?: string
  toExclusive?: string
} {
  const from = queryDate({ from: filters.from === null ? undefined : filters.from }, 'from')
  const to = queryDate({ to: filters.to === null ? undefined : filters.to }, 'to')
  if (from !== null && to !== null && from > to) bad('to', 'to must be on or after from in the selected time zone.')
  const zone = timeZone(filters.timeZone)
  if (from === null && to === null) return {}
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, timeZoneName: 'longOffset', numberingSystem: 'latn',
  })
  const bounds: { fromInclusive?: string; toExclusive?: string } = {}
  if (from !== null) {
    bounds.fromInclusive = new Date(utcCalendarBoundary(calendar(from).getTime(), 'from', formatter)).toISOString()
  }
  if (to !== null) {
    const nextDate = calendar(to)
    nextDate.setUTCDate(nextDate.getUTCDate() + 1)
    const end = new Date(utcCalendarBoundary(nextDate.getTime(), 'to', formatter))
    if (end.getUTCFullYear() <= 9999) bounds.toExclusive = end.toISOString()
  }
  return bounds
}

function timestamp(value: string | null): number | null {
  if (value === null) return null
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/i.exec(value)
  if (!match || !realDate(match[1], 1) || Number(match[2]) > 23
    || Number(match[3]) > 59 || Number(match[4]) > 59) return null
  const result = Date.parse(value)
  return Number.isFinite(result) ? result : null
}

function dateFormatter(zone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en', {
    timeZone: zone, calendar: 'iso8601', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
}

function calendarDate(instant: number | null, formatter: Intl.DateTimeFormat): string | null {
  if (instant === null) return null
  const parts = formatter.formatToParts(instant)
  const year = parts.find(part => part.type === 'year')?.value.padStart(4, '0')
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value
  const value = `${year}-${month}-${day}`
  return realDate(value, 1) ? value : null
}

/** The hour of the day a moment falls in, in the scope's zone. */
function hourFormatter(zone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en', {
    timeZone: zone, numberingSystem: 'latn', hour: '2-digit', hourCycle: 'h23',
  })
}

function zonedHour(instant: number | null, formatter: Intl.DateTimeFormat): number | null {
  if (instant === null) return null
  const value = formatter.formatToParts(instant).find(part => part.type === 'hour')?.value
  const hour = Number(value)
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null
}

function recordedNumber(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** Shared by filtering, aggregation and exports; no estimate substitutes for runtime. */
export function elementJobValues(job: ElementJob): {
  result: ElementJobResult
  startedAt: number | null
  endedAt: number | null
  actualDurationSeconds: number | null
  reportedActualDurationSeconds: number | null
  estimatedDurationSeconds: number | null
  estimatedWeightGrams: number | null
  estimatedLength: number | null
  estimatedLengthMeters: number | null
  lengthUnit: 'mm' | 'm' | null
} {
  const startedAt = timestamp(job.startedAt)
  const endedAt = timestamp(job.endedAt)
  const result = RESULTS.includes(job.result) ? job.result : 'unknown'
  const length = recordedNumber(job.estimatedLength)
  const lengthUnit = job.lengthUnit === 'mm' || job.lengthUnit === 'm' ? job.lengthUnit : null
  return {
    result,
    startedAt,
    endedAt,
    actualDurationSeconds: startedAt !== null && endedAt !== null
      ? elementElapsedSeconds(result, job.startedAt, job.endedAt, job.lastSeenAt) : null,
    reportedActualDurationSeconds: recordedNumber(job.actualDurationSeconds),
    estimatedDurationSeconds: recordedNumber(job.estimatedDurationSeconds),
    estimatedWeightGrams: recordedNumber(job.estimatedWeightGrams),
    estimatedLength: length,
    estimatedLengthMeters: length === null || lengthUnit === null ? null
      : lengthUnit === 'mm' ? length / 1_000 : length,
    lengthUnit,
  }
}

/** Only wholly absent mappings use the task estimate, once, as unreported material. */
export function elementMaterialValues(job: ElementJob): {
  material: string | null
  estimatedWeightGrams: number | null
}[] {
  return job.materials.length
    ? job.materials.map(usage => ({
      material: normalizedElementMaterial(usage.material),
      estimatedWeightGrams: recordedNumber(usage.estimatedWeightGrams),
    }))
    : [{ material: null, estimatedWeightGrams: recordedNumber(job.estimatedWeightGrams) }]
}

function compareNumbers(a: number | null, b: number | null, ascending: boolean): number {
  if (a === null) return b === null ? 0 : 1
  if (b === null) return -1
  return ascending ? a - b : b - a
}

export function filteredElementJobs(jobs: readonly ElementJob[], filters: ElementFilters): ElementJob[] {
  const formatter = dateFormatter(filters.timeZone)
  const selectedMaterial = filters.material === UNREPORTED_MATERIAL
    ? null : normalizedElementMaterial(filters.material)
  const search = filters.search.trim().toLowerCase()
  return jobs.map((job, index) => ({ job, index, values: elementJobValues(job) }))
    .filter(({ job, values }) => {
      if (filters.connectionId !== null && job.connectionId !== filters.connectionId) return false
      if (filters.result !== 'all' && values.result !== filters.result) return false
      if (filters.from !== null || filters.to !== null) {
        const date = calendarDate(values.startedAt, formatter)
        if (date === null || (filters.from !== null && date < filters.from)
          || (filters.to !== null && date > filters.to)) return false
      }
      if (filters.material !== null
        && !elementMaterialValues(job).some(usage => usage.material === selectedMaterial)) return false
      if (search && ![
        job.id, job.title, job.rawStatus, ...job.materials.map(usage => usage.material),
      ].some(value => value?.toLowerCase().includes(search))) return false
      return true
    })
    .sort((a, b) => {
      const field = filters.sort === 'weight_desc' ? 'estimatedWeightGrams'
        : filters.sort === 'duration_desc' ? 'actualDurationSeconds' : 'startedAt'
      return compareNumbers(a.values[field], b.values[field], filters.sort === 'started_asc')
        || a.index - b.index
    })
    .map(({ job }) => job)
}

function measure(): ElementMeasure {
  return { value: null, known: 0, missing: 0 }
}

function addMeasure(target: ElementMeasure, value: number | null): void {
  if (value === null) {
    target.missing++
    return
  }
  const sum = (target.value ?? 0) + value
  if (!Number.isFinite(sum)) bad('measurements', 'Recorded measurements exceed the supported numeric range.')
  target.value = sum
  target.known++
}

function emptyTotals(): ElementTotals {
  return {
    jobs: 0,
    results: { completed: 0, failed_or_aborted: 0, active: 0, unknown: 0 },
    actualDurationSeconds: measure(),
    estimatedDurationSeconds: measure(),
    completedWeightGrams: measure(),
    failedOrAbortedWeightGrams: measure(),
    otherWeightGrams: measure(),
    estimatedLengthMeters: measure(),
    unreportedLengthUnitJobs: 0,
    unreportedMaterialJobs: 0,
    undatedJobs: 0,
  }
}

function weightMeasure(
  target: Pick<ElementTotals, 'completedWeightGrams' | 'failedOrAbortedWeightGrams' | 'otherWeightGrams'>,
  result: ElementJobResult,
): ElementMeasure {
  return result === 'completed' ? target.completedWeightGrams
    : result === 'failed_or_aborted' ? target.failedOrAbortedWeightGrams : target.otherWeightGrams
}

function addJob(target: ElementTotals, job: ElementJob, dated: boolean): void {
  const values = elementJobValues(job)
  target.jobs++
  target.results[values.result]++
  addMeasure(target.actualDurationSeconds, values.actualDurationSeconds)
  addMeasure(target.estimatedDurationSeconds, values.estimatedDurationSeconds)
  addMeasure(weightMeasure(target, values.result), values.estimatedWeightGrams)
  addMeasure(target.estimatedLengthMeters, values.estimatedLengthMeters)
  if (values.lengthUnit === null) target.unreportedLengthUnitJobs++
  if (elementMaterialValues(job).some(usage => usage.material === null)) target.unreportedMaterialJobs++
  if (!dated) target.undatedJobs++
}

// These UTC dates are calendar-arithmetic containers, never local-midnight instants.
function calendar(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function bucketStart(date: string, grain: ElementGrain): string {
  if (grain === 'day') return date
  if (grain === 'month') return `${date.slice(0, 7)}-01`
  const value = calendar(date)
  value.setUTCDate(value.getUTCDate() - (value.getUTCDay() + 6) % 7)
  return dateKey(value)
}

function bucketEnd(start: string, grain: ElementGrain): string {
  if (grain === 'day') return start
  const value = calendar(start)
  if (grain === 'week') value.setUTCDate(value.getUTCDate() + 6)
  else value.setUTCDate(daysInMonth(value.getUTCFullYear(), value.getUTCMonth() + 1))
  return value.getUTCFullYear() > 9999 ? '9999-12-31' : dateKey(value)
}

function nextBucket(start: string, grain: ElementGrain): string | null {
  const value = calendar(start)
  if (grain === 'month') value.setUTCMonth(value.getUTCMonth() + 1)
  else value.setUTCDate(value.getUTCDate() + (grain === 'week' ? 7 : 1))
  return value.getUTCFullYear() > 9999 ? null : dateKey(value)
}

function calendarBuckets(from: string, to: string, filters: ElementFilters): ElementTrendBucket[] {
  const buckets: ElementTrendBucket[] = []
  let key: string | null = bucketStart(from, filters.grain)
  while (key !== null && key <= to) {
    if (buckets.length === MAX_TREND_BUCKETS) {
      const alternative = filters.grain === 'day' ? ' or choose week or month'
        : filters.grain === 'week' ? ' or choose month' : ''
      bad('grain', `The range exceeds ${MAX_TREND_BUCKETS} ${filters.grain} buckets. Narrow the date range${alternative}.`)
    }
    const end = bucketEnd(key, filters.grain)
    buckets.push({
      key,
      from: filters.from !== null && filters.from > key ? filters.from : key,
      to: filters.to !== null && filters.to < end ? filters.to : end,
      totals: emptyTotals(),
    })
    key = nextBucket(key, filters.grain)
  }
  return buckets
}

function materialSummaries(jobs: readonly ElementJob[]): {
  rows: ElementMaterialSummary[]
  discrepancies: number
  unallocatedGrams: number
  excessMappedGrams: number
  incompleteMappingJobs: number
} {
  const rows = new Map<string | null, ElementMaterialSummary>()
  let discrepancies = 0
  let unallocatedGrams = 0
  let excessMappedGrams = 0
  let incompleteMappingJobs = 0
  for (const job of jobs) {
    const values = elementJobValues(job)
    const usages = elementMaterialValues(job)
    const seen = new Set<string | null>()
    for (const usage of usages) {
      let row = rows.get(usage.material)
      if (!row) {
        row = {
          material: usage.material, jobs: 0,
          results: { completed: 0, failed_or_aborted: 0, active: 0, unknown: 0 },
          completedWeightGrams: measure(), failedOrAbortedWeightGrams: measure(), otherWeightGrams: measure(),
        }
        rows.set(usage.material, row)
      }
      if (!seen.has(usage.material)) {
        row.jobs++
        row.results[values.result]++
      }
      seen.add(usage.material)
      addMeasure(weightMeasure(row, values.result), usage.estimatedWeightGrams)
    }
    if (!job.materials.length) continue
    const complete = usages.every(usage => usage.estimatedWeightGrams !== null)
    if (!complete) incompleteMappingJobs++
    if (values.estimatedWeightGrams === null) continue
    const subtotal = usages.reduce((sum, usage) => sum + (usage.estimatedWeightGrams ?? 0), 0)
    const difference = values.estimatedWeightGrams - subtotal
    const tolerance = Number.EPSILON * Math.max(1, values.estimatedWeightGrams, subtotal) * 8
    // An incomplete subtotal proves a discrepancy only if it already exceeds the task total.
    if (Math.abs(difference) > tolerance && (complete || difference < 0)) {
      discrepancies++
      if (difference > 0) unallocatedGrams += difference
      else excessMappedGrams -= difference
    }
  }
  return {
    rows: [...rows.values()].sort((a, b) => a.material === null ? (b.material === null ? 0 : 1)
      : b.material === null ? -1 : a.material < b.material ? -1 : a.material > b.material ? 1 : 0),
    discrepancies, unallocatedGrams, excessMappedGrams, incompleteMappingJobs,
  }
}

export function createElementReport(
  jobs: readonly ElementJob[],
  connections: readonly ElementConnection[],
  coverage: readonly ElementCoverage[],
  query: ElementQuery,
  now: Date = new Date(),
): ElementReport {
  const validated = parseElementQuery({
    ...Object.fromEntries(Object.entries(query.filters).filter(([, value]) => value !== null)),
    page: query.page, pageSize: query.pageSize,
  })
  const { filters, page, pageSize } = validated
  const filtered = filteredElementJobs(jobs, filters)
  const formatter = dateFormatter(filters.timeZone)
  const dated = filtered.map(job => ({
    job, date: calendarDate(elementJobValues(job).startedAt, formatter),
  }))
  let earliest: string | null = null
  let latest: string | null = null
  for (const { date } of dated) {
    if (date === null) continue
    if (earliest === null || date < earliest) earliest = date
    if (latest === null || date > latest) latest = date
  }
  const from = filters.from ?? earliest
  const to = filters.to ?? latest
  const trend = from !== null && to !== null ? calendarBuckets(from, to, filters) : []
  const buckets = new Map(trend.map(bucket => [bucket.key, bucket]))
  const totals = emptyTotals()
  for (const { job, date } of dated) {
    addJob(totals, job, date !== null)
    const key = date === null ? 'undated' : bucketStart(date, filters.grain)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { key, from: null, to: null, totals: emptyTotals() }
      buckets.set(key, bucket)
      trend.push(bucket)
    }
    addJob(bucket.totals, job, date !== null)
  }
  // When the machine actually runs. Undated jobs have no hour and are left out
  // rather than piled onto midnight.
  const hours = hourFormatter(filters.timeZone)
  const hourOfDay: ElementHourBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour, jobs: 0, actualDurationSeconds: measure(),
  }))
  for (const { job } of dated) {
    const values = elementJobValues(job)
    const hour = zonedHour(values.startedAt, hours)
    if (hour === null) continue
    hourOfDay[hour].jobs++
    addMeasure(hourOfDay[hour].actualDurationSeconds, values.actualDurationSeconds)
  }

  const materials = materialSummaries(filtered)
  const materialOptions = new Set<string>()
  for (const job of filteredElementJobs(jobs, { ...filters, material: null })) {
    for (const usage of elementMaterialValues(job)) materialOptions.add(usage.material ?? UNREPORTED_MATERIAL)
  }
  const hasDateFilter = filters.from !== null || filters.to !== null
  const excludedUndated = hasDateFilter
    ? filteredElementJobs(jobs, { ...filters, from: null, to: null })
      .filter(job => calendarDate(elementJobValues(job).startedAt, formatter) === null).length : 0
  return {
    generatedAt: now.toISOString(),
    filters,
    totals,
    trend,
    hourOfDay,
    materials: materials.rows,
    materialWeightDiscrepancyJobs: materials.discrepancies,
    connections: connections.filter(connection => filters.connectionId === null || connection.id === filters.connectionId),
    availableMaterials: [...materialOptions].sort(),
    coverage: coverage.filter(item => filters.connectionId === null || item.connectionId === filters.connectionId),
    assumptions: [
      'Scope is the bounded set of persisted cloud jobs supplied to this report, not lifetime printer usage or a record of all local/offline jobs.',
      'Later job observations retain previously reported values only when a field is omitted. Explicit null or invalid fields clear earlier values. lastSeenAt is the job-observation time, not per-field provenance or freshness; a retained field may come from an earlier observation.',
      `Dates are inclusive start-date calendar filters in ${filters.timeZone}; no dates means all recorded dates. Undated/invalid-start jobs appear in an undated bucket only without date filters. ${excludedUndated} otherwise-matching undated jobs were excluded by date filters from the supplied candidate set. This count excludes undated jobs already omitted by repository bounds; consult whole-connection coverage for recorded undated counts.`,
      'Actual elapsed runtime uses the shared ingestion rule: completed or failed/aborted jobs only, valid explicitly zoned start/end at or before lastSeenAt, and more than 60 seconds elapsed. Intervals of 60 seconds or less may be cloud placeholders and remain unavailable. Reported duration and full-slice estimates never replace missing runtime.',
      'The printing-time trend assigns the entire elapsed runtime to the job start-date bucket, including jobs ending outside the range. It is not an occupancy odometer or time spent printing within each bucket. Weeks start Monday.',
      'All weights and sliced durations are full-job estimates, not measured consumption. Failed/aborted estimates represent the FULL job, not waste or consumed filament; active/unknown estimates remain separate. No progress-based allocation, costs or ownership changes are inferred.',
      'Material filters select whole jobs containing the material: job totals include ALL materials on those jobs. Material names are trimmed, whitespace-normalized and uppercased; __unreported__ selects missing material. Available material choices ignore only the current material filter.',
      'Material rows preserve reported mapping weights without scaling to task totals. Only wholly absent mappings use the task weight once as unreported material. Missing mapping weights remain missing, and unallocated differences are not assigned to a material or added again to totals.',
      `Material-weight discrepancies compare a known task total with complete mapping weights, or an incomplete subtotal already exceeding the total. ${materials.discrepancies} jobs differ; ${materials.unallocatedGrams} g are unallocated by complete mappings and ${materials.excessMappedGrams} g are excess known mapping weight. ${materials.incompleteMappingJobs} jobs have incomplete mapping weights.`,
      'Known/missing measures count jobs for totals and mapping entries for material rows (one task contribution if mappings are absent). Material job counts deduplicate slots per material, but one multi-material job can appear in several rows. No known contributions, including an empty eligible set, means null/unavailable. Explicit zero estimates and compatible lengths remain zero; runtime eligibility follows the shared elapsed-time rule.',
      'Length is converted to metres only when its unit is explicitly mm or m. Unknown-unit jobs include jobs with no length unit even when length is unavailable. Invalid, negative, non-finite and unreported numbers are unavailable.',
      'Search matches job ID, title, raw status or reported material text case-insensitively. Duration sorting uses actual elapsed runtime; unavailable sort values are last and ties retain input order. Unknown results are never inferred from raw status.',
      'Coverage describes the whole recorded history of the selected connections, not only the date/material/result/search selection. Backfill complete means available cloud pages were observed, not lifetime completeness or absence of recording gaps. Last-success, failure and backfill information must be read together.',
      'The on-screen jobs table is zero-based and paginated. Totals, trends and materials use the entire filtered set; exports require that same full set, not just the visible page. Numeric aggregation is not rounded.',
    ],
    jobs: {
      items: filtered.slice(page * pageSize, (page + 1) * pageSize),
      total: filtered.length,
      page,
      pageSize,
    },
  }
}
