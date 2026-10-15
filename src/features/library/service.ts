// Library API client. Thin wrappers over `apiRequest`, like every other
// feature service. Thumbnails need the bearer token too, so they are fetched
// as blobs and cached by hash (see components/LibraryThumb.tsx).
import { apiBlobRequest, apiRequest } from '../../services/http.ts'
import type {
  LibraryCollection, LibraryDevice, LibraryDuplicateGroup, LibraryMatchCounts, LibraryModel,
  LibraryModelDetail, LibraryModelPage, LibraryModelQuery, LibraryOverview, LibraryPlan, LibraryPrint,
  LibraryQuery, LibraryStatus,
} from '../../../lib/contracts/library.ts'

const base = '/library'

function queryString(query: LibraryModelQuery): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '' || value === false) continue
    params.set(key, value === true ? '1' : String(value))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

export const getOverview = () => apiRequest<LibraryOverview>(`${base}/overview`)

export const listModels = (query: LibraryModelQuery = {}) =>
  apiRequest<LibraryModelPage>(`${base}/models${queryString(query)}`)

export const listModelIds = (query: LibraryModelQuery = {}) =>
  apiRequest<{ ids: string[] }>(`${base}/model-ids${queryString(query)}`)

export const getModel = (id: string) =>
  apiRequest<LibraryModelDetail>(`${base}/models/${encodeURIComponent(id)}`)

export interface ModelUpdate {
  title?: string
  status?: LibraryStatus
  tags?: string[]
  notes?: string
  favorite?: boolean
  bambuHubUrl?: string | null
}

export const updateModel = (id: string, update: ModelUpdate) =>
  apiRequest<LibraryModel>(`${base}/models/${encodeURIComponent(id)}`, { method: 'PUT', body: update })

export const logPrint = (id: string, print: { result: 'completed' | 'failed'; notes?: string }) =>
  apiRequest<LibraryPrint>(`${base}/models/${encodeURIComponent(id)}/prints`, { method: 'POST', body: print })

export const deletePrint = (id: number) =>
  apiRequest<void>(`${base}/prints/${id}`, { method: 'DELETE' })

export const listMatches = () => apiRequest<LibraryPrint[]>(`${base}/matches`)

export const confirmMatch = (printId: number, modelId?: string) =>
  apiRequest<LibraryPrint>(`${base}/matches/${printId}/confirm`, { method: 'POST', body: { modelId } })

export const rejectMatch = (printId: number) =>
  apiRequest<LibraryPrint>(`${base}/matches/${printId}/reject`, { method: 'POST', body: {} })

export const syncPrintHistory = () =>
  apiRequest<LibraryMatchCounts & { imported: number }>(`${base}/print-history/sync`, { method: 'POST', body: {} })

export const listCollections = () => apiRequest<LibraryCollection[]>(`${base}/collections`)

export const createCollection = (collection: {
  name: string
  kind: LibraryCollection['kind']
  query?: LibraryQuery
  modelIds?: string[]
}) => apiRequest<LibraryCollection>(`${base}/collections`, { method: 'POST', body: collection })

export const renameCollection = (id: number, name: string) =>
  apiRequest<LibraryCollection>(`${base}/collections/${id}`, { method: 'PUT', body: { name } })

export const deleteCollection = (id: number) =>
  apiRequest<void>(`${base}/collections/${id}`, { method: 'DELETE' })

export const setMembership = (id: number, modelId: string, member: boolean) =>
  apiRequest<void>(`${base}/collections/${id}/models/${encodeURIComponent(modelId)}`, { method: member ? 'PUT' : 'DELETE' })

export const listDuplicates = () => apiRequest<LibraryDuplicateGroup[]>(`${base}/duplicates`)

export const getPlan = () => apiRequest<LibraryPlan | null>(`${base}/plan`)

export const listDevices = () => apiRequest<LibraryDevice[]>(`${base}/devices`)

export const createDevice = (name: string) =>
  apiRequest<LibraryDevice & { token: string }>(`${base}/devices`, { method: 'POST', body: { name } })

export const revokeDevice = (id: string) =>
  apiRequest<void>(`${base}/devices/${id}`, { method: 'DELETE' })

export const getThumb = (hash: string) => apiBlobRequest(`${base}/thumbs/${hash}`)
