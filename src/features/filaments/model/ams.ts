// The AMS as a set of bays, for drawing it.
//
// The stock report lists only occupied trays, which is right for reorder
// warnings and wrong for a picture: an AMS with one empty tray should look like
// an AMS with a gap in it, not a three-tray unit. So a standard unit is filled
// out to its four trays, and the gaps are drawn as gaps.
import type { AmsStock, LoadedSlot } from '../../../../lib/contracts/filamentStock.ts'

/** A standard AMS (and the AMS 2 Pro) holds four spools. */
const TRAYS_PER_UNIT = 4

/**
 * Unit ids at or above this are single-tray AMS HT units, which report through
 * the same channel but hold one spool each.
 */
const HT_UNIT_ID = 128

export interface AmsBay {
  /** What the printer and Bambu Studio call the tray: "A1", "B3", "HT". */
  label: string
  /** The spool in it, or null for an empty tray. */
  slot: LoadedSlot | null
}

export interface AmsUnit {
  id: string
  /** "AMS 1", "AMS HT", "External spool". */
  name: string
  bays: AmsBay[]
}

const letter = (unit: number): string => String.fromCharCode(65 + unit)

/** "A1" for unit 0 tray 0, matching Bambu Studio's own tray names. */
export function trayName(slot: Pick<LoadedSlot, 'amsId' | 'slotId'>): string {
  if (slot.amsId === 'external') return 'Ext'
  const unit = Number(slot.amsId)
  const tray = Number(slot.slotId)
  if (!Number.isInteger(unit) || !Number.isInteger(tray)) return `${slot.amsId}-${slot.slotId}`
  if (unit >= HT_UNIT_ID) return `HT${unit - HT_UNIT_ID + 1}`
  return `${letter(unit)}${tray + 1}`
}

/** Every reported unit, standard ones filled out to four trays, in the printer's order. */
export function amsUnits(stock: AmsStock | null): AmsUnit[] {
  if (!stock) return []
  const byUnit = new Map<string, LoadedSlot[]>()
  for (const slot of stock.slots) {
    byUnit.set(slot.amsId, [...(byUnit.get(slot.amsId) ?? []), slot])
  }

  const order = (id: string): number => {
    if (id === 'external') return Number.MAX_SAFE_INTEGER
    const value = Number(id)
    return Number.isInteger(value) ? value : Number.MAX_SAFE_INTEGER - 1
  }

  return [...byUnit.keys()].sort((a, b) => order(a) - order(b)).map(id => {
    const slots = byUnit.get(id) ?? []
    const unit = Number(id)
    if (id === 'external') {
      return { id, name: 'External spool', bays: slots.map(slot => ({ label: 'Ext', slot })) }
    }
    if (!Number.isInteger(unit) || unit >= HT_UNIT_ID) {
      return {
        id,
        name: unit >= HT_UNIT_ID ? `AMS HT ${unit - HT_UNIT_ID + 1}` : `AMS ${id}`,
        bays: slots.map(slot => ({ label: trayName(slot), slot })),
      }
    }
    return {
      id,
      name: `AMS ${unit + 1}`,
      bays: Array.from({ length: TRAYS_PER_UNIT }, (_, tray) => ({
        label: `${letter(unit)}${tray + 1}`,
        slot: slots.find(slot => Number(slot.slotId) === tray) ?? null,
      })),
    }
  })
}
