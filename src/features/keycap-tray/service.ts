// Keycap tray designer — API client.
//
// Ported from src/KeycapTray/api.ts at Hearth commit
// f0b05fc1dbf53e8aa26c215d8e858894a2793871. Only design parameters cross the
// wire; STL/3MF/SVG/DXF are generated in the browser. The Hearth
// `getApiBaseUrl()` coupling is replaced by the app's same-origin client.
import { apiRequest } from '../../services/http.ts'
import type { Pocket, TrayDesign, TrayProfile } from './model/types.ts'
import type { PocketSizing } from './geometry/shapes.ts'
import { PYTHON_SIZING } from './geometry/shapes.ts'

export interface DesignSummary {
  id: string
  name: string
  notes?: string
  profileKind: TrayProfile['kind']
  pocketCount: number
  createdAt: string
  updatedAt: string
}

export interface LibraryPocket {
  id: string
  name: string
  units: number
  widthMm?: number
  heightMm?: number
  cornerRadiusMm?: number
  notes?: string
}

const base = '/keycap-trays'

const payload = (d: TrayDesign) => ({
  name: d.name,
  notes: d.notes,
  profile: d.profile,
  sizing: d.sizing,
  floorThicknessMm: d.floorThicknessMm,
  pocketDepthMm: d.pocketDepthMm,
  engraveDepthMm: d.engraveDepthMm,
  pockets: d.pockets,
})

export const listDesigns = () => apiRequest<DesignSummary[]>(base)

export const hydrateDesignSizing = (design: TrayDesign): TrayDesign =>
  Object.keys(design.sizing).length === 0
    ? { ...design, sizing: { ...PYTHON_SIZING } }
    : design

export const getDesign = async (id: string): Promise<TrayDesign> =>
  hydrateDesignSizing(await apiRequest<TrayDesign>(`${base}/${id}`))

export const createDesign = (d: TrayDesign) =>
  apiRequest<{ id: string }>(base, { method: 'POST', body: payload(d) })

export const updateDesign = (id: string, d: TrayDesign) =>
  apiRequest<{ ok: true }>(`${base}/${id}`, { method: 'PUT', body: payload(d) })

export const cloneDesign = (id: string, name?: string) =>
  apiRequest<{ id: string }>(`${base}/${id}/clone`, { method: 'POST', body: { name } })

export const deleteDesign = (id: string) =>
  apiRequest<{ ok: true }>(`${base}/${id}`, { method: 'DELETE' })

export const listLibraryPockets = () =>
  apiRequest<LibraryPocket[]>(`${base}/library/pockets`)

export const saveLibraryPocket = (p: Omit<LibraryPocket, 'id'>) =>
  apiRequest<{ id: string }>(`${base}/library/pockets`, { method: 'POST', body: p })

export const deleteLibraryPocket = (id: string) =>
  apiRequest<{ ok: true }>(`${base}/library/pockets/${id}`, { method: 'DELETE' })

export type { Pocket, TrayDesign, TrayProfile, PocketSizing }
