// The shape-checking primitives every validator in this folder is built from.
//
// They were extracted from `keycapTray.ts` unchanged when the switch tray
// needed the same refusals. The contract each one keeps: a number is a number
// and never a coerced string, an unknown key is a 400 rather than a silently
// dropped field, and nothing reaches a repository until it has been rebuilt
// here from validated parts.
import { ApiError } from '../errors/ApiError.ts'

const bad = (field: string, message: string): never => {
  throw new ApiError(400, 'bad_request', message, { field })
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(value)) bad(field, `${field} must be a JSON object`)
  return value as Record<string, unknown>
}

function rejectUnknownKeys(
  value: Record<string, unknown>, allowed: readonly string[], field: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      bad(`${field}.${key}`, `${field} does not accept the field "${key}"`)
    }
  }
}

const absent = (value: unknown): boolean => value === undefined || value === null

interface NumberBounds {
  /** Reject values at or below this bound. */
  exclusiveMin?: number
  min?: number
  max: number
  integer?: boolean
}

/**
 * A number and nothing else. `"1"`, `true`, `NaN`, `Infinity` and `1e400` are
 * all refused rather than coerced — SQLite would happily store the string.
 */
function requireNumber(value: unknown, field: string, bounds: NumberBounds): number {
  if (typeof value !== 'number') {
    bad(field, `${field} must be a number`)
  }
  const numeric = value as number
  if (!Number.isFinite(numeric)) {
    bad(field, `${field} must be a finite number`)
  }
  if (bounds.integer && !Number.isInteger(numeric)) {
    bad(field, `${field} must be an integer`)
  }
  if (bounds.exclusiveMin !== undefined && numeric <= bounds.exclusiveMin) {
    bad(field, `${field} must be greater than ${bounds.exclusiveMin}`)
  }
  if (bounds.min !== undefined && numeric < bounds.min) {
    bad(field, `${field} must be at least ${bounds.min}`)
  }
  if (Math.abs(numeric) > bounds.max) {
    bad(field, `${field} must be within ±${bounds.max}`)
  }
  return numeric
}

const optionalNumber = (
  value: unknown, field: string, bounds: NumberBounds,
): number | undefined => (absent(value) ? undefined : requireNumber(value, field, bounds))

function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') bad(field, `${field} must be text`)
  const text = value as string
  if (text.length > maxLength) {
    bad(field, `${field} must be at most ${maxLength} characters`)
  }
  return text
}

const optionalString = (
  value: unknown, field: string, maxLength: number,
): string | undefined => (absent(value) ? undefined : requireString(value, field, maxLength))

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') bad(field, `${field} must be true or false`)
  return value as boolean
}

function requireEnum<T extends string>(
  value: unknown, field: string, allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    bad(field, `${field} must be one of ${allowed.join(', ')}`)
  }
  return value as T
}


export {
  bad, isPlainObject, requireObject, rejectUnknownKeys, absent,
  requireNumber, optionalNumber, requireString, optionalString,
  optionalBoolean, requireEnum,
}
export type { NumberBounds }
