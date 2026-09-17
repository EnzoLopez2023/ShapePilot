// Which AMS tray a part prints from.
//
// A part stores a filament *number*, the one Bambu Studio shows once its
// filament list is synced to the AMS: the first unit's trays are 1-4 (A1-A4),
// the second's 5-8 (B1-B4), and so on. That number is what the 3MF export
// writes as the part's extruder, so a synced project lines each body up with
// the spool it was designed for. The external spool and AMS HT units have no
// fixed place in that list and are not offered.
import type { AmsStock } from '../../../lib/contracts/filamentStock.ts'
import type { SceneObject } from '../../model/document.ts'

/** Four AMS units of four trays: as far as Studio's synced list numbers them. */
export const MAX_FILAMENT_SLOT = 16
const TRAYS_PER_UNIT = 4
const UNITS = MAX_FILAMENT_SLOT / TRAYS_PER_UNIT

export interface AmsTray {
  /** 1-based, as Bambu Studio numbers filaments. */
  slot: number
  /** The catalogue colour in the tray, when it matched one; else null. */
  key: string | null
  /** Studio's own name for the tray, e.g. "A1". */
  label: string
  /** `#RRGGBB`, or '' when unreported. */
  color: string
  material: string | null
  /** Bambu's product name, e.g. "PLA Basic". */
  subBrand: string | null
  remainingPercent: number | null
}

export const trayLabel = (slot: number): string => {
  const unit = Math.floor((slot - 1) / TRAYS_PER_UNIT)
  return `${String.fromCharCode(65 + unit)}${((slot - 1) % TRAYS_PER_UNIT) + 1}`
}

/** The loaded trays that have a number, in Studio's order. */
export function amsTrays(stock: AmsStock | null): AmsTray[] {
  if (!stock) return []
  const trays: AmsTray[] = []
  for (const loaded of stock.slots) {
    if (!/^\d+$/.test(loaded.amsId) || !/^\d+$/.test(loaded.slotId)) continue
    const unit = Number(loaded.amsId)
    const tray = Number(loaded.slotId)
    if (unit >= UNITS || tray >= TRAYS_PER_UNIT) continue
    const slot = unit * TRAYS_PER_UNIT + tray + 1
    trays.push({
      slot,
      key: loaded.key,
      label: trayLabel(slot),
      color: loaded.color,
      material: loaded.material,
      subBrand: loaded.subBrand,
      remainingPercent: loaded.remainingPercent,
    })
  }
  return trays.sort((a, b) => a.slot - b.slot)
}

/**
 * The filament number each exported part prints in. A chosen tray is kept; a
 * part left on Auto takes the lowest number no chosen part uses, in scene
 * order -- so a logo dropped onto a model still arrives in its own colour, and
 * Auto never silently shares a tray someone picked on purpose.
 */
export function assignExtruders(
  parts: readonly { filamentSlot?: number }[],
  maxAuto: number,
): number[] {
  const chosen = new Set(parts.flatMap(p => (p.filamentSlot ? [p.filamentSlot] : [])))
  let next = 1
  return parts.map(part => {
    if (part.filamentSlot) return part.filamentSlot
    while (chosen.has(next) && next < maxAuto) next += 1
    const slot = Math.min(next, maxAuto)
    if (next < maxAuto) next += 1
    return slot
  })
}

export interface FilamentWarning {
  message: string
}

/**
 * What is worth saying before export. Only about trays someone chose: an Auto
 * part has made no claim about the AMS to contradict.
 */
export function filamentWarnings(
  objects: readonly SceneObject[],
  trays: readonly AmsTray[] | null,
): FilamentWarning[] {
  const warnings: FilamentWarning[] = []
  const bySlot = new Map<number, SceneObject[]>()
  for (const object of objects) {
    if (!object.filamentSlot || object.mode === 'hole' || !object.visible) continue
    bySlot.set(object.filamentSlot, [...(bySlot.get(object.filamentSlot) ?? []), object])
  }

  for (const [slot, members] of [...bySlot].sort(([a], [b]) => a - b)) {
    const colours = new Set(members.map(o => o.color?.toUpperCase() ?? ''))
    if (members.length > 1 && colours.size > 1) {
      warnings.push({
        message: `${members.map(o => o.name).join(' and ')} are different colours but share`
          + ` tray ${trayLabel(slot)}, so they will print in the same filament.`,
      })
    }
    // Without a report there is nothing to check against; say nothing rather
    // than calling every tray empty.
    if (trays && !trays.some(t => t.slot === slot)) {
      warnings.push({
        message: `Tray ${trayLabel(slot)} is empty in the last AMS report, but`
          + ` ${members.map(o => o.name).join(' and ')} ${members.length === 1 ? 'is' : 'are'} set to print from it.`,
      })
    }
  }
  return warnings
}
