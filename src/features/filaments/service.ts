// Filament inventory API client.
//
// Thin wrappers over `apiRequest`, like every other feature service -- with one
// addition the others do not need.
//
// The page has no Save button: a tick is the commit, and the whole inventory
// goes up on every tick. Two of those in flight at once can land out of order
// and leave the older body as the stored truth, which per-row writes would have
// been immune to. So writes go through a single-flight queue that coalesces:
// one request in flight, one pending body, and the pending body is always the
// most recent. Ticking thirty boxes quickly is at most two requests, and the
// last one always describes what the page is showing.
import { apiRequest } from '../../services/http.ts'
import type { FilamentTick } from './model/types.ts'

const base = '/filaments'

interface InventoryResponse {
  owned: FilamentTick[]
}

export const getFilaments = () =>
  apiRequest<InventoryResponse>(base).then(response => response.owned)

const putFilaments = (owned: readonly FilamentTick[]) =>
  apiRequest<InventoryResponse>(base, {
    method: 'PUT',
    body: { owned: owned.map(tick => ({ key: tick.key, variant: tick.variant })) },
  }).then(response => response.owned)

export interface InventoryWriter {
  /** Queue the whole inventory. Resolves when this body, or a newer one, is stored. */
  save(owned: readonly FilamentTick[]): Promise<void>
}

/**
 * One writer per mounted page. Kept out of module scope so a second page (or a
 * test) never inherits another's in-flight state.
 */
export function createInventoryWriter(
  onError: (error: unknown) => void,
): InventoryWriter {
  let inFlight: Promise<void> | null = null
  let pending: readonly FilamentTick[] | null = null

  const drain = async (): Promise<void> => {
    while (pending !== null) {
      const body = pending
      pending = null
      try {
        await putFilaments(body)
      } catch (error) {
        // Report and stop: the page reconciles by reloading rather than
        // retrying a body the server may have already rejected on its merits.
        pending = null
        onError(error)
        return
      }
    }
  }

  return {
    save(owned) {
      pending = owned
      if (!inFlight) {
        inFlight = drain().finally(() => { inFlight = null })
      }
      return inFlight
    },
  }
}
