// The single place the app talks HTTP.
//
// The API is same-origin: Vite proxies /api in development and the server
// serves the built SPA in production, so there is no configurable base URL and
// no CORS anywhere. The bearer token is supplied by the auth layer through
// `setAccessTokenProvider`, so feature services never touch MSAL.
import { ApiRequestError } from './errors.ts'

export type AccessTokenProvider = () => Promise<string | null>

let provider: AccessTokenProvider = async () => null

export const setAccessTokenProvider = (next: AccessTokenProvider): void => { provider = next }

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

const TIMEOUT_MS = 20_000

async function parseError(response: Response): Promise<ApiRequestError> {
  const fallback = `${response.status} ${response.statusText}`.trim()
  try {
    const payload = await response.json() as {
      error?: { code?: string; message?: string; details?: Record<string, unknown> }
    }
    const error = payload?.error
    return new ApiRequestError(
      response.status,
      error?.code ?? 'request_failed',
      error?.message ?? fallback,
      error?.details,
    )
  } catch {
    return new ApiRequestError(response.status, 'request_failed', fallback)
  }
}

/** Every request is bounded, cancellable, and carries a fresh access token. */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true })

  const headers: Record<string, string> = {}
  const token = await provider()
  if (token) headers.authorization = `Bearer ${token}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  try {
    const response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      credentials: 'same-origin',
    })

    if (!response.ok) throw await parseError(response)
    if (response.status === 204) return null as T
    const text = await response.text()
    return (text ? JSON.parse(text) : null) as T
  } catch (error) {
    if (error instanceof ApiRequestError) throw error
    if ((error as Error).name === 'AbortError') {
      throw new ApiRequestError(0, 'timeout', 'The request timed out.')
    }
    throw new ApiRequestError(0, 'network_error', 'Could not reach the ShapePilot API.')
  } finally {
    clearTimeout(timeout)
  }
}
