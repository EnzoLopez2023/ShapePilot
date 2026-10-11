// @vitest-environment jsdom
//
// The Orders page through the real components, with the API stubbed at the
// fetch boundary and pdf.js stubbed at the one module that calls it -- the
// positioned text it would return is a real invoice's, redacted. What is
// pinned is the rule the page exists under: an invoice is read and proposed,
// a person checks it, and only then is anything saved; the same invoice twice
// is never saved twice; and what is sent is the order, not the reader's notes.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import OrdersPage from '../../src/features/filaments/OrdersPage.tsx'
import { ThemeModeProvider } from '../../src/theme/ThemeModeProvider.tsx'
import { ConfirmDialogProvider } from '../../src/components/ConfirmDialogProvider.tsx'
import type { FilamentOrder, FilamentOrderInput } from '../../lib/contracts/filamentOrders.ts'
import invoiceItems from '../fixtures/bambuInvoice.items.json' with { type: 'json' }

vi.mock('../../src/features/filaments/model/pdfText.ts', () => ({
  pdfTextItems: vi.fn(async (file: File) => {
    if (file.name.startsWith('broken')) throw new Error('not a pdf')
    return invoiceItems
  }),
}))

let orders: FilamentOrder[] = []
let posted: FilamentOrderInput[] = []
let deleted: string[] = []
let kept: { id: string; filename: string }[] = []

const stubFetch = () => vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
  const path = String(url)
  const method = init?.method ?? 'GET'
  if (path.endsWith('/api/filaments/orders') && method === 'GET') {
    return Response.json({ orders, adjustments: [] })
  }
  if (path.endsWith('/api/filaments/orders') && method === 'POST') {
    const body = JSON.parse(String(init?.body)) as FilamentOrderInput
    posted.push(body)
    const order: FilamentOrder = { ...body, id: `o${orders.length + 1}`, createdAt: '', invoice: null }
    orders = [...orders, order]
    return Response.json({ order }, { status: 201 })
  }
  const invoice = /\/api\/filaments\/orders\/([^/]+)\/invoice\?filename=(.+)$/.exec(path)
  if (invoice && method === 'PUT') {
    kept.push({ id: invoice[1], filename: decodeURIComponent(invoice[2]) })
    orders = orders.map(order => (order.id === invoice[1]
      ? { ...order, invoice: { filename: decodeURIComponent(invoice[2]), contentType: 'application/pdf', byteLength: 4 } }
      : order))
    return Response.json({ invoice: {} })
  }
  const remove = /\/api\/filaments\/orders\/([^/]+)$/.exec(path)
  if (remove && method === 'DELETE') {
    deleted.push(remove[1])
    orders = orders.filter(order => order.id !== remove[1])
    return new Response(null, { status: 204 })
  }
  throw new Error(`unexpected ${method} ${path}`)
}))

const draw = (path = '/filaments/orders') => render(
  <MemoryRouter initialEntries={[path]}>
    <ThemeModeProvider>
      <ConfirmDialogProvider>
        <OrdersPage />
      </ConfirmDialogProvider>
    </ThemeModeProvider>
  </MemoryRouter>,
)

const pdf = (name: string) => new File(['%PDF'], name, { type: 'application/pdf' })

beforeEach(() => {
  orders = []
  posted = []
  deleted = []
  kept = []
  stubFetch()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('an invoice is proposed for checking, and only saved when asked', async () => {
  const user = userEvent.setup()
  draw()
  await screen.findByText('No orders yet')

  await user.upload(screen.getByLabelText('Bambu Lab invoices'), pdf('invoice.pdf'))
  const review = await screen.findByRole('dialog', { name: 'Check before saving' })
  const proposal = within(review).getByRole('region', { name: 'Order us000000000000000001' })
  expect(within(proposal).getByText('$137.90 · adds up')).toBeTruthy()
  // Charcoal was bought both ways on this invoice.
  expect(within(proposal).getAllByText('PLA Matte · Charcoal 11101', { exact: false })).toHaveLength(2)
  assert.equal(posted.length, 0, 'nothing is saved before the person says so')

  await user.click(within(review).getByRole('button', { name: 'Save 1 order · 10 rolls' }))
  await waitFor(() => assert.equal(posted.length, 1))
  const sent = posted[0]
  assert.equal(sent.orderNumber, 'us000000000000000001')
  assert.equal(sent.orderDiscount, 10)
  assert.equal(sent.lines.length, 10)
  // The reader's own bookkeeping stays behind.
  assert.ok(sent.lines.every(line => !('unmatched' in line)))
  await screen.findByText('1 order saved.')
  // The PDF itself is kept with the order it became, for reference.
  assert.deepEqual(kept, [{ id: 'o1', filename: 'invoice.pdf' }])
  const card = await screen.findByRole('region', { name: /Order us000000000000000001$/ })
  await within(card).findByRole('button', { name: 'Invoice' })
})

test('an invoice already logged is shown but left out of the save', async () => {
  const user = userEvent.setup()
  draw()
  await screen.findByText('No orders yet')
  await user.upload(screen.getByLabelText('Bambu Lab invoices'), pdf('a.pdf'))
  await user.click(await screen.findByRole('button', { name: 'Save 1 order · 10 rolls' }))
  await waitFor(() => assert.equal(posted.length, 1))

  await user.upload(screen.getByLabelText('Bambu Lab invoices'), [pdf('again.pdf'), pdf('broken.pdf')])
  const review = await screen.findByRole('dialog', { name: 'Check before saving' })
  expect(within(review).getByText('Already logged, so it is left out.')).toBeTruthy()
  expect(within(review).getByText('This PDF could not be read.')).toBeTruthy()
  assert.equal(
    (within(review).getByRole('button', { name: 'Nothing to save' }) as HTMLButtonElement).disabled, true)
})

test('rolls without an invoice are added by hand, from a colour sheet link', async () => {
  const user = userEvent.setup()
  draw('/filaments/orders?add=bambu-lab%2Fpla%2Fmatte%2Fmandarin-orange-11300')
  const dialog = await screen.findByRole('dialog', { name: 'Add rolls without an invoice' })
  expect((within(dialog).getByRole('combobox', { name: 'Colour' }) as HTMLInputElement).value)
    .toBe('Mandarin Orange 11300')
  await user.type(within(dialog).getByPlaceholderText('Where it came from'), 'Best Buy')
  await user.click(within(dialog).getByRole('button', { name: 'Add' }))

  await waitFor(() => assert.equal(posted.length, 1))
  assert.equal(posted[0].source, 'manual')
  assert.equal(posted[0].orderNumber, null)
  assert.equal(posted[0].note, 'Best Buy')
  assert.deepEqual(posted[0].lines.map(line => [line.key, line.variant, line.quantity, line.unitPrice]), [
    ['bambu-lab/pla/matte/mandarin-orange-11300', 'spool', 1, null],
  ])
  await screen.findByRole('region', { name: /Best Buy$/ })
})

test('an order is deleted only after confirming', async () => {
  const user = userEvent.setup()
  orders = [{
    id: 'o1', createdAt: '', invoice: null, source: 'manual', orderNumber: null, orderedAt: '2026-09-04', currency: 'USD',
    orderDiscount: 0, credit: 0, shipping: 0, grandTotal: null, note: 'Best Buy',
    lines: [{
      key: 'bambu-lab/pla/basic/black-10101', description: 'Black', sku: null, variant: 'spool',
      gramsPerUnit: 1000, quantity: 1, unitPrice: null, discount: 0, tax: 0,
    }],
  }]
  draw()
  await user.click(await screen.findByRole('button', { name: 'Delete Best Buy' }))
  const confirm = await screen.findByRole('dialog', { name: 'Delete this order?' })
  await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
  await waitFor(() => assert.deepEqual(deleted, ['o1']))
  await screen.findByText('No orders yet')
})

test('an order shows everything on it and how the invoice reached what was paid', async () => {
  const user = userEvent.setup()
  orders = [{
    id: 'o1', createdAt: '', invoice: null, source: 'bambu-us-invoice', orderNumber: 'us-1',
    orderedAt: '2026-09-26', currency: 'USD', orderDiscount: 0, credit: 1.28, shipping: 0, grandTotal: 66.6, note: null,
    lines: [
      {
        key: 'bambu-lab/pla/basic/jade-white-10100', description: 'PLA Basic', sku: 'A00-W1-1.75-1000-SPLFREE',
        variant: 'refill', gramsPerUnit: 1000, quantity: 2, unitPrice: 15.99, discount: 3.2, tax: 2.25,
      },
      {
        key: null, description: 'Glue Stick — All Series / 4 pcs', sku: 'SGL001-4',
        variant: null, gramsPerUnit: 0, quantity: 1, unitPrice: 34.18, discount: 0, tax: 2.67,
      },
    ],
  }]
  draw()
  const card = await screen.findByRole('region', { name: /Order us-1$/ })
  expect(within(card).getByRole('heading', { name: /\$66\.60/ })).toBeTruthy()
  await user.click(within(card).getByRole('button', { name: 'Every item and total' }))
  expect(within(card).getByText('Glue Stick')).toBeTruthy()
  expect(within(card).getByText('Store credit')).toBeTruthy()
  expect(within(card).getByText('−$1.28')).toBeTruthy()
  expect(within(card).getByText('$4.92')).toBeTruthy()
  // An order with no kept file offers to attach one -- a photo of a paper receipt will do.
  const input = within(card).getByLabelText('Invoice or receipt for Order us-1')
  await user.upload(input, new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' }))
  await waitFor(() => assert.deepEqual(kept, [{ id: 'o1', filename: 'scan.pdf' }]))
})
