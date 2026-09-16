// X2D maintenance API client. Thin wrappers over `apiRequest`, like every
// other feature service: no MSAL here, no base URL, no retries.
//
// Unlike the filament inventory there is no coalescing writer, because there is
// nothing here to coalesce. Logging a service is a deliberate act on one task,
// and the profile is saved from a form with a button on it -- neither can fire
// thirty times in two seconds the way a wall of checkboxes can.
import { apiRequest } from '../../services/http.ts'
import type { MaintenanceEvent, MaintenanceProfile } from './model/schedule.ts'

const base = '/maintenance'

export interface MaintenanceRecord {
  /** Null until the account has said when the printer entered service. */
  profile: MaintenanceProfile | null
  /** The whole log, newest first. */
  events: MaintenanceEvent[]
}

export const getMaintenance = () => apiRequest<MaintenanceRecord>(base)

export const saveProfile = (profile: MaintenanceProfile) =>
  apiRequest<MaintenanceProfile>(`${base}/profile`, { method: 'PUT', body: profile })

export interface LogServiceInput {
  taskKey: string
  performedOn: string
  note?: string | null
}

export const logService = (input: LogServiceInput) =>
  apiRequest<MaintenanceEvent>(`${base}/events`, { method: 'POST', body: input })

export const deleteService = (id: number) =>
  apiRequest<{ ok: true }>(`${base}/events/${id}`, { method: 'DELETE' })
