// Reading a keycap set back for a person.
//
// How a size is written, and how line items group. The arithmetic of what has
// a home lives in allocation.ts, because a pocket's capacity is not its size:
// see the note there.
import type { SetItem } from './types.ts'

/** How a size is written: 1u, 1.25u, 2u x 2 for a two-row numpad Enter. */
export function sizeLabel(units: number, heightUnits: number, shape?: string | null): string {
  if (shape === 'iso-enter') return 'ISO Enter'
  const width = `${+units.toFixed(2)}u`
  return heightUnits > 1 ? `${width} x ${+heightUnits.toFixed(2)}` : width
}

/**
 * Line items grouped for display, in the order the groups first appear so the
 * model's own reading order -- alphas, then modifiers, then the numpad -- is
 * kept rather than alphabetised into nonsense.
 */
export function groupItems(items: readonly SetItem[]): { group: string; items: SetItem[] }[] {
  const groups = new Map<string, SetItem[]>()
  for (const item of items) {
    const name = item.group?.trim() || 'Ungrouped'
    const bucket = groups.get(name)
    if (bucket) bucket.push(item)
    else groups.set(name, [item])
  }
  return [...groups].map(([group, grouped]) => ({ group, items: grouped }))
}
