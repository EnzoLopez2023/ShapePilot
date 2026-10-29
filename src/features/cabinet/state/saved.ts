// Named cabinets, kept on the server beside the owner's other designs.
//
// A cabinet is a dozen numbers, so "Save As" is a named copy of those numbers --
// there is no design id. The name is the identity (saving over it replaces it)
// and doubles as the label that prefixes every exported file.
import { apiRequest } from '../../../services/http.ts'
import { readCabinetSettings } from './params.ts'
import type { CabinetSettings } from './params.ts'

export const LABEL_MAX = 60

const base = '/cabinets'
// Cabinets used to live in this browser only; they are uploaded once, then cleared.
const LEGACY_KEY = 'shapepilot:cabinet:saved'

export interface SavedCabinet {
  name: string
  settings: CabinetSettings
}

interface CabinetRecord {
  name: string
  params: unknown
  updatedAt: string
}

const toSettings = (r: CabinetRecord, baseline: CabinetSettings): CabinetSettings =>
  ({ ...readCabinetSettings(r.params, baseline), label: r.name })

const put = (name: string, settings: CabinetSettings) =>
  apiRequest<{ ok: true }>(base, { method: 'PUT', body: { name, params: { ...settings, label: name } } })

/** Browser-only cabinets from before the server held them, or none. */
function legacyCabinets(): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '{}')
    return typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

async function adoptLegacy(baseline: CabinetSettings, onServer: Set<string>): Promise<boolean> {
  const local = Object.entries(legacyCabinets())
  if (local.length === 0) return false
  try {
    for (const [name, raw] of local) {
      // A cabinet already saved under that name on the server is the newer one.
      if (!onServer.has(name)) await put(name, { ...readCabinetSettings(raw, baseline), label: name })
    }
    localStorage.removeItem(LEGACY_KEY)
    return true
  } catch {
    return false
  }
}

export async function listCabinets(baseline: CabinetSettings): Promise<SavedCabinet[]> {
  let records = await apiRequest<CabinetRecord[]>(base)
  if (await adoptLegacy(baseline, new Set(records.map(r => r.name)))) {
    records = await apiRequest<CabinetRecord[]>(base)
  }
  return records.map(r => ({ name: r.name, settings: toSettings(r, baseline) }))
}

export const saveCabinet = async (name: string, settings: CabinetSettings): Promise<void> => {
  await put(name, settings)
}

export const deleteCabinet = async (name: string): Promise<void> => {
  await apiRequest<{ ok: true }>(`${base}?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
}
