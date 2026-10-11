// What the filament shelf says about a colour, in words.
//
// Shared by the tile, the sheet and the filter bar, and kept out of the
// component files so each of those exports only its component.
import type { FilamentColor, FilamentLine, FilamentVariant } from '../../../../lib/contracts/bambuFilaments.ts'
import type { ColorStock } from '../../../../lib/contracts/filamentStock.ts'
import { SPOOL_GRAMS } from '../../../../lib/contracts/filamentStock.ts'
import { trayName } from './ams.ts'

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

const GRAMS = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

/** "1,921 g": grams to the gram, as a shelf is counted. */
export const formatExactGrams = (grams: number): string => `${GRAMS.format(Math.round(grams))} g`

/** "2 rolls": spools and refills together, because the form only changes the price. */
export const rollsLabel = (rolls: number): string => `${rolls} ${rolls === 1 ? 'roll' : 'rolls'}`

export type StatusFilter = 'all' | 'owned' | 'missing' | 'loaded' | 'used'

export const STATUS_LABEL: Record<StatusFilter, string> = {
  all: 'Any status',
  owned: 'Owned',
  missing: 'Not owned',
  loaded: 'In the AMS',
  used: 'Printed with',
}

