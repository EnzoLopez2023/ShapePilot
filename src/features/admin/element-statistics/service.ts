import type {
  ElementAccount, ElementJobDetail, ElementQuery, ElementReport, ElementStatus,
} from '../../../../lib/contracts/elementStatistics.ts'
import { apiBlobRequest, apiRequest } from '../../../services/http.ts'

const base = '/admin/element-statistics'

export function elementQueryString(query: ElementQuery): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query.filters)) {
    if (value !== null && value !== '') params.set(key, String(value))
  }
  params.set('page', String(query.page))
  params.set('pageSize', String(query.pageSize))
  return params.toString()
}

export const getElementStatus = (signal?: AbortSignal): Promise<ElementStatus> =>
  apiRequest(`${base}/status`, { signal })

export const discoverElementConnection = (): Promise<ElementAccount> =>
  apiRequest(`${base}/discover`, { method: 'POST', body: {}, timeoutMs: 45_000 })

export const configureElementConnection = (
  selection: { enabled: boolean; accountId?: string; printerId?: string },
): Promise<ElementStatus> =>
  apiRequest(`${base}/connection`, { method: 'PUT', body: selection, timeoutMs: 60_000 })

export const syncElementHistory = (rescan: boolean): Promise<{ started: boolean }> =>
  apiRequest(`${base}/sync`, { method: 'POST', body: { rescan } })

export const getElementReport = (query: ElementQuery, signal?: AbortSignal): Promise<ElementReport> =>
  apiRequest(`${base}/report?${elementQueryString(query)}`, { signal })

export const getElementJob = (
  connectionId: string, jobId: string, signal?: AbortSignal,
): Promise<ElementJobDetail> =>
  apiRequest(`${base}/jobs/${encodeURIComponent(connectionId)}/${encodeURIComponent(jobId)}`, { signal })

export const exportElementCsv = (
  query: ElementQuery, kind: 'jobs' | 'materials' | 'summary',
): Promise<Blob> =>
  apiBlobRequest(`${base}/export/${kind}.csv?${elementQueryString(query)}`, { timeoutMs: 60_000 })

export const exportElementPrintable = (query: ElementQuery): Promise<Blob> =>
  apiBlobRequest(`${base}/report.html?${elementQueryString(query)}`, { timeoutMs: 60_000 })
