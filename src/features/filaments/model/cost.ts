// What the filament in a print is worth.
//
// Priced from what was actually paid: each colour at the average landed cost
// of the rolls bought of it, a colour never bought at its line's average (see
// priceBookOf in lib/contracts/filamentOrders.ts). A colour with neither
// contributes nothing to the total and is counted as unpriced instead -- a
// total that quietly skips half the grams would read as a smaller bill rather
// than an incomplete one.
import type { KilogramPrice } from '../../../../lib/contracts/filamentOrders.ts'

export interface CostTotal {
  /** Money, in `currency`; null when nothing priced was used. */
  amount: number | null
  currency: string | null
  /** Grams that had a price, and grams that did not. */
  pricedGrams: number
  unpricedGrams: number
  /** True when the priced lines do not share one currency, so no total is shown. */
  mixedCurrencies: boolean
}

/** The line a catalogue key belongs to: `<brand>/<material>/<type>/<colour>`. */
export const lineOfKey = (key: string): string =>
  key.split('/').slice(0, 3).join('/')

export function costOf(
  usage: readonly { key: string; grams: number }[],
  priceOf: (key: string) => KilogramPrice | null,
): CostTotal {
  const currencies = new Set<string>()
  let amount = 0
  let pricedGrams = 0
  let unpricedGrams = 0

  for (const entry of usage) {
    const price = priceOf(entry.key)
    if (!price) {
      unpricedGrams += entry.grams
      continue
    }
    currencies.add(price.currency)
    pricedGrams += entry.grams
    amount += (entry.grams / 1000) * price.pricePerKg
  }

  if (currencies.size > 1) {
    return { amount: null, currency: null, pricedGrams, unpricedGrams, mixedCurrencies: true }
  }
  return {
    amount: pricedGrams > 0 ? amount : null,
    currency: [...currencies][0] ?? null,
    pricedGrams,
    unpricedGrams,
    mixedCurrencies: false,
  }
}

/** Money as the viewer's locale writes it, in the currency it was priced in. */
export const formatMoney = (amount: number, currency: string): string =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
