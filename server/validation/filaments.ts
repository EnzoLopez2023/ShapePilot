// Complete runtime validation for the filament inventory write route.
//
// The combinators are a fourth copy, for the reason given at the top of
// server/validation/keycapProject.ts: each validator keeps bounds tuned to what
// it validates, and unifying them is a refactor of heavily tested files rather
// than part of this feature. This one is much the smallest -- an entry is two
// strings, and both are drawn from a closed catalogue.
//
// The catalogue is what makes this validator possible at all. Because
// lib/contracts/bambuFilaments.ts is committed code visible to the server, an
// unknown filament and an impossible variant are both refused here rather than
// stored and puzzled over later.
import { ApiError } from '../errors/ApiError.ts'
import {
  FILAMENT_PAIR_COUNT, filamentByKey, isFilamentVariantFor,
} from '../../lib/contracts/bambuFilaments.ts'
import type { FilamentInventoryEntry } from '../../lib/db/repositories/contracts.ts'

export const LIMITS = {
  /**
   * Every tick the catalogue allows, with headroom for the colours a future
   * generate run adds. Bounded rather than unbounded: this is the one place a
   * hostile payload could otherwise ask for an arbitrarily large transaction.
   */
  maxEntries: FILAMENT_PAIR_COUNT + 200,
} as const

const ENTRY_KEYS = ['key', 'variant'] as const

const bad = (field: string, message: string): never => {
  throw new ApiError(400, 'bad_request', message, { field })
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Validate a whole inventory. The body replaces what the account owns, so an
 * absent `owned` is not "leave it alone" -- there is nothing to leave alone but
 * the list itself, and a caller that means "own nothing" sends `[]`.
 */
export function validateFilamentInventoryInput(body: unknown): FilamentInventoryEntry[] {
  const root = isPlainObject(body) ? body : bad('body', 'body must be a JSON object')

  for (const key of Object.keys(root as Record<string, unknown>)) {
    if (key !== 'owned') bad(`${key}`, `body does not accept the field "${key}"`)
  }

  const owned = (root as Record<string, unknown>).owned
  if (!Array.isArray(owned)) bad('owned', 'owned must be an array')
  const list = owned as unknown[]
  if (list.length > LIMITS.maxEntries) {
    bad('owned', `owned accepts at most ${LIMITS.maxEntries} entries`)
  }

  const seen = new Set<string>()
  const entries: FilamentInventoryEntry[] = []

  list.forEach((raw, index) => {
    const field = `owned[${index}]`
    if (!isPlainObject(raw)) bad(field, `${field} must be a JSON object`)
    const entry = raw as Record<string, unknown>

    for (const key of Object.keys(entry)) {
      if (!(ENTRY_KEYS as readonly string[]).includes(key)) {
        bad(`${field}.${key}`, `${field} does not accept the field "${key}"`)
      }
    }

    const key = entry.key
    if (typeof key !== 'string' || key.length === 0) {
      bad(`${field}.key`, `${field}.key must be a non-empty string`)
    }
    if (!filamentByKey(key as string)) {
      bad(`${field}.key`, `${field}.key "${String(key)}" is not a filament in the catalogue`)
    }

    const variant = entry.variant
    if (typeof variant !== 'string') {
      bad(`${field}.variant`, `${field}.variant must be a string`)
    }
    // Not merely "is this a known variant" but "is this filament sold this way":
    // ABS has no refill, and a tick that claims one describes a product that
    // does not exist.
    if (!isFilamentVariantFor(key as string, variant as string)) {
      bad(
        `${field}.variant`,
        `${String(key)} is not sold as "${String(variant)}"`,
      )
    }

    // Refused rather than quietly deduped. A body that ticks the same spool
    // twice is a client bug, and silently accepting it would hand back an
    // inventory the caller did not send.
    const pair = `${String(key)} ${String(variant)}`
    if (seen.has(pair)) {
      bad(field, `${field} repeats a filament already in owned`)
    }
    seen.add(pair)

    entries.push({ key: key as string, variant: variant as FilamentInventoryEntry['variant'] })
  })

  return entries
}
