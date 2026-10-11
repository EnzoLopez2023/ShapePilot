// What a kilogram of each colour cost, from the orders logged.
import { useEffect, useMemo, useState } from 'react'
import { priceBookOf } from '../../../lib/contracts/filamentOrders.ts'
import type { FilamentOrder, KilogramPrice } from '../../../lib/contracts/filamentOrders.ts'
import { getOrders } from './service.ts'

/** A price lookup by colour key; prices nothing until (or unless) orders load. */
export function usePriceBook(): (key: string) => KilogramPrice | null {
  const [orders, setOrders] = useState<FilamentOrder[]>([])
  useEffect(() => {
    let cancelled = false
    void getOrders()
      .then(book => { if (!cancelled) setOrders(book.orders) })
      .catch(() => { /* no orders, no cost line */ })
    return () => { cancelled = true }
  }, [])
  return useMemo(() => priceBookOf(orders), [orders])
}
