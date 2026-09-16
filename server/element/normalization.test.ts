import { describe, expect, it } from 'vitest'
import { elementElapsedSeconds } from '../../lib/contracts/elementStatistics.ts'
import { BambuProviderError } from './bambuProviderErrors.ts'
import {
  assertBoundedBambuPayload, bambuIdentifier, bambuReportTime, bambuTimestamp,
  mergeBambuSnapshot, normalizeBambuAccount, normalizeBambuHistory,
} from './normalization.ts'

const now = Date.parse('2026-09-15T12:00:00Z')
const firstTime = '2026-09-15T10:00:00.000Z'
const secondTime = '2026-09-15T10:01:00.000Z'
const printer = '01P00A123456789'
const baseJob = {
  id: 123, deviceId: printer, title: 'Bracket', status: 2,
  startTime: '2026-09-15T08:00:00Z', endTime: '2026-09-15T09:30:00Z',
  costTime: 7_200, weight: 42.5, length: 14.7,
}
const normalizeJob = (extra: Record<string, unknown> = {}) =>
  normalizeBambuHistory({ hits: [{ ...baseJob, ...extra }], total: 1 }, printer, null, 20, now).jobs[0]
const merge = (print: Record<string, unknown>, previous: ReturnType<typeof mergeBambuSnapshot> = null, at = firstTime) =>
  mergeBambuSnapshot({ print }, previous, at)!
const populatedAms = {
  ams: {
    ams: [
      { id: '0', tray: [
        { id: '0', tray_type: 'PLA', tray_sub_brands: 'Basic', tray_color: '00FF00FF', remain: 80 },
        { id: '1', tray_type: 'PETG', tray_sub_brands: 'HF', tray_color: '112233FF', remain: 45 },
      ] },
      { id: '2', tray: [{ id: '0', tray_type: 'ABS', remain: 70 }] },
    ],
  },
}

describe('Bambu discovery normalization', () => {
  it('returns only public DTO fields and never the LAN code, links, or raw device data', () => {
    const account = normalizeBambuAccount(
      { uid: 123456, name: 'Maker', avatar: 'https://example.invalid/?token=hidden', accessToken: 'hidden' },
      { devices: [{
        dev_id: printer, name: 'Workshop', dev_product_name: 'P2S', dev_model_name: 'BL-C12',
        online: false, print_status: 'NEW_STATE', dev_access_code: 'lan-only-secret\n',
        camera: { url: 'https://example.invalid/?token=hidden' },
      }] }, 'global',
    )
    expect(account).toEqual({
      accountId: '123456', name: 'Maker', region: 'global',
      printers: [{ id: printer, name: 'Workshop', model: 'P2S', online: false, state: 'NEW_STATE' }],
    })
    expect(JSON.stringify(account)).not.toMatch(/hidden|lan-only|camera|https|access/)
  })

  it('does not coerce unreported online status to healthy and bounds presentation strings', () => {
    const account = normalizeBambuAccount({ uid: '234', name: 'x'.repeat(257) }, {
      devices: [{ dev_id: printer, name: '', online: 'true', dev_model_name: 'X1', print_status: null }],
    }, 'china')
    expect(account).toMatchObject({ accountId: '234', name: null, region: 'china' })
    expect(account.printers[0]).toEqual({ id: printer, name: printer, model: 'X1', online: null, state: null })
  })

  it.each(['../234', '23/4', '#', '+', 'u_234', '234\n', 1.5, Number.MAX_SAFE_INTEGER + 1, null])(
    'rejects unsafe account identity %s', uid => {
      expect(() => normalizeBambuAccount({ uid }, { devices: [] }, 'global')).toThrow(BambuProviderError)
    },
  )

  it.each(['device/evil', '../evil', '+', '#', 'serial\n', 'a'.repeat(65)])('rejects unsafe topic identifier %s', id => {
    expect(bambuIdentifier(id, 'printer')).toBeNull()
    expect(() => normalizeBambuAccount({ uid: 123 }, { devices: [{ dev_id: id }] }, 'global')).toThrow(BambuProviderError)
  })

  it('rejects malformed or duplicate discovery entries and reflected LAN access codes', () => {
    expect(() => normalizeBambuAccount({}, { devices: [] }, 'global')).toThrow(BambuProviderError)
    expect(() => normalizeBambuAccount({ uid: 123 }, { devices: {} }, 'global')).toThrow(BambuProviderError)
    expect(() => normalizeBambuAccount({ uid: 123 }, { devices: [null] }, 'global')).toThrow(BambuProviderError)
    expect(() => normalizeBambuAccount({ uid: 123 }, { devices: [{ dev_id: printer }, { dev_id: printer }] }, 'global')).toThrow(BambuProviderError)
    expect(() => normalizeBambuAccount({ uid: 123 }, {
      devices: [{ dev_id: printer, dev_access_code: 'lan-secret', name: 'My lan-secret printer' }],
    }, 'global')).toThrow(BambuProviderError)
  })
})

describe('Bambu history semantics', () => {
  it('separates actual terminal time from full-slice duration, weight, and ambiguous length', () => {
    const job = normalizeJob()
    expect(job).toMatchObject({
      id: '123', result: 'completed', rawStatus: '2',
      actualDurationSeconds: 5_400, estimatedDurationSeconds: 7_200,
      estimatedWeightGrams: 42.5, estimatedLength: 14.7, lengthUnit: null,
      startedAt: '2026-09-15T08:00:00.000Z', endedAt: '2026-09-15T09:30:00.000Z',
    })
    expect(job.warnings.join(' ')).toMatch(/unverified unit/)
  })

  it('keeps failed and aborted combined, regardless of failedType or percentage', () => {
    const job = normalizeJob({ status: 3, failedType: 0, mc_percent: 10, endTime: '2026-09-15T08:05:00Z' })
    expect(job).toMatchObject({
      result: 'failed_or_aborted', actualDurationSeconds: 300,
      estimatedDurationSeconds: 7_200, estimatedWeightGrams: 42.5, estimatedLength: 14.7,
    })
  })

  it.each([1, 4, 999, 1_000_000_000, -1, 'UNSEEN_STATE', null])('does not infer success for undocumented status %s', status => {
    const job = normalizeJob({ status, percent: 100 })
    expect(job.result).toBe('unknown')
    expect(job.rawStatus).toBe(status === null ? null : String(status))
    expect(job.actualDurationSeconds).toBeNull()
    expect(job.warnings.join(' ')).toMatch(/unrecognized/)
  })

  it.each(['RUNNING', 'PAUSED', 'PREPARING'])('does not fabricate active-task duration for %s', status => {
    expect(normalizeJob({ status }).actualDurationSeconds).toBeNull()
    expect(normalizeJob({ status }).result).toBe('active')
  })

  it.each(['2026-09-15T08:00:00Z', '2026-09-15T08:00:30Z', '2026-09-15T08:01:00Z'])(
    'marks a terminal short interval as ambiguous, not actual runtime (%s)', endTime => {
      const job = normalizeJob({ endTime })
      expect(job.actualDurationSeconds).toBeNull()
      expect(job.warnings.join(' ')).toMatch(/placeholder/)
    },
  )

  it('rejects invalid, inverted and future intervals rather than substituting slice time', () => {
    expect(normalizeJob({ endTime: '2026-09-15T07:00:00Z' }).actualDurationSeconds).toBeNull()
    expect(normalizeJob({ endTime: '2026-09-16T10:00:00Z' }).actualDurationSeconds).toBeNull()
    expect(normalizeJob({ endTime: null }).actualDurationSeconds).toBeNull()
    const zoneless = normalizeJob({ startTime: '2026-09-15 08:00:00' })
    expect(zoneless.startedAt).toBeNull()
    expect(zoneless.actualDurationSeconds).toBeNull()
    expect(zoneless.warnings.join(' ')).toMatch(/time zone/)
  })

  it.each([
    '2026-02-29T00:00:00Z', '2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z',
    '2026-09-15T24:00:00Z', '2026-09-15T08:00:00', '2026-09-15T00:00:00+14:01',
    '2026-09-15T00:00:00+01:99', 1_757_952_000_000,
  ])('requires valid calendar timestamps with a zone (%s)', date => {
    expect(bambuTimestamp(date)).toBeNull()
  })

  it('normalizes explicit timezone offsets, leap days and fractional seconds', () => {
    expect(bambuTimestamp('2024-02-29T10:00:00.123456+02:00')).toBe('2024-02-29T08:00:00.123Z')
    expect(normalizeJob({
      startTime: '2026-09-15T10:00:00+02:00', endTime: '2026-09-15T11:30:00+02:00',
    }).actualDurationSeconds).toBe(5_400)
  })

  it.each(['mm', 'm'])('uses only an explicitly reported supported length unit (%s)', lengthUnit => {
    expect(normalizeJob({ lengthUnit }).lengthUnit).toBe(lengthUnit)
    expect(normalizeJob({ length_unit: lengthUnit }).lengthUnit).toBe(lengthUnit)
  })

  it.each([undefined, null, 'metres', 'feet', 'M', 'unknown'])('does not invent length units (%s)', lengthUnit => {
    expect(normalizeJob({ lengthUnit }).lengthUnit).toBeNull()
  })

  it('extracts actual mapping metadata and does not treat newer empty material as a filament', () => {
    const job = normalizeJob({
      material: { id: '', name: '' }, amsDetailMapping: [{
        filamentType: 'PETG', filamentId: 'GFG99', sourceColor: 'FFFFFFFF', targetColor: '102030FF',
        weight: 12.25, nozzleId: 1, amsId: 0, slotId: '2', ams: 1, hidden: 'discard',
      }],
    })
    expect(job.materials).toEqual([{
      material: 'PETG', filamentId: 'GFG99', color: '#102030FF', estimatedWeightGrams: 12.25,
      nozzleId: '1', amsId: '0', slotId: '2',
    }])
    expect(normalizeJob({ material: { id: 'PLA', name: 'PLA' } }).materials).toEqual([])
    expect(normalizeJob({ amsDetailMapping: [{}] }).materials).toEqual([])
  })

  it('never infers per-material quantities and rejects unsupported numeric/text ranges', () => {
    const job = normalizeJob({
      title: 'https://example.invalid/?token=should-not-survive',
      costTime: -1, weight: 10_000_000, length: -2,
      amsDetailMapping: [{ filamentType: 'PLA', weight: -10 }],
    })
    expect(job).toMatchObject({ title: null, estimatedDurationSeconds: null, estimatedWeightGrams: null, estimatedLength: null })
    expect(job.materials[0].estimatedWeightGrams).toBeNull()
    expect(normalizeJob({ costTime: '123.5', weight: '0', length: '0' })).toMatchObject({
      estimatedDurationSeconds: 123.5, estimatedWeightGrams: 0, estimatedLength: 0,
    })
  })

  it('paginates with the last task ID, not totals, lengths or arbitrary upstream cursors', () => {
    const page = normalizeBambuHistory({ hits: [baseJob], total: 1, nextCursor: 'secret-url' }, printer, null, 20, now)
    expect(page.nextCursor).toBe('123')
    expect(normalizeBambuHistory({ hits: [], total: 999 }, printer, '123', 20, now)).toEqual({
      jobs: [], total: 999, nextCursor: null,
    })
  })

  it('surfaces wrong-device, duplicate IDs and cursor replays instead of silently dropping records', () => {
    expect(() => normalizeBambuHistory({ hits: [{ ...baseJob, deviceId: 'OTHER' }] }, printer, null, 20, now))
      .toThrow(expect.objectContaining({ code: 'history_wrong_device' }))
    expect(() => normalizeBambuHistory({ hits: [baseJob, { ...baseJob, id: '123' }] }, printer, null, 20, now))
      .toThrow(expect.objectContaining({ code: 'history_duplicate' }))
    expect(() => normalizeBambuHistory({ hits: [baseJob] }, printer, '123', 20, now))
      .toThrow(expect.objectContaining({ code: 'history_cursor_loop' }))
  })

  it.each([{ hits: {} }, { hits: [null] }, { hits: [baseJob], total: -1 }, { hits: [baseJob], total: {} }])(
    'validates the entire page envelope (%j)', payload => {
      expect(() => normalizeBambuHistory(payload, printer, null, 20, now)).toThrow(BambuProviderError)
    },
  )

  it('bounds page sizes, material arrays and nested payload complexity', () => {
    expect(() => normalizeBambuHistory({ hits: [baseJob, { ...baseJob, id: 124 }] }, printer, null, 1, now)).toThrow(BambuProviderError)
    expect(() => normalizeBambuHistory({ hits: [] }, printer, null, 101, now)).toThrow(BambuProviderError)
    expect(() => normalizeJob({ amsDetailMapping: Array.from({ length: 65 }, () => ({})) })).toThrow(BambuProviderError)
    expect(() => assertBoundedBambuPayload({ value: 1e100 })).toThrow(BambuProviderError)
    expect(() => assertBoundedBambuPayload({ value: 'x'.repeat(16_385) })).toThrow(BambuProviderError)
    expect(() => assertBoundedBambuPayload({ value: Array(2_049).fill(null) })).toThrow(BambuProviderError)
    let nested: unknown = null
    for (let i = 0; i < 22; i++) nested = { next: nested }
    expect(() => assertBoundedBambuPayload(nested)).toThrow(BambuProviderError)
  })
})

describe('Bambu history own-property presence metadata', () => {
  const sparseJob = (fields: Record<string, unknown> = {}) =>
    normalizeBambuHistory({ hits: [{ id: 123, deviceId: printer, ...fields }] }, printer, null, 20, now).jobs[0]

  it('marks the full raw-backed DTO field set without copying upstream metadata', () => {
    const job = normalizeJob({
      lengthUnit: 'm', amsDetailMapping: [],
      reportedFields: ['upstream-spoof', 'accessToken'],
    })
    expect([...job.reportedFields!].sort()).toEqual([
      'title', 'result', 'rawStatus', 'startedAt', 'endedAt', 'actualDurationSeconds',
      'estimatedDurationSeconds', 'estimatedWeightGrams', 'estimatedLength', 'lengthUnit',
      'materials', 'warnings',
    ].sort())
    expect(JSON.stringify(job)).not.toMatch(/upstream-spoof|accessToken/)
  })

  it('always emits metadata, including an empty set for genuinely omitted raw fields', () => {
    const job = sparseJob({
      reportedFields: ['result', 'rawStatus', 'actualDurationSeconds', 'estimatedWeightGrams', 'materials'],
      result: 'completed', rawStatus: '2', actualDurationSeconds: 99_999,
      estimatedWeightGrams: 999, materials: [{ material: 'spoofed' }], warnings: ['spoofed'],
      material: { id: 'PLA', name: 'PLA' },
    })
    expect(job.reportedFields).toEqual([])
    expect(job).toMatchObject({
      result: 'unknown', rawStatus: null, actualDurationSeconds: null,
      estimatedWeightGrams: null, materials: [],
    })
    expect(JSON.stringify(job)).not.toMatch(/spoofed|99999/)
  })

  it.each([
    { source: 'title', field: 'title', invalid: 123 },
    { source: 'startTime', field: 'startedAt', invalid: '2026-09-15 08:00:00' },
    { source: 'endTime', field: 'endedAt', invalid: '2026-02-30T08:00:00Z' },
    { source: 'costTime', field: 'estimatedDurationSeconds', invalid: -1 },
    { source: 'weight', field: 'estimatedWeightGrams', invalid: 'not-a-number' },
    { source: 'length', field: 'estimatedLength', invalid: -1 },
    { source: 'lengthUnit', field: 'lengthUnit', invalid: 'feet' },
    { source: 'length_unit', field: 'lengthUnit', invalid: 'feet' },
  ] as const)('distinguishes omitted $source from explicit null, undefined and invalid values', ({ source, field, invalid }) => {
    expect(sparseJob().reportedFields).not.toContain(field)
    for (const value of [null, undefined, invalid]) {
      const job = sparseJob({ [source]: value })
      expect(job.reportedFields).toContain(field)
      expect(job[field]).toBeNull()
    }
  })

  it.each([null, undefined, {}, 1, 'UNRECOGNIZED_STATE'])('marks an explicitly unknown or invalid status as authoritative (%s)', status => {
    const job = sparseJob({ status })
    expect(job.result).toBe('unknown')
    expect(job.reportedFields).toEqual(['result', 'rawStatus', 'actualDurationSeconds', 'warnings'])
    expect(job.rawStatus).toBe(typeof status === 'number' || typeof status === 'string' ? String(status) : null)
    expect(sparseJob().reportedFields).not.toContain('result')
    expect(sparseJob().reportedFields).not.toContain('rawStatus')
  })

  it.each([null, undefined, [], [{}], [{ filamentType: 123, weight: -1, sourceColor: 'invalid' }]].map(mapping => ({ mapping })))(
    'marks explicitly empty, unavailable or invalid material metadata as present',
    ({ mapping }) => {
      const job = sparseJob({ amsDetailMapping: mapping })
      expect(job.materials).toEqual([])
      expect(job.reportedFields).toEqual(['materials', 'warnings'])
      expect(sparseJob().reportedFields).not.toContain('materials')
    },
  )

  it('does not mark missing length units as reported and deduplicates explicit aliases', () => {
    const unqualified = sparseJob({ length: 10 })
    expect(unqualified.lengthUnit).toBeNull()
    expect(unqualified.reportedFields).toContain('estimatedLength')
    expect(unqualified.reportedFields).not.toContain('lengthUnit')
    const explicit = sparseJob({ lengthUnit: null, length_unit: 'm' })
    expect(explicit.lengthUnit).toBeNull()
    expect(explicit.reportedFields?.filter(field => field === 'lengthUnit')).toEqual(['lengthUnit'])
  })

  it('ignores inherited raw values and inherited reportedFields', () => {
    const hit = Object.assign(Object.create({
      title: 'Inherited title', status: 2, startTime: baseJob.startTime, endTime: baseJob.endTime,
      costTime: 1_000, weight: 99, length: 1_000, lengthUnit: 'm', amsDetailMapping: [],
      reportedFields: ['title', 'result', 'materials'],
    }), { id: 123, deviceId: printer }) as Record<string, unknown>
    const job = normalizeBambuHistory({ hits: [hit] }, printer, null, 20, now).jobs[0]
    expect(job.reportedFields).toEqual([])
    expect(job).toMatchObject({
      title: null, result: 'unknown', rawStatus: null, startedAt: null, endedAt: null,
      actualDurationSeconds: null, estimatedDurationSeconds: null, estimatedWeightGrams: null,
      estimatedLength: null, lengthUnit: null, materials: [],
    })
  })

  it('tracks locally derived duration and warning dependencies instead of trusting raw DTO fields', () => {
    expect(sparseJob({ title: 'Updated title', actualDurationSeconds: 100, warnings: [] }).reportedFields).toEqual(['title'])
    expect(sparseJob({ endTime: null }).reportedFields).toEqual(['endedAt', 'actualDurationSeconds', 'warnings'])
    const valid = normalizeJob({ lengthUnit: 'm', amsDetailMapping: [{ filamentType: 'PLA' }] })
    expect(valid.warnings).toEqual([])
    expect(valid.reportedFields).toContain('warnings')
  })

  it.each([
    { status: 2, endTime: '2026-09-15T09:30:00Z' },
    { status: 3, endTime: '2026-09-15T09:30:00Z' },
    { status: 'RUNNING', endTime: '2026-09-15T09:30:00Z' },
    { status: 1, endTime: '2026-09-15T09:30:00Z' },
    { status: null, endTime: '2026-09-15T09:30:00Z' },
    { status: 2, endTime: '2026-09-15T07:59:00Z' },
    { status: 2, endTime: '2026-09-15T08:01:00Z' },
    { status: 2, endTime: '2026-09-16T09:30:00Z' },
    { status: 2, endTime: null },
    { status: 2, startTime: '2024-01-01T00:00:00Z', endTime: '2026-09-15T09:30:00Z' },
  ])('uses the shared elapsed-time semantics after timestamp validation (%j)', fields => {
    const job = normalizeJob(fields)
    expect(job.actualDurationSeconds).toBe(
      elementElapsedSeconds(job.result, job.startedAt, job.endedAt, new Date(now).toISOString()),
    )
    expect(job.reportedFields).toContain('actualDurationSeconds')
  })
})

describe('Bambu partial printer reports', () => {
  it('starts with unreported fields, not healthy defaults', () => {
    const snapshot = merge({ nozzle_temper: 23.5 })
    expect(snapshot).toMatchObject({
      receivedAt: firstTime, nozzleActualC: 23.5, state: null, jobId: null,
      progressPercent: null, hms: null, ams: null, printError: null,
      fieldUpdatedAt: { nozzleActualC: firstTime },
    })
    expect(Object.keys(snapshot.fieldUpdatedAt)).toEqual(['nozzleActualC'])
  })

  it('preserves missing fields and their timestamps but explicitly clears nulls without mutating prior DTOs', () => {
    const first = merge({ nozzle_temper: 210, bed_temper: 60, mc_percent: 25, print_error: 12 })
    const next = merge({ nozzle_temper: null, mc_percent: 26, print_error: null }, first, secondTime)
    expect(next).toMatchObject({ nozzleActualC: null, bedActualC: 60, progressPercent: 26, printError: null })
    expect(next.fieldUpdatedAt).toMatchObject({
      nozzleActualC: secondTime, bedActualC: firstTime, progressPercent: secondTime, printError: secondTime,
    })
    expect(first.nozzleActualC).toBe(210)
    expect(first.fieldUpdatedAt.nozzleActualC).toBe(firstTime)
  })

  it('clears job-scoped stale fields when a new job ID arrives but keeps device measurements', () => {
    const first = merge({
      subtask_id: '100', subtask_name: 'Old', gcode_state: 'RUNNING', mc_percent: 99,
      mc_remaining_time: 3, layer_num: 80, total_layer_num: 100, nozzle_temper: 200,
      print_error: 123, hms: [{ code: 456, attr: 7 }], ...populatedAms,
    })
    const next = merge({ subtask_id: '101', subtask_name: 'New' }, first, secondTime)
    expect(next).toMatchObject({
      jobId: '101', jobName: 'New', state: null, progressPercent: null, remainingMinutes: null,
      currentLayer: null, totalLayers: null, printError: null, nozzleActualC: 200,
      hms: [{ code: '456', attribute: '7' }],
    })
    expect(next.ams).toEqual(first.ams)
    expect(next.fieldUpdatedAt.progressPercent).toBeUndefined()
    expect(next.fieldUpdatedAt.nozzleActualC).toBe(firstTime)
  })

  it('handles cleared job identity and changing local-job names without using percentages as identity', () => {
    const first = merge({ subtask_id: '10', subtask_name: 'Old', mc_percent: 90 })
    const cleared = merge({ subtask_id: null }, first, secondTime)
    expect(cleared).toMatchObject({ jobId: null, jobName: null, progressPercent: null })
    const changed = merge({ subtask_name: 'Different' }, first, secondTime)
    expect(changed).toMatchObject({ jobId: null, jobName: 'Different', progressPercent: null })
    const percentage = merge({ mc_percent: 0 }, first, secondTime)
    expect(percentage).toMatchObject({ jobId: '10', jobName: 'Old', progressPercent: 0 })
  })

  it('does not mistake a newly learned or cleared job name for a different identity', () => {
    const first = merge({ subtask_id: '10', mc_percent: 30 })
    const named = merge({ subtask_name: 'Bracket' }, first, secondTime)
    expect(named).toMatchObject({ jobId: '10', progressPercent: 30, jobName: 'Bracket' })
    expect(merge({ subtask_name: null }, named, secondTime)).toMatchObject({
      jobId: '10', progressPercent: 30, jobName: null,
    })
  })

  it('uses task identity only as a fallback and keeps idle placeholder IDs unavailable', () => {
    expect(merge({ subtask_id: '12', task_id: '8' }).jobId).toBe('12')
    expect(merge({ task_id: '8' }).jobId).toBe('8')
    expect(merge({ task_id: '0' }).jobId).toBeNull()
    expect(merge({ subtask_id: null, task_id: '8' }).jobId).toBeNull()
  })

  it('keeps unknown state strings and explicit no-error reports without inventing success', () => {
    const snapshot = merge({ gcode_state: 'FUTURE_STATE', print_error: 0, mc_percent: 100 })
    expect(snapshot.state).toBe('FUTURE_STATE')
    expect(snapshot.printError).toBe('0')
    expect(merge({ mc_print_error_code: '0300_8002' }).printError).toBe('0300_8002')
    expect(merge({ print_error: null, mc_print_error_code: '123' }).printError).toBeNull()
  })

  it('preserves HMS until explicitly cleared and strips arbitrary HMS details', () => {
    const first = merge({ hms: [{ code: 123, attr: 456, message: 'https://secret.invalid/', accessToken: 'not-returned' }] })
    expect(first.hms).toEqual([{ code: '123', attribute: '456' }])
    expect(merge({ nozzle_temper: 30 }, first, secondTime).hms).toEqual(first.hms)
    expect(merge({ hms: [] }, first, secondTime).hms).toEqual([])
    expect(merge({ hms: null }, first, secondTime).hms).toBeNull()
    expect(() => merge({ hms: [{ message: 'bad' }] }, first)).toThrow(BambuProviderError)
    expect(() => merge({ hms: 'bad' }, first)).toThrow(BambuProviderError)
  })

  it('supports valid metric units and rejects unavailable, negative, huge, or malformed values', () => {
    expect(merge({
      mc_percent: '24', mc_remaining_time: '5.5', layer_num: 2, total_layer_num: 10,
      nozzle_temper: 215.5, nozzle_target_temper: 220, bed_temper: 55, bed_target_temper: 60,
      wifi_signal: '-45dBm',
    })).toMatchObject({
      progressPercent: 24, remainingMinutes: 5.5, currentLayer: 2, totalLayers: 10,
      nozzleActualC: 215.5, nozzleTargetC: 220, bedActualC: 55, bedTargetC: 60, wifiSignalDbm: -45,
    })
    expect(merge({
      mc_percent: 101, mc_remaining_time: -1, layer_num: 1.5, total_layer_num: -1,
      nozzle_temper: -1, nozzle_target_temper: 999, bed_temper: '', bed_target_temper: true,
      wifi_signal: 'unknown',
    })).toMatchObject({
      progressPercent: null, remainingMinutes: null, currentLayer: null, totalLayers: null,
      nozzleActualC: null, nozzleTargetC: null, bedActualC: null, bedTargetC: null, wifiSignalDbm: null,
    })
    expect(merge({ mc_percent: 0, nozzle_target_temper: 0, wifi_signal: -100 })).toMatchObject({
      progressPercent: 0, nozzleTargetC: 0, wifiSignalDbm: -100,
    })
  })

  it('merges AMS arrays by reported IDs and clears every removed-spool field on an empty tray', () => {
    const first = merge(populatedAms)
    const next = merge({ ams: { ams: [{ id: '0', tray: [{ id: '1' }] }] } }, first, secondTime)
    expect(next.ams).toHaveLength(3)
    expect(next.ams?.[0]).toEqual(first.ams?.[0])
    expect(next.ams?.[1]).toEqual({
      amsId: '0', slotId: '1', material: null, subBrand: null, color: null, remainingPercent: null, empty: true,
    })
    expect(next.ams?.[2]).toEqual(first.ams?.[2])
    expect(next.fieldUpdatedAt['ams.0.0.material']).toBe(firstTime)
    expect(next.fieldUpdatedAt['ams.0.1.material']).toBe(secondTime)
  })

  it('updates sparse remaining percentages without inferring spool identity or consumed job weight', () => {
    const first = merge(populatedAms)
    const next = merge({ ams: { ams: [{ id: '0', tray: [{ id: '0', remain: 77 }] }] } }, first, secondTime)
    expect(next.ams?.[0]).toMatchObject({ material: 'PLA', subBrand: 'Basic', color: '#00FF00FF', remainingPercent: 77, empty: false })
    expect(next.fieldUpdatedAt['ams.0.0.material']).toBe(firstTime)
    expect(next.fieldUpdatedAt['ams.0.0.remainingPercent']).toBe(secondTime)
    const unknown = merge({ ams: { ams: [{ id: '0', tray: [{ id: '0', remain: 77 }] }] } })
    expect(unknown.ams?.[0]).toMatchObject({ material: null, empty: null, remainingPercent: 77 })
    expect(unknown.progressPercent).toBeNull()
  })

  it('does not carry old spool metadata across identity changes or explicitly null material', () => {
    const first = merge(populatedAms)
    const changed = merge({ ams: { ams: [{ id: '0', tray: [{ id: '0', tray_type: 'PETG' }] }] } }, first, secondTime)
    expect(changed.ams?.[0]).toMatchObject({
      material: 'PETG', subBrand: null, color: null, remainingPercent: null, empty: false,
    })
    expect(changed.fieldUpdatedAt['ams.0.0.color']).toBeUndefined()
    const cleared = merge({ ams: { ams: [{ id: '0', tray: [{ id: '0', tray_type: null }] }] } }, first, secondTime)
    expect(cleared.ams?.[0]).toMatchObject({
      material: null, subBrand: null, color: null, remainingPercent: null, empty: null,
    })
  })

  it('handles explicit empty inventories independently of an explicitly reported external spool', () => {
    const first = merge({ ...populatedAms, vt_tray: { id: '254', tray_type: 'TPU', tray_color: '123456FF', remain: -1 } })
    expect(first.ams?.at(-1)).toEqual({
      amsId: 'external', slotId: '254', material: 'TPU', subBrand: null,
      color: '#123456FF', remainingPercent: null, empty: false,
    })
    const noPhysical = merge({ ams: { ams: [] } }, first, secondTime)
    expect(noPhysical.ams).toHaveLength(1)
    expect(noPhysical.ams?.[0].amsId).toBe('external')
    expect(merge({ vt_tray: [] }, noPhysical, secondTime).ams).toEqual([])
    expect(merge({ vt_tray: null }, noPhysical, secondTime).ams).toBeNull()
    expect(merge({ ams: null }, merge(populatedAms), secondTime).ams).toBeNull()
    expect(Object.keys(noPhysical.fieldUpdatedAt).some(key => key.startsWith('ams.0.'))).toBe(false)
  })

  it('does not fabricate AMS inventories from selectors, percentage or camera blocks', () => {
    expect(merge({ mc_percent: 25, ams: { tray_now: '254', tray_exist_bits: 'f' } }).ams).toBeNull()
    expect(mergeBambuSnapshot({ print: { ipcam: { url: 'secret' }, xcam: {}, ams: { tray_now: '254' } } }, null, firstTime)).toBeNull()
    expect(mergeBambuSnapshot({ ipcam: { url: 'secret' } }, null, firstTime)).toBeNull()
    const snapshot = merge({ mc_percent: 30, ipcam: { rtsp_url: 'rtsp://secret' }, xcam: {}, upload: { oss_url: 'secret' } })
    expect(JSON.stringify(snapshot)).not.toMatch(/secret|ipcam|xcam|upload/)
  })

  it.each([
    { ams: { ams: [{ tray: [{ id: '0' }] }] } },
    { ams: { ams: [{ id: '0', tray: [{}] }] } },
    { ams: { ams: [{ id: '0', tray: [{ id: '0' }, { id: '0' }] }] } },
    { ams: { ams: [{ id: '0' }, { id: '0' }] } },
    { ams: { ams: [{ id: '../bad', tray: [] }] } },
    { vt_tray: { tray_type: 'PLA' } },
  ])('rejects malformed slot identity rather than inventing an array-position slot (%j)', print => {
    expect(() => merge(print)).toThrow(BambuProviderError)
  })

  it('uses actual report timestamps only, not job start time or the sequence number', () => {
    expect(bambuReportTime({ print: { gcode_start_time: 123, sequence_id: '100' } })).toBeNull()
    expect(bambuReportTime({ timestamp: now / 1_000 })).toBe(now)
    expect(bambuReportTime({ print: { ts: now } })).toBe(now)
    expect(bambuReportTime({ print: { timestamp: '2026-09-15T12:00:00Z' } })).toBe(now)
    expect(() => bambuReportTime({ timestamp: '2026-09-15 12:00:00' })).toThrow(BambuProviderError)
  })
})
