// Complete runtime validation for the X2D maintenance write routes.
//
// The combinators are a fifth copy, for the reason given at the top of
// server/validation/keycapProject.ts: each validator keeps bounds tuned to what
// it validates, and unifying them is a refactor of heavily tested files rather
// than part of this feature.
//
// What is distinctive here is dates. Every value this feature stores is either
// a calendar day or a key from a committed catalogue, and both are checkable
// exactly. A date is checked by round-tripping it through `Date` rather than by
// regular expression alone, because `2026-02-31` matches the pattern perfectly
// and is not a day. Future days are refused outright: a maintenance log records
// work that was done, and work that has not happened yet has no date.
import { ApiError } from '../errors/ApiError.ts'
import { isMaintenanceTaskKey } from '../../lib/contracts/x2dMaintenance.ts'
import type {
  MaintenanceEventInput, MaintenanceProfile,
} from '../../lib/db/repositories/contracts.ts'

export const LIMITS = {
  maxNoteLength: 500,
  /**
   * Bambu began shipping printers well after this. A date before it is a typo
   * or a probe, and either way not a day this printer was commissioned.
   */
  earliestDate: '2015-01-01',
  /** Rolls through the cutter. Far past any blade's life, and still bounded. */
  maxRollsUsed: 100_000,
} as const

const USAGE_TIERS = ['high', 'regular', 'low'] as const
const FILAMENT_WEARS = ['standard', 'abrasive'] as const
const PROFILE_KEYS = ['commissionedOn', 'usageTier', 'filamentWear', 'rollsUsed'] as const
const EVENT_KEYS = ['taskKey', 'performedOn', 'note'] as const

const bad = (field: string, message: string): never => {
  throw new ApiError(400, 'bad_request', message, { field })
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const rejectUnknownKeys = (
  object: Record<string, unknown>, allowed: readonly string[], prefix = '',
): void => {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      bad(`${prefix}${key}`, `body does not accept the field "${prefix}${key}"`)
    }
  }
}

/** Today in UTC as `YYYY-MM-DD`. The server's idea of "not in the future". */
export const today = (now: Date = new Date()): string => now.toISOString().slice(0, 10)

/**
 * A real calendar day, no later than today. The `toISOString` round-trip is the
 * check that matters: `Date.UTC` rolls 2026-02-31 forward to 2026-03-03, so a
 * value that comes back different was never a day in the first place.
 */
export function validateDate(value: unknown, field: string, now: Date = new Date()): string {
  if (typeof value !== 'string') bad(field, `${field} must be a string`)
  const text = value as string
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    bad(field, `${field} must be a date in YYYY-MM-DD form`)
  }
  const [year, month, day] = text.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    bad(field, `${field} is not a real calendar date`)
  }
  if (text < LIMITS.earliestDate) {
    bad(field, `${field} must not be earlier than ${LIMITS.earliestDate}`)
  }
  if (text > today(now)) bad(field, `${field} must not be in the future`)
  return text
}

/** The whole profile. It is one row of four settings, so a PUT replaces all of it. */
export function validateMaintenanceProfileInput(
  body: unknown, now: Date = new Date(),
): MaintenanceProfile {
  const root = isPlainObject(body) ? body : bad('body', 'body must be a JSON object')
  rejectUnknownKeys(root, PROFILE_KEYS)

  const commissionedOn = validateDate(root.commissionedOn, 'commissionedOn', now)

  const usageTier = root.usageTier
  if (typeof usageTier !== 'string'
    || !(USAGE_TIERS as readonly string[]).includes(usageTier)) {
    bad('usageTier', `usageTier must be one of ${USAGE_TIERS.join(', ')}`)
  }

  const filamentWear = root.filamentWear
  if (typeof filamentWear !== 'string'
    || !(FILAMENT_WEARS as readonly string[]).includes(filamentWear)) {
    bad('filamentWear', `filamentWear must be one of ${FILAMENT_WEARS.join(', ')}`)
  }

  const rollsUsed = root.rollsUsed
  if (typeof rollsUsed !== 'number' || !Number.isInteger(rollsUsed)) {
    bad('rollsUsed', 'rollsUsed must be a whole number')
  }
  if ((rollsUsed as number) < 0 || (rollsUsed as number) > LIMITS.maxRollsUsed) {
    bad('rollsUsed', `rollsUsed must be between 0 and ${LIMITS.maxRollsUsed}`)
  }

  return {
    commissionedOn,
    usageTier: usageTier as MaintenanceProfile['usageTier'],
    filamentWear: filamentWear as MaintenanceProfile['filamentWear'],
    rollsUsed: rollsUsed as number,
  }
}

/**
 * One logged service. `taskKey` is checked against the committed catalogue for
 * the same reason the filament routes check theirs: because the catalogue is
 * code the server can see, a job that does not exist is refused here rather
 * than stored and puzzled over later.
 */
export function validateMaintenanceEventInput(
  body: unknown, now: Date = new Date(),
): MaintenanceEventInput {
  const root = isPlainObject(body) ? body : bad('body', 'body must be a JSON object')
  rejectUnknownKeys(root, EVENT_KEYS)

  const taskKey = root.taskKey
  if (typeof taskKey !== 'string' || taskKey.length === 0) {
    bad('taskKey', 'taskKey must be a non-empty string')
  }
  if (!isMaintenanceTaskKey(taskKey as string)) {
    bad('taskKey', `taskKey "${String(taskKey)}" is not a task in the catalogue`)
  }

  const performedOn = validateDate(root.performedOn, 'performedOn', now)

  let note: string | null = null
  if (root.note !== undefined && root.note !== null) {
    if (typeof root.note !== 'string') bad('note', 'note must be a string')
    const trimmed = (root.note as string).trim()
    if (trimmed.length > LIMITS.maxNoteLength) {
      bad('note', `note accepts at most ${LIMITS.maxNoteLength} characters`)
    }
    // An empty note is stored as no note. A row whose note is "" and a row with
    // no note are the same fact, and only one of them should be representable.
    note = trimmed.length > 0 ? trimmed : null
  }

  return { taskKey: taskKey as string, performedOn, note }
}

/** A positive integer row id from the path. */
export function validateEventId(raw: string): number {
  if (!/^\d{1,15}$/.test(raw)) bad('id', 'id must be a positive whole number')
  const id = Number(raw)
  if (!Number.isSafeInteger(id) || id <= 0) bad('id', 'id must be a positive whole number')
  return id
}
