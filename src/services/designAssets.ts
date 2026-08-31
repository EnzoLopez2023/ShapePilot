// The design-asset API client.
//
// Bytes, not JSON, so these do not go through `apiRequest` -- they carry a raw
// body and need their own, much larger budget. Everything else about them
// matches: same-origin `/api`, same bearer token, same typed error envelope.
import { accessToken, parseError } from './http.ts'
import type { ImportFormat } from '../model/document.ts'

/**
 * Reference photographs -- a picture of a keycap set -- rather than geometry.
 * Kept apart from `ImportFormat` on purpose: `importFile` must keep refusing
 * images, so only the photo uploader ever names one of these.
 */
export type ImageFormat = 'png' | 'jpeg' | 'webp'

/** Everything the asset store accepts. */
export type AssetFormat = ImportFormat | ImageFormat

const base = '/api/design-assets'

/** Generous: a 60 MB STL over a slow link is a real case, and failing it
 *  halfway is worse than waiting. */
const TRANSFER_TIMEOUT_MS = 180_000

export interface AssetRecord {
  hash: string
  filename: string
  format: AssetFormat
  byteLength: number
  createdAt: string
}

const authHeaders = async (): Promise<Record<string, string>> => {
  const token = await accessToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TRANSFER_TIMEOUT_MS)
  try {
    return await run(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

export const listAssets = (): Promise<AssetRecord[]> =>
  withTimeout(async signal => {
    const response = await fetch(base, {
      headers: await authHeaders(), credentials: 'same-origin', signal,
    })
    if (!response.ok) throw await parseError(response)
    return await response.json() as AssetRecord[]
  })

/** `null` when the server does not have it, which is an ordinary outcome:
 *  assets are not authoritative and may simply never have been uploaded. */
export const fetchAsset = (hash: string): Promise<ArrayBuffer | null> =>
  withTimeout(async signal => {
    const response = await fetch(`${base}/${hash}`, {
      headers: await authHeaders(), credentials: 'same-origin', signal,
    })
    if (response.status === 404) return null
    if (!response.ok) throw await parseError(response)
    return await response.arrayBuffer()
  })

export const uploadAsset = (
  hash: string, bytes: ArrayBuffer, filename: string, format: AssetFormat,
): Promise<AssetRecord> =>
  withTimeout(async signal => {
    const query = new URLSearchParams({ filename, format })
    const response = await fetch(`${base}/${hash}?${query}`, {
      method: 'PUT',
      headers: { ...(await authHeaders()), 'content-type': 'application/octet-stream' },
      body: bytes,
      credentials: 'same-origin',
      signal,
    })
    if (!response.ok) throw await parseError(response)
    return await response.json() as AssetRecord
  })
