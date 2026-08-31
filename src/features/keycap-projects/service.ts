// Keycap project API client.
//
// Thin wrappers over `apiRequest`, like every other feature service: no MSAL
// here, no base URL, no retries.
import { apiRequest } from '../../services/http.ts'
import type { KeycapProject, ProjectInput, ProjectSummary, SetItem } from './model/types.ts'

const base = '/keycap-projects'

/** Only server-owned fields. A row's client-side `id` never goes back up. */
const payload = (p: ProjectInput) => ({
  name: p.name,
  notes: p.notes,
  setName: p.setName,
  manufacturer: p.manufacturer,
  capProfile: p.capProfile,
  colorway: p.colorway,
  items: p.items?.map(itemPayload),
})

const itemPayload = (i: SetItem) => ({
  legend: i.legend,
  units: i.units,
  heightUnits: i.heightUnits,
  shape: i.shape,
  count: i.count,
  group: i.group,
  color: i.color,
  source: i.source,
})

export const listProjects = () => apiRequest<ProjectSummary[]>(base)

export const getProject = (id: string) => apiRequest<KeycapProject>(`${base}/${id}`)

export const createProject = (p: ProjectInput) =>
  apiRequest<{ id: string }>(base, { method: 'POST', body: payload(p) })

export const updateProject = (id: string, p: ProjectInput) =>
  apiRequest<{ ok: true }>(`${base}/${id}`, { method: 'PUT', body: payload(p) })

export const deleteProject = (id: string) =>
  apiRequest<{ ok: true }>(`${base}/${id}`, { method: 'DELETE' })

export const addProjectPhoto = (id: string, hash: string, caption?: string) =>
  apiRequest<{ ok: true }>(`${base}/${id}/photos`, { method: 'POST', body: { hash, caption } })

export const removeProjectPhoto = (id: string, hash: string) =>
  apiRequest<{ ok: true }>(`${base}/${id}/photos/${hash}`, { method: 'DELETE' })

export type { KeycapProject, ProjectInput, ProjectSummary, SetItem }
