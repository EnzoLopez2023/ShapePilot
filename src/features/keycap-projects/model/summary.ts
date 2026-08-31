// The derived reading of a keycap set.
//
// The inventory is stored as line items -- one row per distinct cap -- because
// that is what a photograph shows and what can later seed a pocket label. What
// a person wants to *read* is the breakdown: 1u x 35, 1.25u x 5. That is an
// aggregate, and it belongs here rather than inline in a component, so the
// arithmetic can be tested on its own.
import type { CoverageRow, SetItem } from './types.ts'

export interface SizeRow {
  /** Stable identity for a size, and the join key against coverage. */
  key: string
  units: number
  heightUnits: number
  shape: 'rect' | 'iso-enter'
  /** Caps of this size the set holds. */
  owned: number
  /** Pockets of this size across the project's trays. */
  placed: number
  /** Caps still without a pocket. Never negative -- see `overflow`. */
  remaining: number
  /**
   * Pockets beyond the caps that exist. A tray cut for a set the project no
   * longer describes is a real state, and reading it as "-7 remaining" would
   * hide it rather than show it.
   */
  overflow: number
}

/** How a size is written: 1u, 1.25u, 2u x 2 for a two-row numpad Enter. */
export function sizeLabel(units: number, heightUnits: number, shape?: string | null): string {
  if (shape === 'iso-enter') return 'ISO Enter'
  const width = `${+units.toFixed(2)}u`
  return heightUnits > 1 ? `${width} x ${+heightUnits.toFixed(2)}` : width
}

const keyOf = (units: number, heightUnits: number, shape?: string | null): string =>
  `${+units.toFixed(2)}:${+heightUnits.toFixed(2)}:${shape ?? 'rect'}`

/**
 * Join the set's line items against the trays' pockets, by size.
 *
 * Both sides contribute rows: a size the set holds but no tray has a pocket for
 * is the interesting case, and so is a pocket cut for a cap the set does not
 * contain. Sorted by width, then height, so the list reads like the size
 * vocabulary a person already has.
 */
export function sizeRows(items: readonly SetItem[], coverage: readonly CoverageRow[]): SizeRow[] {
  const rows = new Map<string, SizeRow>()

  const rowFor = (units: number, heightUnits: number, shape?: string | null): SizeRow => {
    const key = keyOf(units, heightUnits, shape)
    let row = rows.get(key)
    if (!row) {
      row = {
        key,
        units,
        heightUnits,
        shape: shape === 'iso-enter' ? 'iso-enter' : 'rect',
        owned: 0,
        placed: 0,
        remaining: 0,
        overflow: 0,
      }
      rows.set(key, row)
    }
    return row
  }

  for (const item of items) {
    rowFor(item.units, item.heightUnits ?? 1, item.shape).owned += item.count ?? 1
  }
  for (const entry of coverage) {
    rowFor(entry.units, entry.heightUnits, entry.shape).placed += entry.pockets
  }

  for (const row of rows.values()) {
    row.remaining = Math.max(0, row.owned - row.placed)
    row.overflow = Math.max(0, row.placed - row.owned)
  }

  return [...rows.values()].sort((a, b) =>
    a.units - b.units || a.heightUnits - b.heightUnits || a.shape.localeCompare(b.shape))
}

export interface SetTotals {
  /** Every cap in the set, counting duplicates. */
  caps: number
  /** Distinct rows, which is roughly "how much typing this took". */
  entries: number
  placed: number
  remaining: number
}

export const setTotals = (rows: readonly SizeRow[], items: readonly SetItem[]): SetTotals => ({
  caps: rows.reduce((sum, r) => sum + r.owned, 0),
  entries: items.length,
  placed: rows.reduce((sum, r) => sum + Math.min(r.placed, r.owned), 0),
  remaining: rows.reduce((sum, r) => sum + r.remaining, 0),
})

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
