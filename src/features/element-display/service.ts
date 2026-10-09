import type { DisplayPairing, DisplayStatus } from '../../../lib/contracts/elementDisplay.ts'
import { parseError } from '../../services/http.ts'
import { ApiRequestError } from '../../services/errors.ts'

export async function displayRequest<T>(
  path: string, credential?: string, signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  const abort = () => controller.abort()
  if (signal?.aborted) abort()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const response = await fetch(`/api/element-display/${path}`, {
      method: path === 'pairings' ? 'POST' : 'GET',
      headers: credential
        ? { authorization: `Display ${credential}` }
        : { 'content-type': 'application/json' },
      body: path === 'pairings' ? '{}' : undefined,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
    if (!response.ok) throw await parseError(response)
    return await response.json() as T
  } catch (error) {
    if (error instanceof ApiRequestError || signal?.aborted) throw error
    throw new ApiRequestError(0, 'display_network', 'ShapePilot is unreachable. Retrying automatically; readings are last known.')
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

export const startDisplayPairing = () => displayRequest<DisplayPairing>('pairings')
export const getDisplayStatus = (credential: string, signal: AbortSignal) =>
  displayRequest<DisplayStatus>('status', credential, signal)

const STORAGE_KEY = 'shapepilot:element-display:v1'

export function readDisplayPairing(): DisplayPairing | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object') throw new Error('Saved display access is invalid. Reset this display and pair again.')
  const record = value as Record<string, unknown>
  if (typeof record.credential !== 'string' || !/^[a-f0-9]{64}$/.test(record.credential)
    || typeof record.code !== 'string' || !/^[A-F0-9]{10}$/.test(record.code)
    || typeof record.expiresAt !== 'string' || !Number.isFinite(Date.parse(record.expiresAt))) {
    throw new Error('Saved display access is invalid. Reset this display and pair again.')
  }
  return { credential: record.credential, code: record.code, expiresAt: record.expiresAt }
}

export function saveDisplayPairing(pairing: DisplayPairing | null): void {
  if (pairing) localStorage.setItem(STORAGE_KEY, JSON.stringify(pairing))
  else localStorage.removeItem(STORAGE_KEY)
}
