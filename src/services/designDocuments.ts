// The design-document API client. Thin wrappers over apiRequest, like every
// other feature service: no MSAL here, no base URL, no retries.
import { apiRequest } from './http.ts'
import { ApiRequestError } from './errors.ts'
import type { DesignPrintHistory } from '../../lib/contracts/designPrints.ts'
import type { DesignDocument, DocumentKind, SceneObject } from '../model/document.ts'

const base = '/design-documents'

export interface DocumentSummary {
  id: string
  kind: DocumentKind
  name: string
  notes?: string | null
  objectCount: number
  createdAt: string
  updatedAt: string
}

/**
 * Only the parts the server owns are sent. `id` is the row identity and
 * `revision` is client-side history state, so neither round-trips.
 */
const payload = (d: DesignDocument) => ({
  kind: d.kind,
  name: d.name,
  ...(d.notes ? { notes: d.notes } : {}),
  objects: d.objects,
  ...(d.machine ? { machine: d.machine } : {}),
  ...(d.chat ? { chat: d.chat } : {}),
})

export const listDocuments = (kind?: DocumentKind) =>
  apiRequest<DocumentSummary[]>(kind ? `${base}?kind=${kind}` : base)

export const getDocument = (id: string) => apiRequest<DesignDocument>(`${base}/${id}`)

export const createDocument = (d: DesignDocument) =>
  apiRequest<{ id: string }>(base, { method: 'POST', body: payload(d) })

export const updateDocument = (id: string, d: DesignDocument) =>
  apiRequest<{ ok: true }>(`${base}/${id}`, { method: 'PUT', body: payload(d) })

/** `kind` retargets the copy: this is the "continue in another designer" handoff. */
export const cloneDocument = (id: string, name?: string, kind?: DocumentKind) =>
  apiRequest<{ id: string }>(`${base}/${id}/clone`, { method: 'POST', body: { name, kind } })

/**
 * What this design has printed, per the household printer's history. `null`
 * when this account may not see that history, which is an ordinary state: the
 * designer simply shows nothing.
 */
export const getDocumentPrints = (id: string) =>
  apiRequest<DesignPrintHistory>(`${base}/${id}/prints`).catch(error => {
    if (error instanceof ApiRequestError && error.status === 403) return null
    throw error
  })

export const deleteDocument = (id: string) =>
  apiRequest<{ ok: true }>(`${base}/${id}`, { method: 'DELETE' })

export type { DesignDocument, DesignPrintHistory, DocumentKind, SceneObject }
