// Runtime validation for the filament price write route.
//
// The same shape as the inventory validator beside it, and for the same reason:
// the catalogue is committed code the server can see, so a line that does not
// exist is refused here rather than stored and puzzled over later.
import { ApiError } from '../errors/ApiError.ts'
import { FILAMENT_LINES, filamentLineById } from '../../lib/contracts/bambuFilaments.ts'
import type { FilamentPrice } from '../../lib/db/repositories/contracts.ts'

export const LIMITS = {
  /** One per line, with headroom for the lines a future catalogue run adds. */
  maxEntries: FILAMENT_LINES.length + 50,
  /** Matches the column's CHECK. A spool is priced by hand, not by a machine. */
  maxPricePerKg: 100_000,
} as const

const ENTRY_KEYS = ['line', 'pricePerKg', 'currency'] as const

const bad = (field: string, message: string): never => {
  throw new ApiError(400, 'bad_request', message, { field })
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Validate the whole price list. The body replaces what is stored, so an absent
 * `prices` is not "leave them alone": a caller that means "price nothing" sends
 * `[]`.
 */
export function validateFilamentPricesInput(body: unknown): FilamentPrice[] {
  const root = isPlainObject(body) ? body : bad('body', 'body must be a JSON object')

  for (const key of Object.keys(root)) {
    if (key !== 'prices') bad(key, `body does not accept the field "${key}"`)
  }

  const prices = root.prices
  if (!Array.isArray(prices)) bad('prices', 'prices must be an array')
  const list = prices as unknown[]
  if (list.length > LIMITS.maxEntries) {
    bad('prices', `prices accepts at most ${LIMITS.maxEntries} entries`)
  }

  const seen = new Set<string>()
  const entries: FilamentPrice[] = []

  list.forEach((raw, index) => {
    const field = `prices[${index}]`
    if (!isPlainObject(raw)) bad(field, `${field} must be a JSON object`)
    const entry = raw as Record<string, unknown>

    for (const key of Object.keys(entry)) {
      if (!(ENTRY_KEYS as readonly string[]).includes(key)) {
        bad(`${field}.${key}`, `${field} does not accept the field "${key}"`)
      }
    }

    const line = entry.line
    if (typeof line !== 'string' || !filamentLineById(line)) {
      bad(`${field}.line`, `${field}.line "${String(line)}" is not a line in the catalogue`)
    }
    if (seen.has(line as string)) {
      bad(`${field}.line`, `${String(line)} is priced more than once`)
    }
    seen.add(line as string)

    const pricePerKg = entry.pricePerKg
    if (typeof pricePerKg !== 'number' || !Number.isFinite(pricePerKg)
      || pricePerKg <= 0 || pricePerKg > LIMITS.maxPricePerKg) {
      bad(
        `${field}.pricePerKg`,
        `${field}.pricePerKg must be a number above 0 and at most ${LIMITS.maxPricePerKg}`,
      )
    }

    const currency = entry.currency
    // ISO 4217 is three letters; nothing here converts between currencies, so
    // the code travels with the price rather than being assumed.
    if (typeof currency !== 'string' || !/^[A-Za-z]{3}$/.test(currency)) {
      bad(`${field}.currency`, `${field}.currency must be a three-letter ISO 4217 code`)
    }

    entries.push({
      line: line as string,
      // Stored to the cent: a price is money, and money is not a float show.
      pricePerKg: Math.round((pricePerKg as number) * 100) / 100,
      currency: (currency as string).toUpperCase(),
    })
  })

  return entries.sort((a, b) => a.line < b.line ? -1 : a.line > b.line ? 1 : 0)
}
