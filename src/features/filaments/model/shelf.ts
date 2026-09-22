// What the filament shelf says about a colour, in words.
//
// Shared by the tile, the sheet and the filter bar, and kept out of the
// component files so each of those exports only its component.
import type { FilamentColor, FilamentLine, FilamentVariant } from '../../../../lib/contracts/bambuFilaments.ts'
import type { ColorStock } from '../../../../lib/contracts/filamentStock.ts'
import { SPOOL_GRAMS } from '../../../../lib/contracts/filamentStock.ts'
import { trayName } from './ams.ts'
import { tickId } from './types.ts'
import type { Inventory } from './types.ts'

/** What one of each form is called when counting them. */
export const VARIANT_NOUN: Record<FilamentVariant, readonly [string, string]> = {
  spool: ['spool', 'spools'],
  refill: ['refill', 'refills'],
}

export const countOf = (variant: FilamentVariant, quantity: number): string =>
  `${quantity} ${VARIANT_NOUN[variant][quantity === 1 ? 0 : 1]}`

/** Spoken form, for the checkbox's accessible name. */
const VARIANT_SPOKEN: Record<FilamentVariant, string> = {
  spool: 'with spool',
  refill: 'refill',
}

/** The full name a checkbox is known by: "PLA Basic Jade White 10100, with spool". */
export const tickName = (line: FilamentLine, color: FilamentColor, variant: FilamentVariant) =>
  `${line.label} ${color.name}${color.code ? ` ${color.code}` : ''}, ${VARIANT_SPOKEN[variant]}`

/**
 * What the AMS says about a loaded colour, in one line. The tray first, as the
 * printer names it; the percentage is what the AMS measures; the grams are
 * that share of a full spool, because grams are what a print is quoted in.
 */
export function stockNote(stock: ColorStock): string {
  const trays = stock.loaded.map(trayName).join(', ')
  const base = stock.lowestPercent === null
    ? `In ${trays}`
    : `${trays} · ${stock.lowestPercent}% · ≈${Math.round((stock.lowestPercent / 100) * SPOOL_GRAMS)} g`
  if (stock.status === 'reorder') return `${base} · reorder`
  if (stock.status === 'covered') return `${base} · spare on shelf`
  return base
}

/** What the tile says about ownership, spoken and shown alike. */
export const ownedSummary = (
  line: FilamentLine, quantities: Readonly<Record<FilamentVariant, number>>,
): string | null => {
  const parts = line.variants
    .filter(variant => quantities[variant] > 0)
    .map(variant => countOf(variant, quantities[variant]))
  return parts.length ? parts.join(' + ') : null
}

export const quantitiesOf = (
  owned: Inventory, key: string,
): Record<FilamentVariant, number> => ({
  spool: owned.get(tickId(key, 'spool')) ?? 0,
  refill: owned.get(tickId(key, 'refill')) ?? 0,
})

export type StatusFilter = 'all' | 'owned' | 'missing' | 'loaded' | 'used'

export const STATUS_LABEL: Record<StatusFilter, string> = {
  all: 'Any status',
  owned: 'Owned',
  missing: 'Not owned',
  loaded: 'In the AMS',
  used: 'Printed with',
}

