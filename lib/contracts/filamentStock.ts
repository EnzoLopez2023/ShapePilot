// When to reorder a filament, from what is in the AMS and what is on the shelf.
//
// The signal is the AMS's own percentage, not grams subtracted from a starting
// weight. Bambu reads `remain` off the RFID tag of its own spools, so it is a
// measurement rather than a running estimate, and it does not drift the way
// "1 kg minus every slicer estimate since you bought it" does. What it cannot
// say is how many more of that colour you have, which is what the inventory
// counts are for.
//
// So a colour needs reordering when a loaded spool of it is low and there is no
// spare behind it:
//
//   spares = spools and refills you own of that colour
//            - spools of it currently loaded in the AMS
//
// A loaded spool is one of the ones you own, so it is taken off the count. A
// colour loaded but never ticked in the inventory has no spares by definition,
// which is the right answer: nothing on record says there is another one.
//
// Except when the inventory has already taken it off. Rolls are used up by
// grams printed, and those are slicer estimates that run a few percent high,
// so usage can pass the end of the spool still in the AMS while the AMS reads
// 5% left on it. That spool is then not among the rolls on hand, and taking it
// off again would subtract the unopened roll behind it. So when usage has just
// used up a roll -- the grams it ran past, plus what the AMS still measures on
// the low spool, within estimate drift -- the low spool is that roll, and is
// not taken off twice.
//
// Slots whose percentage is unreported (a third-party spool, a hand-set tray)
// and slots that do not match a catalogue colour are carried but never warn.
// The AMS is the only thing here that knows how full a spool is, and where it
// says nothing, neither does this.
//
// Pure and shared: the server matches slots, and the browser applies the rule
// against the inventory it is editing, so stepping a count up clears a warning
// the moment it is pressed.
import {
  FILAMENT_CATALOG, FILAMENT_LINES, filamentByKey, filamentLineById,
} from './bambuFilaments.ts'
import type { ElementAmsSlot, ElementSnapshot } from './elementStatistics.ts'
import { normalizeColor, reportedHex } from './filamentUsage.ts'

/** At or below this, a loaded spool counts as running low. */
export const LOW_PERCENT = 20

/** What a full Bambu spool or refill holds. The AMS reports a percentage of it. */
export const SPOOL_GRAMS = 1000

/**
 * How far printed grams may run ahead of a spool before it is no longer the
 * one usage just used up: a share of everything printed, since slicer error
 * adds up, and never less than a floor.
 */
export const DRIFT_SHARE = 0.1
export const MIN_DRIFT_GRAMS = 100

/** What the inventory knows from printing, for the colour a slot holds. */
export interface UsageShelf {
  /** Grams printed of the colour, all told. */
  usedGrams: number
  /** Grams printed past the roll usage last used up; see `ColorLedger.overrun`. */
  overrun: number | null
}

export interface LoadedSlot {
  amsId: string
  slotId: string
  /** The catalogue colour, or null if the slot did not match one. */
  key: string | null
  material: string | null
  /** Bambu's product name, e.g. "PLA Basic". */
  subBrand: string | null
  /** `#RRGGBB`, or '' if unreported. */
  color: string
  remainingPercent: number | null
}

export interface AmsStock {
  /** When the printer last reported. The panel says so; it is not hidden when old. */
  receivedAt: string
  slots: LoadedSlot[]
  /**
   * Every unit the report mentioned, loaded or not, so an AMS with nothing in
   * it -- emptied to run its dryer -- is still drawn, as four empty trays.
   * Absent on stock built before this was recorded.
   */
  units?: string[]
}

/**
 * A tray the printer reports nothing about: no material, no brand, no colour.
 * An AMS emptied to dry reports its trays this way rather than as `empty`, and
 * there is no spool there to be unknown -- it is an empty tray.
 */
const blank = (slot: ElementAmsSlot): boolean =>
  !slot.material && !slot.subBrand && !normalizeColor(slot.color)

const LINE_BY_LABEL = new Map(FILAMENT_LINES.map(line => [
  line.label.toUpperCase(), `${line.brand}/${line.material}/${line.type}`,
]))

/**
 * The catalogue colour in a slot: Bambu's product name names the line, and the
 * colour must match exactly within it. A retired code beside its identical
 * replacement resolves to the current one, as usage matching does.
 */
export function matchAmsSlot(slot: Pick<ElementAmsSlot, 'subBrand' | 'color'>): string | null {
  const line = LINE_BY_LABEL.get((slot.subBrand ?? '').trim().toUpperCase())
  const color = normalizeColor(slot.color)
  if (!line || !color) return null
  // A multi-colour spool reports its first colour, as print history does.
  const matches = FILAMENT_CATALOG.filter(entry =>
    entry.line === line && reportedHex(entry) === color)
  if (matches.length === 1) return matches[0].key
  const current = matches.filter(entry => !entry.discontinued)
  return current.length === 1 ? current[0].key : null
}

/** The occupied slots of a snapshot, matched. Null when the AMS was never reported. */
export function amsStockOf(snapshot: ElementSnapshot | null): AmsStock | null {
  if (!snapshot?.ams) return null
  return {
    receivedAt: snapshot.fieldUpdatedAt.ams ?? snapshot.receivedAt,
    units: [...new Set(snapshot.ams.map(slot => slot.amsId))],
    slots: snapshot.ams
      .filter(slot => slot.empty !== true && !blank(slot))
      .map(slot => ({
        amsId: slot.amsId,
        slotId: slot.slotId,
        key: matchAmsSlot(slot),
        material: slot.material,
        subBrand: slot.subBrand,
        color: normalizeColor(slot.color),
        remainingPercent: slot.remainingPercent,
      })),
  }
}

export type StockStatus =
  /** Low, and nothing behind it. */
  | 'reorder'
  /** Low, but a spare is on the shelf. */
  | 'covered'
  /** Loaded and not low. */
  | 'ok'

export interface ColorStock {
  key: string
  /** Every loaded slot of this colour, fullest last. */
  loaded: LoadedSlot[]
  /** The lowest reported percentage among them, or null if none reports one. */
  lowestPercent: number | null
  /** Spools and refills owned, per the inventory. */
  owned: number
  /**
   * `owned` minus loaded spools, never below zero -- less one fewer when usage
   * has already used up the low one.
   */
  spares: number
  status: StockStatus
}

/**
 * Stock for every catalogue colour loaded in the AMS.
 *
 * `ownedOf` is how many of a colour the inventory holds, spools and refills
 * together: a refill is loaded onto a spool, so either can replace an empty.
 * `usageOf`, when given, is what printing says about the colour, so a spool
 * usage has already used up is not taken off a second time (see the header).
 * Reorder warnings sort first, lowest percentage first.
 */
export function stockOf(
  ams: AmsStock | null,
  ownedOf: (key: string) => number,
  usageOf?: (key: string) => UsageShelf | undefined,
): ColorStock[] {
  if (!ams) return []
  const byKey = new Map<string, LoadedSlot[]>()
  for (const slot of ams.slots) {
    if (!slot.key) continue
    const held = byKey.get(slot.key)
    if (held) held.push(slot)
    else byKey.set(slot.key, [slot])
  }

  const rank: Record<StockStatus, number> = { reorder: 0, covered: 1, ok: 2 }
  return [...byKey].map(([key, loaded]) => {
    const reported = loaded
      .map(slot => slot.remainingPercent)
      .filter((value): value is number => value !== null)
    const lowestPercent = reported.length > 0 ? Math.min(...reported) : null
    const owned = ownedOf(key)
    const usage = usageOf?.(key)
    const retired = usage?.overrun != null && lowestPercent !== null
      && (lowestPercent / 100) * SPOOL_GRAMS + usage.overrun
        <= Math.max(MIN_DRIFT_GRAMS, DRIFT_SHARE * usage.usedGrams)
    const spares = Math.max(0, owned - loaded.length + (retired ? 1 : 0))
    const low = lowestPercent !== null && lowestPercent <= LOW_PERCENT
    const status: StockStatus = !low ? 'ok' : spares === 0 ? 'reorder' : 'covered'
    return {
      key,
      loaded: [...loaded].sort((a, b) => (a.remainingPercent ?? 101) - (b.remainingPercent ?? 101)),
      lowestPercent,
      owned,
      spares,
      status,
    }
  }).sort((a, b) => rank[a.status] - rank[b.status]
    || (a.lowestPercent ?? 101) - (b.lowestPercent ?? 101))
}

/** "AMS 1 · slot 2", counting from one as the printer's screen does. */
export const slotLabel = (slot: Pick<LoadedSlot, 'amsId' | 'slotId'>): string => {
  const ams = Number(slot.amsId)
  const tray = Number(slot.slotId)
  return Number.isInteger(ams) && Number.isInteger(tray)
    ? `AMS ${ams + 1} · slot ${tray + 1}`
    : `AMS ${slot.amsId} · slot ${slot.slotId}`
}

/** "PLA Basic · Blue 10601": what a person calls a catalogue colour. */
export function colorLabel(key: string): string {
  const color = filamentByKey(key)
  if (!color) return key
  const line = filamentLineById(color.line)
  return `${line?.label ?? color.line} · ${color.name}${color.code ? ` ${color.code}` : ''}`
}
