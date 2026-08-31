// How much of a keycap set the trays actually have a home for.
//
// The naive reading -- count pockets of size N, compare to caps of size N --
// is wrong for the way these trays are really cut. A named cap (Enter, Shift,
// Backspace, Tab, Caps Lock, the bottom-row modifiers, the spacebar) needs a
// pocket of its own size, because nothing else holds it properly. Plain 1u
// caps do not: a row of them goes into one long trough to save the walls
// between, so a 10u pocket is not "one 10u cap", it is ten 1u caps.
//
// So allocation runs in two passes:
//
//   1. Every cap that is not a plain 1u is matched against a pocket of exactly
//      its size, height and shape. That is a hard requirement.
//   2. Every pocket left over -- the long troughs, and any exact-size pocket
//      no cap claimed -- contributes however many 1u caps fit across it.
//
// The order matters: matching the named caps first means a 2.25u pocket is
// read as the Enter's home rather than as two 1u slots, which is what the
// person cutting the tray intended when they drew it.
import { pocketWidth } from '../../keycap-tray/geometry/shapes.ts'
import type { PocketSizing } from '../../keycap-tray/geometry/shapes.ts'
import type { SetItem } from './types.ts'
import { sizeLabel } from './summary.ts'

/** Just enough of a pocket to allocate against; both trays and coverage rows fit. */
export interface PocketShape {
  units: number
  heightUnits: number
  shape: 'rect' | 'iso-enter' | null
}

const sizeKey = (units: number, heightUnits: number, shape?: string | null): string =>
  `${+units.toFixed(2)}:${+heightUnits.toFixed(2)}:${shape === 'iso-enter' ? 'iso-enter' : 'rect'}`

/** A plain 1u cap: the only kind that shares a trough. */
const isPlainOneUnit = (units: number, heightUnits: number, shape?: string | null): boolean =>
  units === 1 && heightUnits === 1 && (shape ?? 'rect') === 'rect'

/**
 * How many 1u caps fit across a pocket.
 *
 * From the real widths rather than the unit count, because `widthOffset` is
 * editable and a pocket is `pitch * u + offset` wide -- so a 10u pocket is
 * fractionally wider than ten 1u pockets, and rounding the ratio is what says
 * whether that buys another cap.
 *
 * An ISO Enter pocket is not a trough. Its footprint is an L, and loose caps in
 * it would not sit in a row.
 */
export function troughCapacity(pocket: PocketShape, sizing: PocketSizing): number {
  if (pocket.shape === 'iso-enter') return 0
  const single = pocketWidth(1, sizing)
  if (single <= 0) return 0
  return Math.max(0, Math.floor(pocketWidth(pocket.units, sizing) / single))
}

export interface AllocationRow {
  key: string
  units: number
  heightUnits: number
  shape: 'rect' | 'iso-enter'
  label: string
  owned: number
  /** Pockets of exactly this size that a cap of this size claimed. */
  placed: number
  left: number
}

export interface OneUnitAllocation {
  owned: number
  /** 1u caps the leftover pockets can hold, across every tray in the project. */
  slots: number
  placed: number
  left: number
  /** Slots beyond the 1u caps that exist. */
  spare: number
}

export interface SetAllocation {
  /** Named sizes, narrowest first. Excludes plain 1u, which has its own row. */
  rows: AllocationRow[]
  oneUnit: OneUnitAllocation
  /** Every cap still without a home, 1u included. */
  left: number
  owned: number
  placed: number
}

/**
 * Allocate a set across every pocket in a project.
 *
 * `pockets` is the whole project's worth -- the other trays' saved pockets plus
 * the one being edited -- because "what is left to cut" is a question about the
 * set, not about one tray.
 */
export function allocateSet(
  items: readonly SetItem[],
  pockets: readonly PocketShape[],
  sizing: PocketSizing,
): SetAllocation {
  // -- caps, split by whether they can share a trough ------------------------
  const named = new Map<string, AllocationRow>()
  let oneUnitOwned = 0

  for (const item of items) {
    const units = item.units
    const heightUnits = item.heightUnits ?? 1
    const shape = item.shape ?? 'rect'
    const count = item.count ?? 1
    if (isPlainOneUnit(units, heightUnits, shape)) {
      oneUnitOwned += count
      continue
    }
    const key = sizeKey(units, heightUnits, shape)
    const row = named.get(key)
    if (row) row.owned += count
    else {
      named.set(key, {
        key,
        units,
        heightUnits,
        shape: shape === 'iso-enter' ? 'iso-enter' : 'rect',
        label: sizeLabel(units, heightUnits, shape),
        owned: count,
        placed: 0,
        left: 0,
      })
    }
  }

  // -- pass one: a named cap needs a pocket of exactly its size --------------
  const available = new Map<string, number>()
  for (const pocket of pockets) {
    const key = sizeKey(pocket.units, pocket.heightUnits, pocket.shape)
    available.set(key, (available.get(key) ?? 0) + 1)
  }

  for (const row of named.values()) {
    const matched = Math.min(row.owned, available.get(row.key) ?? 0)
    row.placed = matched
    row.left = row.owned - matched
    available.set(row.key, (available.get(row.key) ?? 0) - matched)
  }

  // -- pass two: whatever is left becomes 1u slots ---------------------------
  // Includes surplus exact-size pockets: a second 2.25u pocket with only one
  // Enter to put in it is two more 1u slots, not a wasted pocket.
  let slots = 0
  const spent = new Map(available)
  for (const pocket of pockets) {
    const key = sizeKey(pocket.units, pocket.heightUnits, pocket.shape)
    const remaining = spent.get(key) ?? 0
    if (remaining <= 0) continue
    spent.set(key, remaining - 1)
    slots += troughCapacity(pocket, sizing)
  }

  const oneUnitPlaced = Math.min(oneUnitOwned, slots)
  const rows = [...named.values()].sort((a, b) =>
    a.units - b.units || a.heightUnits - b.heightUnits || a.shape.localeCompare(b.shape))

  const owned = oneUnitOwned + rows.reduce((sum, r) => sum + r.owned, 0)
  const placed = oneUnitPlaced + rows.reduce((sum, r) => sum + r.placed, 0)

  return {
    rows,
    oneUnit: {
      owned: oneUnitOwned,
      slots,
      placed: oneUnitPlaced,
      left: oneUnitOwned - oneUnitPlaced,
      spare: Math.max(0, slots - oneUnitOwned),
    },
    left: owned - placed,
    owned,
    placed,
  }
}
