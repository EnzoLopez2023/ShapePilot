// Filament API client: orders, the shelf they add up to, and print usage.
//
// Orders are the inventory. What an account owns is derived from them on the
// server (and the same way on the page), so nothing here writes an owned list;
// it logs orders, deletes them, and marks rolls used up.
import { accessToken, apiBlobRequest, apiRequest, parseError } from '../../services/http.ts'
import type { FilamentTick } from './model/types.ts'
import { ApiRequestError } from '../../services/errors.ts'
import type {
  FilamentUsageMapping, FilamentUsageReport,
} from '../../../lib/contracts/filamentUsage.ts'
import type {
  FilamentOrder, FilamentOrderInput, FilamentRollAdjustment,
} from '../../../lib/contracts/filamentOrders.ts'

const base = '/filaments'

/** What the account owns, derived from its orders: one entry per colour and form on hand. */
export const getFilaments = () =>
  apiRequest<{ owned: FilamentTick[] }>(base).then(response => response.owned)

export interface OrderBook {
  orders: FilamentOrder[]
  adjustments: FilamentRollAdjustment[]
}

export const getOrders = () =>
  apiRequest<OrderBook>(`${base}/orders`).then(response => ({
    orders: response?.orders ?? [],
    adjustments: response?.adjustments ?? [],
  }))

/** Log one order. Rejects with a 409 when its order number is already logged. */
export const createOrder = (order: FilamentOrderInput) =>
  apiRequest<{ order: FilamentOrder }>(`${base}/orders`, { method: 'POST', body: order })
    .then(response => response.order)

export const deleteOrder = (id: string) =>
  apiRequest<void>(`${base}/orders/${encodeURIComponent(id)}`, { method: 'DELETE' })

/** Mark how many rolls of a colour are used up; 0 clears the mark. */
export const setRollsFinished = (key: string, finished: number) =>
  apiRequest<{ adjustments: FilamentRollAdjustment[] }>(`${base}/adjustments`, {
    method: 'PUT', body: { key, finished },
  }).then(response => response.adjustments)

/**
 * Per-colour usage from the recorded print history, or null when this account
 * may not see it. Usage is administrator data; a 403 is the expected answer for
 * everyone else and means "show the page without it", not "something broke".
 */
export const getFilamentUsage = (): Promise<FilamentUsageReport | null> =>
  apiRequest<FilamentUsageReport>(`${base}/usage`).catch(error => {
    if (error instanceof ApiRequestError && error.status === 403) return null
    throw error
  })

/** Replace every hand-made link. Resolves with what was stored. */
export const putUsageMappings = (mappings: readonly FilamentUsageMapping[]) =>
  apiRequest<{ mappings: FilamentUsageMapping[] }>(`${base}/usage/mappings`, {
    method: 'PUT', body: { mappings },
  }).then(response => response.mappings)

/** Keep the original invoice (PDF, PNG or JPEG) with an order, for reference. */
export async function uploadInvoice(orderId: string, file: Blob, filename: string): Promise<void> {
  const token = await accessToken()
  const response = await fetch(
    `/api${base}/orders/${encodeURIComponent(orderId)}/invoice?${new URLSearchParams({ filename })}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: file,
      credentials: 'same-origin',
    })
  if (!response.ok) throw await parseError(response)
}

/** The invoice kept with an order, as a file to open. */
export const fetchInvoice = (orderId: string): Promise<Blob> =>
  apiBlobRequest(`${base}/orders/${encodeURIComponent(orderId)}/invoice`)
