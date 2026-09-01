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
  projectId: string | null
  /** Denormalised by the server so a picker can name the project. */
  projectName: string | null
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

const payload = (d: TrayDesign, projectId?: string | null) => ({
  name: d.name,
  // Absent leaves the tray's project link alone, which is what an ordinary
  // save from the designer means; `null` unassigns it.
  projectId: projectId === undefined ? d.projectId : projectId,
  notes: d.notes,
  profile: d.profile,
  sizing: d.sizing,
  floorThicknessMm: d.floorThicknessMm,
  pocketDepthMm: d.pocketDepthMm,
  engraveDepthMm: d.engraveDepthMm,
  pockets: d.pockets,
})

/** `projectId` selects one project; `'none'` the trays without one. */
export const listDesigns = (projectId?: string | 'none') =>
  apiRequest<DesignSummary[]>(
    projectId ? `${base}?projectId=${encodeURIComponent(projectId)}` : base)

export const hydrateDesignSizing = (design: TrayDesign): TrayDesign =>
  Object.keys(design.sizing).length === 0
    ? { ...design, sizing: { ...PYTHON_SIZING } }
    : design

export const getDesign = async (id: string): Promise<TrayDesign> =>
  hydrateDesignSizing(await apiRequest<TrayDesign>(`${base}/${id}`))

export const createDesign = (d: TrayDesign, projectId?: string | null) =>
  apiRequest<{ id: string }>(base, { method: 'POST', body: payload(d, projectId) })

export const updateDesign = (id: string, d: TrayDesign, projectId?: string | null) =>
  apiRequest<{ ok: true }>(`${base}/${id}`, { method: 'PUT', body: payload(d, projectId) })

/**
 * `projectId` retargets the copy: omit it to keep the source's project, pass a
 * project id to move the copy there, or `null` to leave it unassigned.
 */
export const cloneDesign = (id: string, name?: string, projectId?: string | null) =>
  apiRequest<{ id: string }>(`${base}/${id}/clone`, {
    method: 'POST',
    body: projectId === undefined ? { name } : { name, projectId },
  })

export const deleteDesign = (id: string) =>
  apiRequest<{ ok: true }>(`${base}/${id}`, { method: 'DELETE' })

export const listLibraryPockets = () =>
  apiRequest<LibraryPocket[]>(`${base}/library/pockets`)

export const saveLibraryPocket = (p: Omit<LibraryPocket, 'id'>) =>
  apiRequest<{ id: string }>(`${base}/library/pockets`, { method: 'POST', body: p })

export const deleteLibraryPocket = (id: string) =>
  apiRequest<{ ok: true }>(`${base}/library/pockets/${id}`, { method: 'DELETE' })

export type { Pocket, TrayDesign, TrayProfile, PocketSizing }
