// Named cabinets, kept in this browser beside the working settings.
//
// A cabinet is a dozen numbers, so "Save As" is a named copy of those numbers in
// localStorage -- there is no server-side design to open. The name doubles as the
// label that prefixes every exported file.
import { readCabinetSettings } from './params.ts'
import type { CabinetSettings } from './params.ts'

const KEY = 'shapepilot:cabinet:saved'
export const LABEL_MAX = 60

type Saved = Record<string, unknown>

const readAll = (): Saved => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return typeof raw === 'object' && raw !== null ? raw as Saved : {}
  } catch {
    return {}
  }
}

export const savedCabinetNames = (): string[] =>
  Object.keys(readAll()).sort((a, b) => a.localeCompare(b))

export function saveCabinet(name: string, settings: CabinetSettings): boolean {
  try {
    const all = readAll()
    all[name] = { ...settings, label: name }
    localStorage.setItem(KEY, JSON.stringify(all))
    return true
  } catch {
    return false
  }
}

export const loadCabinet = (name: string, baseline: CabinetSettings): CabinetSettings | null => {
  const raw = readAll()[name]
  return raw === undefined ? null : { ...readCabinetSettings(raw, baseline), label: name }
}

export function deleteCabinet(name: string): void {
  try {
    const all = readAll()
    delete all[name]
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch { /* nothing to forget */ }
}
