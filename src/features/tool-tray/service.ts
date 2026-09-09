// Tool tray designer — API client.
//
// Pockets cross the wire whole, because they are placed rather than generated:
// there is nothing to regenerate them from. Everything downstream of the design
// -- the bands, the mesh, STL and 3MF -- is still computed in the browser.
import { apiRequest } from '../../services/http.ts'
import type { ToolTrayDesign } from './model/types.ts'
import type { TrayProfile } from '../../model/trayProfile.ts'

export interface ToolTraySummary {
  id: string
  name: string
  notes?: string
  profileKind: TrayProfile['kind']
  /** Denormalised by the server, so a picker never parses the pockets blob. */
  pocketCount: number
  createdAt: string
  updatedAt: string
}

const base = '/tool-trays'

const payload = (d: ToolTrayDesign) => ({
  name: d.name,
  // Always sent, even when unset: the server normalises absent to null anyway,
  // and a key that comes and goes makes the client/server field-set guard in
  // `test/ui/toolTrayPage.test.tsx` meaningless.
  notes: d.notes ?? null,
  profile: d.profile,
  heightMm: d.heightMm,
  layerHeightMm: d.layerHeightMm,
  minFloorMm: d.minFloorMm,
  pockets: d.pockets,
  // Absent clears it server-side, which is what "turned it off" means.
  feet: d.feet ?? null,
  undersideReliefs: d.undersideReliefs ?? null,
  caseClearHeightMm: d.caseClearHeightMm ?? null,
})

export const listDesigns = () => apiRequest<ToolTraySummary[]>(base)

export const getDesign = (id: string) => apiRequest<ToolTrayDesign>(`${base}/${id}`)

export const createDesign = (d: ToolTrayDesign) =>
  apiRequest<{ id: string }>(base, { method: 'POST', body: payload(d) })

export const updateDesign = (id: string, d: ToolTrayDesign) =>
  apiRequest<{ ok: true }>(`${base}/${id}`, { method: 'PUT', body: payload(d) })

export const cloneDesign = (id: string, name?: string) =>
  apiRequest<{ id: string }>(`${base}/${id}/clone`, { method: 'POST', body: { name } })

export const deleteDesign = (id: string) =>
  apiRequest<{ ok: true }>(`${base}/${id}`, { method: 'DELETE' })

export type { ToolTrayDesign }
