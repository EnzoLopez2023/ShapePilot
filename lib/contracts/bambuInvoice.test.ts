// The invoice reader, against the positioned text of a real Bambu Lab US
// invoice (name, phone, email and address removed; order and invoice numbers
// replaced). It has the shapes that make this worth testing: a description
// that wraps, a SKU split across two lines, a table that runs over a page
// break with its header repeated, and an order-level discount.
import { expect, test } from 'vitest'
import items from '../../test/fixtures/bambuInvoice.items.json' with { type: 'json' }
import { InvoiceParseError, parseBambuInvoice } from './bambuInvoice.ts'
import type { PdfTextItem } from './bambuInvoice.ts'
import { landedCosts, orderTotal, totalsAgree } from './filamentOrders.ts'

const fixture = items as PdfTextItem[]

test('reads the order, every line across the page break, and the totals', () => {
  const { order, warnings } = parseBambuInvoice(fixture)
  expect(warnings).toEqual([])
  expect(order.orderNumber).toBe('us000000000000000001')
  expect(order.orderedAt).toBe('2026-09-08')
  expect(order.currency).toBe('USD')
  expect(order.orderDiscount).toBe(10)
  expect(order.grandTotal).toBe(137.9)
  expect(order.lines.map(line => [line.key, line.variant, line.quantity])).toEqual([
    ['bambu-lab/pla/basic/dark-gray-10105', 'refill', 1],
    ['bambu-lab/pla/basic/bambu-green-10501', 'refill', 1],
    ['bambu-lab/pla/basic/pumpkin-orange-10301', 'refill', 1],
    ['bambu-lab/pla/matte/mandarin-orange-11300', 'spool', 1],
    ['bambu-lab/pla/matte/marine-blue-11600', 'spool', 1],
    ['bambu-lab/pla/matte/scarlet-red-11200', 'refill', 1],
    ['bambu-lab/pla/matte/terracotta-11203', 'refill', 1],
    ['bambu-lab/pla/matte/charcoal-11101', 'spool', 1],
    ['bambu-lab/pla/matte/charcoal-11101', 'refill', 1],
    ['bambu-lab/pla/matte/ash-gray-11102', 'spool', 1],
  ])
})

test('a SKU split over two lines is joined, and each line keeps its own money', () => {
  const { order } = parseBambuInvoice(fixture)
  const [refill, , , spool] = order.lines
  expect(refill).toMatchObject({ sku: 'A00-D3-1.75-1000-SPLFREE', unitPrice: 19.99, discount: 7, gramsPerUnit: 1000 })
  expect(spool).toMatchObject({ sku: 'A01-A2-1.75-1000-SPL', unitPrice: 22.99, discount: 8.05 })
})

test('the lines add up to the grand total, so each roll is priced at what was paid', () => {
  const { order } = parseBambuInvoice(fixture)
  expect(totalsAgree(order)).toBe(true)
  expect(orderTotal(order)).toBe(137.9)
  const costs = landedCosts(order)
  expect(costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0)).toBeCloseTo(137.9, 2)
})

test('a colour the catalogue does not have is proposed unmatched, not guessed', () => {
  const renamed = fixture.map(item => (item.str.includes('(11203)')
    ? { ...item, str: item.str.replace('(11203)', '(19999)') } : item))
  const { order, warnings } = parseBambuInvoice(renamed)
  const line = order.lines.find(entry => entry.description.includes('19999'))!
  expect(line.key).toBeNull()
  expect(line.unmatched).toBe(true)
  expect(warnings.some(warning => warning.includes('matches no catalogue colour'))).toBe(true)
})

test('an adjustment it does not know is said out loud', () => {
  const label = fixture.find(item => item.str === 'Order Discount')!
  const coupon = fixture.map(item => (item === label ? { ...item, str: 'Coupon' } : item))
  const { warnings } = parseBambuInvoice(coupon)
  expect(warnings.some(warning => warning.includes('Coupon'))).toBe(true)
  // And the arithmetic check catches the missing $10.
  expect(warnings.some(warning => warning.includes('do not add up'))).toBe(true)
})

test('refuses something that is not a Bambu Lab US invoice', () => {
  expect(() => parseBambuInvoice([{ str: 'Amazon.com order', x: 0, y: 0, width: 50, page: 1 }]))
    .toThrow(InvoiceParseError)
})
