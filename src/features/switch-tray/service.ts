// Switch tray designer — API client.
//
// Only parameters cross the wire; the cell layout is regenerated in the browser
// from them, and STL/3MF are written there too.
import { apiRequest } from '../../services/http.ts'
import type { SwitchTrayDesign, TrayProfile } from './model/types.ts'

export interface SwitchTraySummary {
  id: string
  name: string
  notes?: string
  profileKind: TrayProfile['kind']
  /** Denormalised by the server so a picker can name the switch. */
  switchLabel: string
  createdAt: string
  updatedAt: string
}

const base = '/switch-trays'

const payload = (d: SwitchTrayDesign) => ({
  name: d.name,
  notes: d.notes,
  profile: d.profile,
  switch: d.switch,
  plate: d.plate,
  fill: d.fill,
  // Absent clears it server-side, which is what "turned it off" means.
  feet: d.feet ?? null,
  nameplate: d.nameplate ?? null,
  skippedCells: d.skippedCells ?? null,
  caseClearHeightMm: d.caseClearHeightMm ?? null,
})

export const listDesigns = () => apiRequest<SwitchTraySummary[]>(base)

export const getDesign = (id: string) => apiRequest<SwitchTrayDesign>(`${base}/${id}`)

export const createDesign = (d: SwitchTrayDesign) =>
  apiRequest<{ id: string }>(base, { method: 'POST', body: payload(d) })

export const updateDesign = (id: string, d: SwitchTrayDesign) =>
  apiRequest<{ ok: true }>(`${base}/${id}`, { method: 'PUT', body: payload(d) })

export const cloneDesign = (id: string, name?: string) =>
  apiRequest<{ id: string }>(`${base}/${id}/clone`, { method: 'POST', body: { name } })

export const deleteDesign = (id: string) =>
  apiRequest<{ ok: true }>(`${base}/${id}`, { method: 'DELETE' })

export type { SwitchTrayDesign, TrayProfile }
