import type {
  BambuRegion, ElementAccount, ElementAmsSlot, ElementHistoryPage, ElementHmsIssue,
  ElementJobField, ElementJobInput, ElementMaterialUsage, ElementSnapshot,
} from '../../lib/contracts/elementStatistics.ts'
import { elementElapsedSeconds } from '../../lib/contracts/elementStatistics.ts'
import { BambuProviderError } from './bambuProviderErrors.ts'

type ObjectValue = Record<string, unknown>
type PayloadError = 'invalid_response' | 'mqtt_invalid_payload'
type SnapshotField = Exclude<keyof ElementSnapshot, 'receivedAt' | 'fieldUpdatedAt'>

export const BAMBU_MAX_PAYLOAD_BYTES = 2 * 1024 * 1024
export const BAMBU_MAX_HISTORY_LIMIT = 100

export function isBambuObject(value: unknown): value is ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function assertBoundedBambuPayload(value: unknown, code: PayloadError = 'invalid_response'): void {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }]
  let visited = 0
  while (pending.length) {
    const item = pending.pop()!
    if (++visited > 40_000 || item.depth > 20) throw new BambuProviderError(code)
    if (typeof item.value === 'string') {
      if (item.value.length > 16_384) throw new BambuProviderError(code)
    } else if (typeof item.value === 'number') {
      if (!Number.isFinite(item.value) || Math.abs(item.value) > Number.MAX_SAFE_INTEGER) {
        throw new BambuProviderError(code)
      }
    } else if (item.value !== null && typeof item.value === 'object') {
      const entries = Array.isArray(item.value) ? item.value : Object.values(item.value)
      if (entries.length > (Array.isArray(item.value) ? 2_048 : 256)) throw new BambuProviderError(code)
      for (const entry of entries) pending.push({ value: entry, depth: item.depth + 1 })
    }
  }
}

export function bambuIdentifier(value: unknown, kind: 'account' | 'printer' | 'task'): string | null {
  const text = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : typeof value === 'string' ? value : ''
  const pattern = kind === 'account' ? /^\d{1,32}$/ : kind === 'printer'
    ? /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
    : /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
  return pattern.test(text) ? text : null
}

function text(value: unknown, max = 256): string | null {
  if (typeof value !== 'string' || value.length > max) return null
  const clean = value.trim().replace(/[\p{Cc}\p{Cf}]/gu, '')
  if (!clean || /[a-z][a-z0-9+.-]*:\/\/|(?:bearer|authorization)\s*[: ]|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./i.test(clean)) {
    return null
  }
  return clean
}

function numeric(value: unknown, min: number, max: number, integer = false): number | null {
  if (typeof value === 'string') {
    if (value.length > 32 || !/^-?\d+(?:\.\d+)?$/.test(value)) return null
    value = Number(value)
  }
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    && (!integer || Number.isInteger(value)) ? value : null
}

function index(value: unknown): string | null {
  const number = numeric(value, 0, 65_535, true)
  return number === null ? null : String(number)
}

function color(value: unknown): string | null {
  if (typeof value !== 'string' || !/^#?(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return null
  return `#${value.replace(/^#/, '').toUpperCase()}`
}

function code(value: unknown): string | null {
  if (typeof value === 'number') return numeric(value, 0, 0xffff_ffff, true)?.toString() ?? null
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value) ? value : null
}

export function bambuTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) return null
  const [, y, m, d, h, min, s, zone] = match
  const year = Number(y), month = Number(m), day = Number(d)
  const calendar = new Date(0)
  calendar.setUTCFullYear(year, month - 1, day)
  if (year < 1970 || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1
    || calendar.getUTCDate() !== day || Number(h) > 23 || Number(min) > 59 || Number(s) > 59) return null
  if (zone !== 'Z') {
    const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(4))
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null
  }
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

export function normalizeBambuAccount(preference: unknown, binding: unknown, region: BambuRegion): ElementAccount {
  assertBoundedBambuPayload(preference)
  assertBoundedBambuPayload(binding)
  if (!isBambuObject(preference) || !isBambuObject(binding) || !Array.isArray(binding.devices)
    || binding.devices.length > 256) throw new BambuProviderError('invalid_response')
  const accountId = bambuIdentifier(preference.uid, 'account')
  if (!accountId) throw new BambuProviderError('invalid_identifier')
  const ids = new Set<string>()
  const accessCodes: string[] = []
  const printers = binding.devices.map((device: unknown) => {
    if (!isBambuObject(device)) throw new BambuProviderError('invalid_response')
    const id = bambuIdentifier(device.dev_id, 'printer')
    if (!id || ids.has(id)) throw new BambuProviderError('invalid_identifier')
    ids.add(id)
    if (typeof device.dev_access_code === 'string' && device.dev_access_code.trim()) {
      accessCodes.push(device.dev_access_code.trim())
    }
    return {
      id,
      name: text(device.name) ?? id,
      model: text(device.dev_product_name, 80) ?? text(device.dev_model_name, 80),
      online: typeof device.online === 'boolean' ? device.online : null,
      state: text(device.print_status, 64),
    }
  })
  const account: ElementAccount = { accountId, name: text(preference.name), region, printers }
  const serialized = JSON.stringify(account)
  if (accessCodes.some(secret => serialized.includes(secret))) throw new BambuProviderError('invalid_response')
  return account
}

function materialUsage(value: unknown): ElementMaterialUsage {
  if (!isBambuObject(value)) throw new BambuProviderError('invalid_response')
  return {
    material: text(value.filamentType, 80),
    filamentId: text(value.filamentId, 80),
    color: color(value.targetColor) ?? color(value.sourceColor),
    estimatedWeightGrams: numeric(value.weight, 0, 1_000_000),
    nozzleId: index(value.nozzleId),
    amsId: index(value.amsId),
    slotId: index(value.slotId),
  }
}

const jobFieldSources = [
  ['title', 'title'],
  ['status', 'result'],
  ['status', 'rawStatus'],
  ['startTime', 'startedAt'],
  ['endTime', 'endedAt'],
  ['costTime', 'estimatedDurationSeconds'],
  ['weight', 'estimatedWeightGrams'],
  ['length', 'estimatedLength'],
  ['lengthUnit', 'lengthUnit'],
  ['length_unit', 'lengthUnit'],
  ['amsDetailMapping', 'materials'],
] as const satisfies readonly (readonly [string, ElementJobField])[]

function normalizeJob(value: ObjectValue, now: number): ElementJobInput {
  const owns = (key: string) => Object.hasOwn(value, key)
  const read = (key: string): unknown => owns(key) ? value[key] : undefined
  const reportedFields = new Set<ElementJobField>()
  for (const [source, field] of jobFieldSources) if (owns(source)) reportedFields.add(field)
  const durationReported = ['status', 'startTime', 'endTime'].some(owns)
  if (durationReported) reportedFields.add('actualDurationSeconds')
  // These are locally derived diagnostics, never an upstream `warnings` field.
  if (durationReported || ['amsDetailMapping', 'length', 'lengthUnit', 'length_unit'].some(owns)) {
    reportedFields.add('warnings')
  }
  const id = bambuIdentifier(read('id'), 'task')
  if (!id) throw new BambuProviderError('invalid_identifier')
  const status = read('status')
  const rawStatus = typeof status === 'number'
    ? Number.isSafeInteger(status) ? String(status) : null
    : text(status, 64)
  const result = rawStatus === '2' ? 'completed' : rawStatus === '3' ? 'failed_or_aborted'
    : /^(?:RUNNING|PRINTING|PAUSE|PAUSED|PREPARE|PREPARING|SLICING)$/i.test(rawStatus ?? '') ? 'active' : 'unknown'
  const startTime = read('startTime'), endTime = read('endTime')
  const startedAt = bambuTimestamp(startTime)
  const endedAt = bambuTimestamp(endTime)
  const warnings: string[] = []
  if (result === 'unknown') warnings.push('Task status is unrecognized; no successful result is assumed.')
  if (startTime != null && startTime !== '' && startedAt === null) warnings.push('The start time is invalid or lacks a time zone.')
  if (endTime != null && endTime !== '' && endedAt === null) warnings.push('The end time is invalid or lacks a time zone.')
  const observed = new Date(now)
  const actualDurationSeconds = elementElapsedSeconds(
    result, startedAt, endedAt, Number.isFinite(observed.getTime()) ? observed.toISOString() : '',
  )
  if (result === 'completed' || result === 'failed_or_aborted') {
    if (startedAt && endedAt) {
      const start = Date.parse(startedAt), end = Date.parse(endedAt)
      const duration = (end - start) / 1_000
      if (end > now || start > now) warnings.push('Future timestamps cannot establish actual duration.')
      else if (duration < 0 || (duration > 60 && actualDurationSeconds === null)) warnings.push('The reported time interval cannot establish actual duration.')
      else if (duration <= 60) warnings.push('A start/end interval of one minute or less may be a placeholder.')
    } else warnings.push('Actual duration requires valid start and end timestamps.')
  } else warnings.push('Actual duration is unavailable for a non-terminal task.')

  const mapping = read('amsDetailMapping')
  if (mapping != null && (!Array.isArray(mapping) || mapping.length > 64)) {
    throw new BambuProviderError('invalid_response')
  }
  const materials = (mapping as unknown[] | null | undefined ?? []).map(materialUsage)
    .filter(item => Object.values(item).some(field => field !== null))
  if (!materials.length) warnings.push('Material breakdown is unreported.')
  const estimatedLength = numeric(read('length'), 0, 1_000_000_000)
  const reportedUnit = owns('lengthUnit') ? read('lengthUnit') : read('length_unit')
  const lengthUnit = reportedUnit === 'mm' || reportedUnit === 'm' ? reportedUnit : null
  if (estimatedLength !== null && lengthUnit === null) warnings.push('Length is a slice estimate with an unverified unit.')
  return {
    reportedFields: [...reportedFields],
    id, title: text(read('title')), result, rawStatus, startedAt, endedAt, actualDurationSeconds,
    estimatedDurationSeconds: numeric(read('costTime'), 0, 31_536_000),
    estimatedWeightGrams: numeric(read('weight'), 0, 1_000_000),
    estimatedLength, lengthUnit, materials, warnings,
  }
}

export function normalizeBambuHistory(
  payload: unknown, printerId: string, cursor: string | null, limit: number, now = Date.now(),
): ElementHistoryPage {
  if (!bambuIdentifier(printerId, 'printer') || (cursor !== null && !bambuIdentifier(cursor, 'task'))) {
    throw new BambuProviderError('invalid_identifier')
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > BAMBU_MAX_HISTORY_LIMIT) throw new BambuProviderError('invalid_request')
  assertBoundedBambuPayload(payload)
  if (!isBambuObject(payload) || !Array.isArray(payload.hits) || payload.hits.length > limit) {
    throw new BambuProviderError('invalid_response')
  }
  const total = payload.total == null ? null : numeric(payload.total, 0, 1_000_000_000, true)
  if (payload.total != null && total === null) throw new BambuProviderError('invalid_response')
  const seen = new Set<string>()
  const jobs = payload.hits.map((hit: unknown) => {
    if (!isBambuObject(hit)) throw new BambuProviderError('invalid_response')
    if (bambuIdentifier(hit.deviceId, 'printer') !== printerId) throw new BambuProviderError('history_wrong_device')
    const job = normalizeJob(hit, now)
    if (seen.has(job.id)) throw new BambuProviderError('history_duplicate')
    if (job.id === cursor) throw new BambuProviderError('history_cursor_loop')
    seen.add(job.id)
    return job
  })
  // A short page or a changing `total` is not proof of exhaustion.
  return { jobs, nextCursor: jobs.at(-1)?.id ?? null, total }
}

function emptySnapshot(receivedAt: string): ElementSnapshot {
  return {
    receivedAt, state: null, jobId: null, jobName: null, progressPercent: null,
    remainingMinutes: null, currentLayer: null, totalLayers: null, nozzleActualC: null,
    nozzleTargetC: null, bedActualC: null, bedTargetC: null, wifiSignalDbm: null,
    printError: null, hms: null, ams: null, fieldUpdatedAt: {},
  }
}

const jobFields = ['state', 'jobId', 'jobName', 'progressPercent', 'remainingMinutes', 'currentLayer', 'totalLayers', 'printError'] as const
const slotFields = ['material', 'subBrand', 'color', 'remainingPercent', 'empty'] as const

function hms(value: unknown): ElementHmsIssue[] | null {
  if (value === null) return null
  if (!Array.isArray(value) || value.length > 128) throw new BambuProviderError('mqtt_invalid_payload')
  return value.map((item: unknown) => {
    if (!isBambuObject(item)) throw new BambuProviderError('mqtt_invalid_payload')
    const issueCode = code(item.code)
    if (issueCode === null) throw new BambuProviderError('mqtt_invalid_payload')
    return { code: issueCode, attribute: code(item.attr) }
  })
}

function wifi(value: unknown): number | null {
  if (typeof value === 'string' && value.length <= 32) value = value.replace(/dBm$/i, '').trim()
  return numeric(value, -150, 0)
}

function snapshotJobId(value: unknown): string | null {
  const id = bambuIdentifier(value, 'task')
  return id === '0' ? null : id
}

function updateAms(snapshot: ElementSnapshot, print: ObjectValue, receivedAt: string): boolean {
  let changed = false
  let slots = snapshot.ams?.map(slot => ({ ...slot })) ?? null
  const stamps = snapshot.fieldUpdatedAt
  const clearStamps = (matches: (key: string) => boolean) => {
    for (const key of Object.keys(stamps)) if (key.startsWith('ams.') && matches(key)) delete stamps[key]
  }
  const remove = (amsId: string | null, unknown: boolean) => {
    changed = true
    slots = slots?.filter(slot => amsId === null ? slot.amsId === 'external' : slot.amsId !== amsId) ?? []
    clearStamps(key => amsId === null ? !key.startsWith('ams.external.') : key.startsWith(`ams.${amsId}.`))
    if (unknown && !slots.length) slots = null
  }
  const mergeTray = (amsId: string, tray: unknown) => {
    if (!isBambuObject(tray)) throw new BambuProviderError('mqtt_invalid_payload')
    const slotId = index(tray.id)
    if (slotId === null) throw new BambuProviderError('mqtt_invalid_payload')
    const previous = slots?.find(slot => slot.amsId === amsId && slot.slotId === slotId)
    const fields = {
      material: ['tray_type', text(tray.tray_type, 80)],
      subBrand: ['tray_sub_brands', text(tray.tray_sub_brands, 80)],
      color: ['tray_color', color(tray.tray_color)],
      remainingPercent: ['remain', numeric(tray.remain, 0, 100)],
      empty: ['empty', typeof tray.empty === 'boolean' ? tray.empty : null],
    } as const
    const bare = Object.keys(tray).length === 1
    const explicitlyEmpty = bare || tray.empty === true
    const identityChanged = (['material', 'subBrand', 'color'] as const).some(field =>
      previous && Object.hasOwn(tray, fields[field][0]) && fields[field][1] !== previous[field])
    const slot: ElementAmsSlot = previous && !identityChanged && !explicitlyEmpty ? { ...previous }
      : { amsId, slotId, material: null, subBrand: null, color: null, remainingPercent: null, empty: null }
    const prefix = `ams.${amsId}.${slotId}.`
    if (identityChanged || explicitlyEmpty) clearStamps(key => key.startsWith(prefix))
    if (explicitlyEmpty) {
      slot.empty = true
      for (const field of slotFields) stamps[`${prefix}${field}`] = receivedAt
    } else {
      for (const field of slotFields) {
        if (Object.hasOwn(tray, fields[field][0])) {
          // The heterogeneous field tuple is constrained to the DTO fields above.
          Object.assign(slot, { [field]: fields[field][1] })
          stamps[`${prefix}${field}`] = receivedAt
        }
      }
      if (!Object.hasOwn(tray, 'empty') && Object.hasOwn(tray, 'tray_type') && slot.material !== null) {
        slot.empty = false
        stamps[`${prefix}empty`] = receivedAt
      }
      if (slot.empty === true) slot.remainingPercent = null
    }
    slots ??= []
    const position = slots.findIndex(item => item.amsId === amsId && item.slotId === slotId)
    if (position < 0) slots.push(slot)
    else slots[position] = slot
    if (slots.length > 256) throw new BambuProviderError('mqtt_invalid_payload')
    changed = true
  }
  if (Object.hasOwn(print, 'ams')) {
    if (print.ams === null) remove(null, true)
    else {
      if (!isBambuObject(print.ams)) throw new BambuProviderError('mqtt_invalid_payload')
      if (Object.hasOwn(print.ams, 'ams')) {
        const units = print.ams.ams
        if (units === null) remove(null, true)
        else {
          if (!Array.isArray(units) || units.length > 32) throw new BambuProviderError('mqtt_invalid_payload')
          if (!units.length) remove(null, false)
          const ids = new Set<string>()
          for (const unit of units) {
            if (!isBambuObject(unit)) throw new BambuProviderError('mqtt_invalid_payload')
            const amsId = index(unit.id)
            if (amsId === null || ids.has(amsId)) throw new BambuProviderError('mqtt_invalid_payload')
            ids.add(amsId)
            if (!Object.hasOwn(unit, 'tray')) continue
            if (unit.tray === null) remove(amsId, true)
            else {
              if (!Array.isArray(unit.tray) || unit.tray.length > 32) throw new BambuProviderError('mqtt_invalid_payload')
              if (!unit.tray.length) remove(amsId, false)
              const trays = new Set<string>()
              for (const tray of unit.tray) {
                const id = isBambuObject(tray) ? index(tray.id) : null
                if (id === null || trays.has(id)) throw new BambuProviderError('mqtt_invalid_payload')
                trays.add(id)
                mergeTray(amsId, tray)
              }
            }
          }
        }
      }
    }
  }
  if (Object.hasOwn(print, 'vt_tray')) {
    if (print.vt_tray === null) remove('external', true)
    else if (Array.isArray(print.vt_tray)) {
      if (print.vt_tray.length > 16) throw new BambuProviderError('mqtt_invalid_payload')
      if (!print.vt_tray.length) remove('external', false)
      const ids = new Set<string>()
      for (const tray of print.vt_tray) {
        const id = isBambuObject(tray) ? index(tray.id) : null
        if (id === null || ids.has(id)) throw new BambuProviderError('mqtt_invalid_payload')
        ids.add(id)
        mergeTray('external', tray)
      }
    } else mergeTray('external', print.vt_tray)
  }
  if (changed) {
    snapshot.ams = slots?.sort((a, b) => a.amsId.localeCompare(b.amsId, 'en', { numeric: true })
      || a.slotId.localeCompare(b.slotId, 'en', { numeric: true })) ?? null
    stamps.ams = receivedAt
  }
  return changed
}

export function mergeBambuSnapshot(
  payload: unknown, previous: ElementSnapshot | null, receivedAt: string,
): ElementSnapshot | null {
  assertBoundedBambuPayload(payload, 'mqtt_invalid_payload')
  if (!isBambuObject(payload)) throw new BambuProviderError('mqtt_invalid_payload')
  if (!Object.hasOwn(payload, 'print')) return null
  if (!isBambuObject(payload.print) || !bambuTimestamp(receivedAt)) throw new BambuProviderError('mqtt_invalid_payload')
  const print = payload.print
  const snapshot = previous ? structuredClone(previous) : emptySnapshot(receivedAt)
  let updated = false
  const set = <K extends SnapshotField>(field: K, value: ElementSnapshot[K]) => {
    snapshot[field] = value
    snapshot.fieldUpdatedAt[field] = receivedAt
    updated = true
  }
  const idKey = Object.hasOwn(print, 'subtask_id') ? 'subtask_id' : Object.hasOwn(print, 'task_id') ? 'task_id' : null
  const newId = idKey ? snapshotJobId(print[idKey]) : snapshot.jobId
  const newName = Object.hasOwn(print, 'subtask_name') ? text(print.subtask_name) : snapshot.jobName
  const nameChangedWithoutId = idKey === null && Object.hasOwn(print, 'subtask_name')
    && newName !== null && snapshot.jobName !== null && newName !== snapshot.jobName
  if ((idKey !== null && newId !== snapshot.jobId) || nameChangedWithoutId) {
    for (const field of jobFields) {
      snapshot[field] = null
      delete snapshot.fieldUpdatedAt[field]
    }
  }
  if (idKey !== null) set('jobId', newId)
  if (Object.hasOwn(print, 'subtask_name')) set('jobName', newName)
  if (Object.hasOwn(print, 'gcode_state')) set('state', text(print.gcode_state, 64))
  const metrics = [
    ['mc_percent', 'progressPercent', 0, 100, false],
    ['mc_remaining_time', 'remainingMinutes', 0, 525_600, false],
    ['layer_num', 'currentLayer', 0, 1_000_000, true],
    ['total_layer_num', 'totalLayers', 0, 1_000_000, true],
    ['nozzle_temper', 'nozzleActualC', 0, 500, false],
    ['nozzle_target_temper', 'nozzleTargetC', 0, 500, false],
    ['bed_temper', 'bedActualC', 0, 200, false],
    ['bed_target_temper', 'bedTargetC', 0, 200, false],
  ] as const
  for (const [key, field, min, max, integer] of metrics) {
    if (Object.hasOwn(print, key)) set(field, numeric(print[key], min, max, integer))
  }
  if (Object.hasOwn(print, 'wifi_signal')) set('wifiSignalDbm', wifi(print.wifi_signal))
  const errorKey = Object.hasOwn(print, 'print_error') ? 'print_error'
    : Object.hasOwn(print, 'mc_print_error_code') ? 'mc_print_error_code' : null
  if (errorKey) set('printError', code(print[errorKey]))
  if (Object.hasOwn(print, 'hms')) set('hms', hms(print.hms))
  updated = updateAms(snapshot, print, receivedAt) || updated
  if (!updated) return null
  snapshot.receivedAt = receivedAt
  return snapshot
}

export function bambuReportTime(payload: unknown): number | null {
  if (!isBambuObject(payload)) return null
  const print = isBambuObject(payload.print) ? payload.print : {}
  const candidates = [payload, print].flatMap(object =>
    ['timestamp', 'ts'].filter(key => Object.hasOwn(object, key)).map(key => object[key]))
  if (!candidates.length) return null
  const times = candidates.map(value => {
    const iso = bambuTimestamp(value)
    if (iso) return Date.parse(iso)
    const number = numeric(value, 1, 253_402_300_799_000)
    if (number === null) throw new BambuProviderError('mqtt_stale_report')
    return number < 100_000_000_000 ? number * 1_000 : number
  })
  return Math.min(...times)
}
