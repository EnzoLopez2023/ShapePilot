// Runtime validation for the cabinet write route. A cabinet is a flat record of
// numbers and flags, so the check is on shape and size; the designer rebuilds
// every field against its own bounds when it opens one.
import {
  bad, isPlainObject, rejectUnknownKeys, requireObject, requireString,
} from './primitives.ts'

export const CABINET_NAME_MAX = 60
const PARAM_KEYS_MAX = 40

export function validateCabinetName(value: unknown, field = 'name'): string {
  const name = requireString(value, field, CABINET_NAME_MAX).trim()
  if (!name) bad(field, `${field} is required`)
  return name
}

export function validateCabinetInput(value: unknown): { name: string; params: Record<string, unknown> } {
  const body = requireObject(value, 'body')
  rejectUnknownKeys(body, ['name', 'params'], 'body')
  const params = body.params
  if (!isPlainObject(params)) bad('params', 'params must be an object')
  const entries = Object.entries(params as Record<string, unknown>)
  if (entries.length > PARAM_KEYS_MAX) bad('params', `params holds at most ${PARAM_KEYS_MAX} fields`)
  for (const [key, v] of entries) {
    const ok = typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))
      || (typeof v === 'string' && v.length <= CABINET_NAME_MAX)
    if (!ok) bad(`params.${key}`, `params.${key} must be a number, flag or short text`)
  }
  return { name: validateCabinetName(body.name), params: { ...(params as Record<string, unknown>) } }
}
