// Fabrication defaults and pocket palette data: the fixed unit library, the one
// built-in special shape (ISO Enter), and the user's "Common" shortlist. Custom
// (backend-stored) items are fetched separately in PocketPalette and merged in
// by the caller.
import { KEY_SIZES, LIBRARY_UNITS } from './presets.ts'
import type { LibraryPocket } from '../service.ts'
import type { FabricationSettings, Pocket } from './types.ts'

export const DEFAULT_FABRICATION: FabricationSettings = {
  toolDiameterMm: 3.175,
  stockThicknessMm: 13,
  plateWidthMm: 256,
  plateDepthMm: 256,
  minWallMm: 1.8,
}

export interface PaletteItem {
  /** Stable across sessions -- used as the React key and the "common" membership key. */
  key: string
  label: string
  typical?: string
  units: number
  shape?: 'iso-enter'
  widthMm?: number
  heightMm?: number
  cornerRadiusMm?: number
  /** Backend-stored custom pockets can be deleted; built-ins can't. */
  libraryId?: string
}

export const ISO_ENTER_ITEM: PaletteItem = {
  key: 'iso-enter',
  label: 'ISO Enter',
  typical: 'Big Enter / Return on ISO boards',
  units: 1.5,
  shape: 'iso-enter',
}

export const unitItems = (units: number[]): PaletteItem[] =>
  units.map(u => ({
    key: `u:${u}`,
    label: `${u}u`,
    units: u,
    typical: KEY_SIZES.find(k => k.units === u)?.typical,
  }))

export const COMMON_ITEMS: PaletteItem[] = [...unitItems(KEY_SIZES.map(k => k.units)), ISO_ENTER_ITEM]
export const ALL_LIBRARY_ITEMS: PaletteItem[] = unitItems(LIBRARY_UNITS)

export const libraryPocketToItem = (p: LibraryPocket): PaletteItem => ({
  key: `custom:${p.id}`,
  label: p.name,
  typical: p.notes,
  units: p.units,
  widthMm: p.widthMm,
  heightMm: p.heightMm,
  cornerRadiusMm: p.cornerRadiusMm,
  libraryId: p.id,
})

/** Seeded once so there's a ready-to-use pocket below the 1u floor of the unit formula. */
export const SMALL_SQUARE_SEED: Omit<LibraryPocket, 'id'> = {
  name: '14mm square',
  units: 0.5,
  widthMm: 14,
  heightMm: 14,
  cornerRadiusMm: 1.5,
  notes: 'Smaller than 1u -- fits small novelty or artisan caps.',
}

// App-owned key. The Hearth-prefixed key is deliberately not read: ShapePilot
// owns its own client-side state and never inherits the monolith's namespace.
const COMMON_KEY = 'shapepilot:keycap-tray:common-pockets'
const DEFAULT_COMMON_KEYS = COMMON_ITEMS.map(i => i.key)

export function loadCommonKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(COMMON_KEY)
    if (!raw) return new Set(DEFAULT_COMMON_KEYS)
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? new Set(arr) : new Set(DEFAULT_COMMON_KEYS)
  } catch {
    return new Set(DEFAULT_COMMON_KEYS)
  }
}

export function saveCommonKeys(keys: Set<string>): void {
  try { localStorage.setItem(COMMON_KEY, JSON.stringify([...keys])) } catch { /* private mode etc. */ }
}

/** The Partial<Pocket> patch to pass as addPocket's `extra` for this item. */
export const paletteItemExtra = (item: PaletteItem): Partial<Pocket> => ({
  label: item.label,
  shape: item.shape,
  widthMm: item.widthMm,
  heightMm: item.heightMm,
  cornerRadiusMm: item.cornerRadiusMm,
})
