import type { FilamentVariant } from '../../../../lib/contracts/bambuFilaments.ts'

/** One filament the account owns, in one of the forms it is sold in. */
export interface FilamentTick {
  key: string
  variant: FilamentVariant
}

/** `key` and `variant` joined, for set membership. Never stored or sent. */
export const tickId = (key: string, variant: FilamentVariant): string => `${key} ${variant}`

export const ticksToSet = (ticks: readonly FilamentTick[]): Set<string> =>
  new Set(ticks.map(tick => tickId(tick.key, tick.variant)))

/**
 * Back to the wire shape, in catalogue order. The server sorts what it stores,
 * so sending an ordered body keeps a re-save from looking like a change.
 */
export const setToTicks = (
  owned: ReadonlySet<string>,
  order: readonly { key: string }[],
  variantsOf: (key: string) => readonly FilamentVariant[],
): FilamentTick[] => {
  const ticks: FilamentTick[] = []
  for (const { key } of order) {
    for (const variant of variantsOf(key)) {
      if (owned.has(tickId(key, variant))) ticks.push({ key, variant })
    }
  }
  return ticks
}
