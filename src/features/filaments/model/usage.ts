// Presentation helpers for print usage.
// Shared with the server, which writes the same labels into push notifications.
export { colorLabel } from '../../../../lib/contracts/filamentStock.ts'
import type { FilamentSource } from '../../../../lib/contracts/filamentUsage.ts'

/**
 * Grams as a person reads a spool: "581 g" under a kilogram, "1.2 kg" over.
 * Whole grams only -- these are slicer estimates, and a decimal would claim a
 * precision the number does not have.
 */
export function formatGrams(grams: number): string {
  if (grams >= 1000) return `${(grams / 1000).toFixed(grams >= 10_000 ? 0 : 1)} kg`
  return `${Math.round(grams)} g`
}

/** What a print reported, compactly: "PLA · GFA00 · #307FE2". */
export function sourceLabel(source: FilamentSource): string {
  return [source.material || 'Unknown material', source.filamentId, source.color || 'no colour']
    .filter(Boolean).join(' · ')
}
