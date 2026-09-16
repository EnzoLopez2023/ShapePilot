// Complete runtime validation for the filament usage mapping write route.
//
// A mapping names a source exactly as lib/contracts/filamentUsage.ts
// normalises one, so the validator insists on the normalised form rather than
// normalising for the caller. A link stored under "pla" would never match a
// print that reported "PLA", and it would sit in the table looking correct.
import { ApiError } from '../errors/ApiError.ts'
import { filamentByKey } from '../../lib/contracts/bambuFilaments.ts'
import { normalizeColor, sourceId } from '../../lib/contracts/filamentUsage.ts'
import type { FilamentUsageMapping } from '../../lib/contracts/filamentUsage.ts'

export const LIMITS = {
  /** Far more distinct filaments than one printer's history produces. */
  maxMappings: 500,
  maxFieldLength: 80,
} as const

const MAPPING_KEYS = ['source', 'key'] as const
const SOURCE_KEYS = ['material', 'filamentId', 'color'] as const

const bad = (field: string, message: string): never => {
  throw new ApiError(400, 'bad_request', message, { field })
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const onlyKeys = (object: Record<string, unknown>, allowed: readonly string[], field: string) => {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) bad(`${field}${key}`, `${field || 'body'} does not accept the field "${key}"`)
  }
}

/** An upper-case identifier as the normaliser produces it, or ''. */
const token = (value: unknown, field: string): string => {
  if (typeof value !== 'string') bad(field, `${field} must be a string`)
  const text = value as string
  if (text.length > LIMITS.maxFieldLength) {
    bad(field, `${field} accepts at most ${LIMITS.maxFieldLength} characters`)
  }
  if (text !== text.trim().toUpperCase()) {
    bad(field, `${field} must be trimmed and upper-case, as prints report it once normalised`)
  }
  return text
}

export function validateFilamentUsageMappingsInput(body: unknown): FilamentUsageMapping[] {
  const root = isPlainObject(body) ? body : bad('body', 'body must be a JSON object')
  onlyKeys(root as Record<string, unknown>, ['mappings'], '')
  const list = (root as Record<string, unknown>).mappings
  if (!Array.isArray(list)) bad('mappings', 'mappings must be an array')
  if ((list as unknown[]).length > LIMITS.maxMappings) {
    bad('mappings', `mappings accepts at most ${LIMITS.maxMappings} entries`)
  }

  const seen = new Set<string>()
  return (list as unknown[]).map((raw, index) => {
    const field = `mappings[${index}]`
    if (!isPlainObject(raw)) bad(field, `${field} must be a JSON object`)
    const entry = raw as Record<string, unknown>
    onlyKeys(entry, MAPPING_KEYS, `${field}.`)

    if (!isPlainObject(entry.source)) bad(`${field}.source`, `${field}.source must be a JSON object`)
    const source = entry.source as Record<string, unknown>
    onlyKeys(source, SOURCE_KEYS, `${field}.source.`)

    const material = token(source.material, `${field}.source.material`)
    const filamentId = token(source.filamentId, `${field}.source.filamentId`)
    if (typeof source.color !== 'string') bad(`${field}.source.color`, `${field}.source.color must be a string`)
    const color = source.color as string
    if (color !== '' && normalizeColor(color) !== color) {
      bad(`${field}.source.color`, `${field}.source.color must be "#RRGGBB" in upper case, or empty`)
    }

    const key = entry.key
    if (key !== null) {
      if (typeof key !== 'string') bad(`${field}.key`, `${field}.key must be a catalogue key or null`)
      if (!filamentByKey(key as string)) {
        bad(`${field}.key`, `${field}.key "${String(key)}" is not a filament in the catalogue`)
      }
    }

    const mapping: FilamentUsageMapping = {
      source: { material, filamentId, color },
      key: key as string | null,
    }
    // One link per source. Two would be two answers to one question.
    const id = sourceId(mapping.source)
    if (seen.has(id)) bad(field, `${field} links a filament that is already linked`)
    seen.add(id)
    return mapping
  })
}
