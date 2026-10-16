// Gridfinity designer — API client. Only parameters and label lists cross the
// wire; every mesh is generated in the browser.
import { apiRequest } from '../../services/http.ts'
import type { GridfinityDesign, GridfinityRecord, LabelList } from './model/types.ts'

const base = '/gridfinity'

const payload = (d: GridfinityDesign) => ({
  name: d.name.trim() || 'Untitled',
  notes: d.notes ?? null,
  kind: d.kind,
  params: d.kind === 'bin' ? d.bin : d.baseplate,
})

export const listDesigns = () => apiRequest<GridfinityRecord[]>(`${base}/designs`)
export const getDesign = (id: string) => apiRequest<GridfinityRecord>(`${base}/designs/${id}`)
export const createDesign = (d: GridfinityDesign) =>
  apiRequest<{ id: string }>(`${base}/designs`, { method: 'POST', body: payload(d) })
export const updateDesign = (id: string, d: GridfinityDesign) =>
  apiRequest<{ ok: true }>(`${base}/designs/${id}`, { method: 'PUT', body: payload(d) })
export const cloneDesign = (id: string) =>
  apiRequest<{ id: string }>(`${base}/designs/${id}/clone`, { method: 'POST', body: {} })
export const deleteDesign = (id: string) =>
  apiRequest<{ ok: true }>(`${base}/designs/${id}`, { method: 'DELETE' })

export const listLabelLists = () => apiRequest<LabelList[]>(`${base}/label-lists`)
export const createLabelList = (name: string, items: string[]) =>
  apiRequest<{ id: string }>(`${base}/label-lists`, { method: 'POST', body: { name, items } })
export const updateLabelList = (id: string, name: string, items: string[]) =>
  apiRequest<{ ok: true }>(`${base}/label-lists/${id}`, { method: 'PUT', body: { name, items } })
export const deleteLabelList = (id: string) =>
  apiRequest<{ ok: true }>(`${base}/label-lists/${id}`, { method: 'DELETE' })
