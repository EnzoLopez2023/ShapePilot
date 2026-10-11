import { expect, test } from 'vitest'
import {
  landedCosts, ledgerOf, orderTotal, ownedOf, priceBookOf, rollsOf, totalsAgree,
} from './filamentOrders.ts'
import type { FilamentOrder, FilamentOrderLine } from './filamentOrders.ts'

const JADE = 'bambu-lab/pla/basic/jade-white-10100'
const BLACK = 'bambu-lab/pla/basic/black-10101'
const MATTE = 'bambu-lab/pla/matte/charcoal-11101'

const line = (key: string | null, variant: 'spool' | 'refill' | null, quantity: number,
  unitPrice: number | null, discount = 0, tax = 0): FilamentOrderLine => ({
  key, description: key ?? 'Not filament', sku: null, variant,
  gramsPerUnit: key ? 1000 : 0, quantity, unitPrice, discount, tax,
})

let id = 0
const order = (orderedAt: string, lines: FilamentOrderLine[], extra: Partial<FilamentOrder> = {}): FilamentOrder => ({
  id: `o${++id}`, createdAt: '', invoice: null, source: 'bambu-us-invoice', orderNumber: `n${id}`, orderedAt,
  currency: 'USD', orderDiscount: 0, credit: 0, shipping: 0, grandTotal: null, note: null, lines, ...extra,
})

// The real numbers of a real invoice: two refills and two spools of Jade White,
// a store credit of $1.28, paid $66.60.
const JADE_ORDER = order('2026-09-26', [
  line(JADE, 'refill', 2, 15.99, 3.2, 2.25),
  line(JADE, 'spool', 2, 18.99, 3.8, 2.67),
], { credit: 1.28, grandTotal: 66.6 })

test('landed cost shares the credit out by price and adds each line its own tax', () => {
  const [refills, spools] = landedCosts(JADE_ORDER)
  expect(refills! / 2).toBeCloseTo(15.22, 2)
  expect(spools! / 2).toBeCloseTo(18.08, 2)
  expect(refills! + spools!).toBeCloseTo(66.6, 2)
  expect(orderTotal(JADE_ORDER)).toBe(66.6)
  expect(totalsAgree(JADE_ORDER)).toBe(true)
  expect(totalsAgree({ ...JADE_ORDER, grandTotal: 70 })).toBe(false)
})

test('a line that is not filament still takes its share of the credit', () => {
  const mixed = order('2026-09-01', [line(BLACK, 'spool', 1, 20), line(null, null, 1, 20)], { credit: 10 })
  expect(landedCosts(mixed)).toEqual([15, 15])
  expect(rollsOf([mixed]).map(roll => roll.cost)).toEqual([15])
})

test('rolls are counted together whatever their form, and used up oldest first', () => {
  const orders = [JADE_ORDER, order('2026-09-04', [line(JADE, 'spool', 1, 20)])]
  const ledger = ledgerOf(orders, new Map([[JADE, 1200]])).get(JADE)!
  expect(ledger.rolls.map(roll => roll.orderedAt)).toEqual(
    ['2026-09-04', '2026-09-26', '2026-09-26', '2026-09-26', '2026-09-26'])
  expect(ledger.finished).toBe(1)
  expect(ledger.rollsOnHand).toBe(4)
  expect(ledger.gramsAvailable).toBe(3800)
  expect(ledger.usedGrams).toBe(1200)
  // The oldest roll (the $20 spool) is the one used up.
  expect(ledger.onHandByVariant).toEqual({ spool: 2, refill: 2 })
})

test('a roll marked used up comes off the shelf with whatever grams it had left', () => {
  const orders = [order('2026-09-04', [line(BLACK, 'spool', 2, 20)])]
  const ledger = ledgerOf(orders, new Map([[BLACK, 300]]), [{ key: BLACK, finished: 1 }]).get(BLACK)!
  expect(ledger.finished).toBe(1)
  expect(ledger.finishedByHand).toBe(1)
  expect(ledger.rollsOnHand).toBe(1)
  expect(ledger.gramsAvailable).toBe(1000)
})

test('a mark never brings back a roll usage has already used up', () => {
  const orders = [order('2026-09-04', [line(BLACK, 'spool', 2, 20)])]
  const ledger = ledgerOf(orders, new Map([[BLACK, 1500]]), [{ key: BLACK, finished: 0 }]).get(BLACK)!
  expect(ledger.finished).toBe(1)
  expect(ledger.finishedByHand).toBe(0)
})

test('printing more than was bought says an order is missing', () => {
  const ledger = ledgerOf([order('2026-09-04', [line(BLACK, 'spool', 1, 20)])], new Map([[BLACK, 1300]])).get(BLACK)!
  expect(ledger.rollsOnHand).toBe(0)
  expect(ledger.gramsAvailable).toBe(0)
  expect(ledger.gramsUnaccounted).toBe(300)
  // Usage alone, with nothing bought, still has a ledger to say so.
  expect(ledgerOf([], new Map([[MATTE, 50]])).get(MATTE)!.gramsUnaccounted).toBe(50)
})

test('price per kilogram averages what each roll cost; an unpriced roll is left out', () => {
  const orders = [
    order('2026-09-04', [line(BLACK, 'spool', 1, 20), line(BLACK, 'refill', 1, 10)]),
    order('2026-09-05', [line(BLACK, 'spool', 1, null)], { source: 'manual', orderNumber: null }),
  ]
  const ledger = ledgerOf(orders, new Map()).get(BLACK)!
  expect(ledger.costPerKg).toBe(15)
  expect(ledger.rollsOnHand).toBe(3)
  const priceOf = priceBookOf(orders)
  expect(priceOf(BLACK)).toEqual({ pricePerKg: 15, currency: 'USD' })
  // A colour never bought is priced at its line's average…
  expect(priceOf(JADE)).toEqual({ pricePerKg: 15, currency: 'USD' })
  // …and a line never bought, not at all.
  expect(priceOf(MATTE)).toBeNull()
})

test('the owned list is rolls on hand per colour and form', () => {
  const orders = [order('2026-09-04', [line(JADE, 'spool', 2, 20), line(JADE, 'refill', 1, 15), line(BLACK, 'spool', 1, 20)])]
  expect(ownedOf(ledgerOf(orders, new Map([[BLACK, 1000]])))).toEqual([
    { key: JADE, variant: 'refill', quantity: 1 },
    { key: JADE, variant: 'spool', quantity: 2 },
  ])
})
