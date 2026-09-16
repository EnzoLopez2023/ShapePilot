import type { FilamentVariant } from '../../../../lib/contracts/bambuFilaments.ts'

/** One filament the account owns, in one of the forms it is sold in, and how many. */
export interface FilamentTick {
  key: string
  variant: FilamentVariant
  /** At least 1. Owning none is the absence of a tick, never a zero. */
  quantity: number
}

/** The most of one filament in one form the page will step to; matches the server. */
export const MAX_QUANTITY = 999

/** `key` and `variant` joined, for map membership. Never stored or sent. */
export const tickId = (key: string, variant: FilamentVariant): string => `${key} ${variant}`

/**
 * The page's working state: tick id to count. A map rather than a set of ticks
 * plus a side table of counts, so "owned" and "how many" can never disagree --
 * an entry is owned exactly when it is present.
 */
export type Inventory = ReadonlyMap<string, number>

export const ticksToInventory = (ticks: readonly FilamentTick[]): Inventory =>
  new Map(ticks.map(tick => [tickId(tick.key, tick.variant), tick.quantity]))

/**
 * Back to the wire shape, in catalogue order. The server sorts what it stores,
 * so sending an ordered body keeps a re-save from looking like a change.
 */
export const inventoryToTicks = (
  owned: Inventory,
  order: readonly { key: string }[],
  variantsOf: (key: string) => readonly FilamentVariant[],
): FilamentTick[] => {
  const ticks: FilamentTick[] = []
  for (const { key } of order) {
    for (const variant of variantsOf(key)) {
      const quantity = owned.get(tickId(key, variant))
      if (quantity !== undefined) ticks.push({ key, variant, quantity })
    }
  }
  return ticks
}

/** Every spool and refill on the shelf, counting each by its quantity. */
export const totalRolls = (owned: Inventory): number => {
  let total = 0
  for (const quantity of owned.values()) total += quantity
  return total
}

/** Spools and refills owned of one colour, both forms together. */
export const ownedByColor = (owned: Inventory): Map<string, number> => {
  const totals = new Map<string, number>()
  for (const [id, quantity] of owned) {
    // tickId is `${key} ${variant}`, and keys never contain a space.
    const key = id.slice(0, id.lastIndexOf(' '))
    totals.set(key, (totals.get(key) ?? 0) + quantity)
  }
  return totals
}
