// @vitest-environment jsdom
//
// The filaments page through the real components, with the API stubbed at the
// fetch boundary. Orders are the inventory: what is pinned is that the shelf a
// person sees is exactly what their orders and their printing add up to --
// rolls on hand beside each reel, grams left, grams used, the order the shelf
// is listed in -- and that the one thing they can say on this page, that a
// roll ran out early, reaches the server and can be taken back.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import FilamentsPage from '../../src/features/filaments/FilamentsPage.tsx'
import { computeFilamentUsage } from '../../lib/contracts/filamentUsage.ts'
import type { FilamentUsageMapping } from '../../lib/contracts/filamentUsage.ts'
import type { ElementJob } from '../../lib/contracts/elementStatistics.ts'
import { syntheticElementSnapshot, syntheticRecordedElementJob } from '../fixtures/elementStatistics.ts'
import { amsStockOf } from '../../lib/contracts/filamentStock.ts'
import type { ElementAmsSlot } from '../../lib/contracts/elementStatistics.ts'
import { ThemeModeProvider } from '../../src/theme/ThemeModeProvider.tsx'
import { FILAMENT_CATALOG } from '../../lib/contracts/bambuFilaments.ts'
import type {
  FilamentOrder, FilamentOrderLine, FilamentRollAdjustment,
} from '../../lib/contracts/filamentOrders.ts'

type User = ReturnType<typeof userEvent.setup>

const COCOA = 'bambu-lab/pla/basic/cocoa-brown-10802'
const GREEN = 'bambu-lab/pla/basic/bambu-green-10501'
const JADE = 'bambu-lab/pla/basic/jade-white-10100'
const BLACK = 'bambu-lab/pla/basic/black-10101'
const PETG_BLUE = 'bambu-lab/petg/basic/blue-30600'

const LISTED = FILAMENT_CATALOG.filter(color => !color.discontinued).length

const roll = (key: string, variant: 'spool' | 'refill', quantity = 1, unitPrice: number | null = 20): FilamentOrderLine => ({
  key, description: key, sku: null, variant, gramsPerUnit: 1000, quantity, unitPrice, discount: 0, tax: 0,
})

let nextId = 0
const bought = (orderedAt: string, lines: FilamentOrderLine[]): FilamentOrder => ({
  id: `order-${++nextId}`, createdAt: '', invoice: null, source: 'bambu-us-invoice', orderNumber: `us-${nextId}`,
  orderedAt, currency: 'USD', orderDiscount: 0, credit: 0, shipping: 0, grandTotal: null, note: null, lines,
})

const showEverything = async (user: User) =>
  user.click(await screen.findByRole('button', { name: 'Discontinued' }))

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The tile for one colour, by its full name. */
const tileOf = (colour: string) =>
  screen.getByRole('button', { name: new RegExp(`^${escape(colour)}, (not owned|owned: )`) })

/** Every colour tile on screen. The AMS trays are buttons too, named differently. */
const allTiles = () => screen.queryAllByRole('button', { name: /, (not owned|owned: )/ })

const tileNames = () => allTiles().map(tile => tile.getAttribute('aria-label')!.split(',')[0])

const openColour = async (user: User, colour: string) => {
  await user.click(tileOf(colour))
  return screen.findByRole('dialog')
}

let orders: FilamentOrder[] = []
let adjustments: FilamentRollAdjustment[] = []
let adjustmentPuts: FilamentRollAdjustment[] = []
let failLoad = false
// Usage is administrator data. `admin: false` answers 403, as the server does
// for everyone else; otherwise usage is computed from `jobs` and `mappings` by
// the real matcher, so the page is tested against the numbers it would get.
let admin = false
let jobs: ElementJob[] = []
let mappings: FilamentUsageMapping[] = []
let mappingPuts: FilamentUsageMapping[][] = []
// The AMS as the printer last reported it; null is "never reported".
let amsSlots: ElementAmsSlot[] | null = null
let amsReportedAt = new Date().toISOString()

const stubFetch = () => vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
  const path = String(url)
  const method = init?.method ?? 'GET'
  if (!path.includes('/api/filaments')) throw new Error(`unexpected fetch ${path}`)
  if (path.includes('/api/filaments/usage')) {
    if (!admin) return Response.json({ error: { code: 'forbidden', message: 'No.' } }, { status: 403 })
    if (method === 'PUT') {
      mappings = (JSON.parse(String(init?.body)) as { mappings: FilamentUsageMapping[] }).mappings
      mappingPuts.push(mappings)
      return Response.json({ mappings })
    }
    return Response.json({
      ...computeFilamentUsage(jobs, mappings),
      ams: amsStockOf(amsSlots === null ? null : {
        ...syntheticElementSnapshot, ams: amsSlots, fieldUpdatedAt: { ams: amsReportedAt },
      }),
    })
  }
  if (path.includes('/api/filaments/adjustments') && method === 'PUT') {
    const body = JSON.parse(String(init?.body)) as FilamentRollAdjustment
    adjustmentPuts.push(body)
    adjustments = [...adjustments.filter(entry => entry.key !== body.key),
      ...(body.finished > 0 ? [body] : [])]
    return Response.json({ adjustments })
  }
  if (path.includes('/api/filaments/orders')) {
    if (failLoad) return new Response('nope', { status: 500 })
    return Response.json({ orders, adjustments })
  }
  throw new Error(`unexpected ${method} ${path}`)
}))

const draw = () => render(
  <MemoryRouter><ThemeModeProvider><FilamentsPage /></ThemeModeProvider></MemoryRouter>,
)

/** A recorded print using one filament, shaped as the statistics history holds it. */
const used = (id: string, color: string, grams: number) => syntheticRecordedElementJob({
  id, result: 'completed',
  materials: [{
    material: 'PLA', filamentId: 'GFA00', color, estimatedWeightGrams: grams,
    nozzleId: null, amsId: null, slotId: null,
  }],
})

const loadedSlot = (slotId: string, color: string, remainingPercent: number | null): ElementAmsSlot => ({
  amsId: '0', slotId, material: 'PLA', subBrand: 'PLA Basic', color, remainingPercent, empty: false,
})

beforeEach(() => {
  orders = []
  adjustments = []
  adjustmentPuts = []
  failLoad = false
  admin = false
  jobs = []
  mappings = []
  mappingPuts = []
  amsSlots = null
  amsReportedAt = new Date().toISOString()
  stubFetch()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('renders one h1 and a section per product line', async () => {
  draw()
  await screen.findByRole('heading', { name: 'Filaments', level: 1 })
  assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1)
  for (const label of ['PLA Basic', 'PLA Matte', 'PETG Basic', 'PETG HF', 'PLA Wood', 'ABS']) {
    await screen.findByRole('heading', { name: label, level: 2 })
  }
})

test('every colour is one tile with a name of its own', async () => {
  const user = userEvent.setup()
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })
  assert.equal(allTiles().length, LISTED)
  await showEverything(user)
  const names = allTiles().map(tile => tile.getAttribute('aria-label'))
  assert.equal(names.length, FILAMENT_CATALOG.length)
  assert.equal(new Set(names).size, names.length, 'two tiles share an accessible name')
})

test('with no orders, the page says where the shelf comes from', async () => {
  draw()
  await screen.findByRole('heading', { name: 'Nothing on the shelf yet', level: 2 })
  const link = screen.getByRole('link', { name: 'Log your orders' })
  assert.equal(link.getAttribute('href'), '/filaments/orders')
  await screen.findByText(/^0 rolls in 0 colours/)
})

// The mock-up this answers: "2" beside the reel, then grams left, then grams used.
test('a tile counts rolls together, whatever their form, and says grams left and used', async () => {
  admin = true
  orders = [
    bought('2026-09-04', [roll(GREEN, 'spool')]),
    bought('2026-09-08', [roll(GREEN, 'refill', 1, 18)]),
  ]
  jobs = [used('g1', '#00AE42FF', 79)]
  draw()
  const tile = await screen.findByRole('button', {
    name: 'PLA Basic Bambu Green 10501, owned: 2 rolls, 1,921 g available, 79 g used',
  })
  expect(within(tile).getByText('2')).toBeTruthy()
  expect(within(tile).getByText('1,921 g available')).toBeTruthy()
  expect(within(tile).getByText('79 g used')).toBeTruthy()
  // And never the forms: spool or refill is a price, not a shelf.
  expect(within(tile).queryByText(/spool|refill/i)).toBeNull()
  await screen.findByText(/^2 rolls in 1 colour · 1,921 g available/)
})

test('a line lists what is on hand first, the most printed first', async () => {
  admin = true
  orders = [bought('2026-09-04', [roll(JADE, 'spool'), roll(BLACK, 'spool'), roll(COCOA, 'spool')])]
  jobs = [used('b', '#000000FF', 300), used('c', '#6F5034FF', 500)]
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })
  const basic = screen.getByRole('region', { name: 'PLA Basic' })
  const names = within(basic).getAllByRole('button').map(tile => tile.getAttribute('aria-label')!.split(',')[0])
  assert.deepEqual(names.slice(0, 3), [
    'PLA Basic Cocoa Brown 10802', 'PLA Basic Black 10101', 'PLA Basic Jade White 10100',
  ])
})

test('the sheet lists every roll with what it cost, and averages the price', async () => {
  const user = userEvent.setup()
  orders = [
    bought('2026-09-04', [roll(GREEN, 'spool', 1, 16)]),
    bought('2026-09-08', [roll(GREEN, 'refill', 1, 12)]),
  ]
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })
  const sheet = await openColour(user, 'PLA Basic Bambu Green 10501')
  expect(within(sheet).getByText('2 rolls · 2,000 g')).toBeTruthy()
  expect(within(sheet).getByText('$14.00 / kg')).toBeTruthy()
  expect(within(sheet).getByText('With spool · 1,000 g')).toBeTruthy()
  expect(within(sheet).getByText('Refill · 1,000 g')).toBeTruthy()
  expect(within(sheet).getByText('$16.00')).toBeTruthy()
})

test('a roll marked used up comes off the shelf, and Undo puts it back', async () => {
  const user = userEvent.setup()
  orders = [bought('2026-09-04', [roll(BLACK, 'spool', 2)])]
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })
  const sheet = await openColour(user, 'PLA Basic Black 10101')

  await user.click(within(sheet).getByRole('button', { name: 'Mark a roll used up' }))
  await waitFor(() => assert.deepEqual(adjustmentPuts.at(-1), { key: BLACK, finished: 1 }))
  await within(sheet).findByText('1 roll · 1,000 g')

  await user.click(within(sheet).getByRole('button', { name: 'Undo' }))
  await waitFor(() => assert.deepEqual(adjustmentPuts.at(-1), { key: BLACK, finished: 0 }))
  await within(sheet).findByText('2 rolls · 2,000 g')
  expect(within(sheet).queryByRole('button', { name: 'Undo' })).toBeNull()
})

test('the sheet steps to the next and previous colour', async () => {
  const user = userEvent.setup()
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })
  const shown = tileNames()
  const at = shown.indexOf('PLA Basic Jade White 10100')
  const sheet = await openColour(user, 'PLA Basic Jade White 10100')

  await user.click(within(sheet).getByRole('button', { name: 'Next colour' }))
  const next = FILAMENT_CATALOG.find(color => shown[at + 1].endsWith(`${color.name} ${color.code}`))!
  await within(sheet).findByRole('heading', { name: next.name, level: 2 })
  await user.click(within(sheet).getByRole('button', { name: 'Previous colour' }))
  await within(sheet).findByRole('heading', { name: 'Jade White', level: 2 })
})

// Half of PETG Basic is gone from the shop. The default is the shop.
test('hides discontinued colours until asked, except one that was bought', async () => {
  const user = userEvent.setup()
  draw()
  await screen.findByRole('heading', { name: 'PETG Basic', level: 2 })
  expect(screen.queryByRole('button', { name: /^PETG Basic Blue 30600, / })).toBeNull()
  await showEverything(user)
  assert.ok(tileOf('PETG Basic Blue 30600'))

  cleanup()
  orders = [bought('2026-09-04', [roll(PETG_BLUE, 'spool')])]
  draw()
  await screen.findByRole('button', { name: /^PETG Basic Blue 30600, owned: 1 roll/ })
})

test('a failed load offers a retry that works', async () => {
  const user = userEvent.setup()
  failLoad = true
  draw()
  await screen.findByRole('alert')
  assert.equal(allTiles().length, 0)
  failLoad = false
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })
})

test('search narrows every line, and Escape clears it', async () => {
  const user = userEvent.setup()
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })
  const before = allTiles().length
  await user.type(screen.getByLabelText('Search colours'), 'jade')
  await waitFor(() => expect(allTiles().length).toBeLessThan(before))
  for (const name of tileNames()) expect(name.toLowerCase()).toContain('jade')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(allTiles().length).toBe(before))
})

test('a search that matches nothing says so, and offers to clear the filters', async () => {
  const user = userEvent.setup()
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })
  const before = allTiles().length
  await user.type(screen.getByLabelText('Search colours'), 'zzzz')
  await screen.findByText('No colour matches those filters.')
  await user.click(screen.getByRole('button', { name: 'Clear filters' }))
  await waitFor(() => expect(allTiles().length).toBe(before))
})

test('"/" jumps to the search box', async () => {
  const user = userEvent.setup()
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })
  await user.keyboard('/')
  expect(document.activeElement).toBe(screen.getByLabelText('Search colours'))
  expect((screen.getByLabelText('Search colours') as HTMLInputElement).value).toBe('')
})

test('the Owned status leaves just the colours on hand', async () => {
  orders = [bought('2026-09-04', [roll(JADE, 'refill')])]
  const user = userEvent.setup()
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })
  await user.click(screen.getByRole('button', { name: 'Status' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Owned' }))
  await waitFor(() => expect(allTiles()).toHaveLength(1))
  expect(tileNames()).toEqual(['PLA Basic Jade White 10100'])
})

test('the Type filter shows one line', async () => {
  const user = userEvent.setup()
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })
  await user.click(screen.getByRole('button', { name: 'Type' }))
  await user.click(await screen.findByRole('menuitem', { name: 'ABS' }))
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'PLA Basic', level: 2 })).toBeNull())
  assert.ok(screen.getByRole('heading', { name: 'ABS', level: 2 }))
})

test('the filter bar leads to the orders', async () => {
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })
  assert.equal(screen.getByRole('link', { name: 'Orders' }).getAttribute('href'), '/filaments/orders')
})

const printed = (id: string, material: string, filamentId: string, color: string, grams: number) =>
  syntheticRecordedElementJob({
    id,
    materials: [{
      material, filamentId, color, estimatedWeightGrams: grams,
      nozzleId: '0', amsId: '0', slotId: '0',
    }],
  })

test('shows nothing about usage to an account that may not see it', async () => {
  jobs = [printed('1', 'PLA', 'GFA00', '#6F5034FF', 581)]
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })
  expect(screen.queryByRole('heading', { name: 'Print usage' })).toBeNull()
  expect(screen.queryByText(/used$/)).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

test('puts usage on the colour it matched, and links back to the statistics', async () => {
  admin = true
  jobs = [
    printed('1', 'PLA', 'GFA00', '#6F5034FF', 400),
    printed('2', 'PLA', 'GFA00', '#6F5034FF', 181),
  ]
  draw()
  await screen.findByRole('heading', { name: 'Print usage', level: 2 })
  await screen.findByText('581 g used')
  const link = screen.getByRole('link', { name: 'EL-ement Statistics' })
  assert.equal(link.getAttribute('href'), '/admin/el-ement-statistics')
  // Everything matched, so there is nothing to link.
  expect(screen.queryByRole('heading', { name: /Not linked to a colour/ })).toBeNull()
})

test('lists unmatched filament, and a link moves its usage onto the colour', async () => {
  const user = userEvent.setup()
  admin = true
  jobs = [printed('1', 'PLA', 'GFA00', '#307FE2FF', 816)]
  draw()

  await screen.findByRole('heading', { name: 'Not linked to a colour · 816 g', level: 3 })
  const picker = screen.getByRole('combobox', { name: 'What PLA · GFA00 · #307FE2 is' })
  await user.click(picker)
  await user.type(picker, 'Blue 10601')
  await user.click(await screen.findByRole('option', { name: 'PLA Basic · Blue 10601' }))

  await waitFor(() => {
    assert.deepEqual(mappingPuts.at(-1), [{
      source: { material: 'PLA', filamentId: 'GFA00', color: '#307FE2' },
      key: 'bambu-lab/pla/basic/blue-10601',
    }])
  })
  await screen.findByText('816 g used')
  expect(screen.queryByRole('heading', { name: /Not linked to a colour/ })).toBeNull()
  await screen.findByText(/PLA · GFA00 · #307FE2 →/)
})

test('"don\'t track" sets filament aside, and removing the link brings it back', async () => {
  const user = userEvent.setup()
  admin = true
  jobs = [printed('1', 'ABS', 'GFB99', '#161616FF', 84.5)]
  draw()

  const picker = await screen.findByRole('combobox', { name: 'What ABS · GFB99 · #161616 is' })
  await user.click(picker)
  await user.click(await screen.findByRole('option', { name: 'Don’t track this filament' }))
  await screen.findByText('not tracked (85 g)')
  expect(screen.queryByRole('heading', { name: /Not linked to a colour/ })).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Remove the link for ABS · GFB99 · #161616' }))
  await screen.findByRole('heading', { name: 'Not linked to a colour · 85 g', level: 3 })
  assert.deepEqual(mappingPuts.at(-1), [])
})


test('says to reorder a low loaded spool with nothing behind it, and another roll clears it', async () => {
  const user = userEvent.setup()
  admin = true
  orders = [bought('2026-09-04', [roll(COCOA, 'spool')])]
  amsSlots = [loadedSlot('0', '#6F5034FF', 12), loadedSlot('1', '#8E9089FF', 62)]
  draw()

  const banner = await screen.findByRole('status', { name: 'Reorder soon' })
  assert.match(banner.textContent ?? '', /PLA Basic · Cocoa Brown 10802 — 12% left in AMS 1 · slot 1, with no spare on the shelf/)
  assert.doesNotMatch(banner.textContent ?? '', /Gray/)
  assert.ok(tileOf('PLA Basic Cocoa Brown 10802').getAttribute('aria-label')?.includes('in A1, 12%, reorder'))
  const sheet = await openColour(user, 'PLA Basic Cocoa Brown 10802')
  await within(sheet).findByText('A1 · 12% · ≈120 g · reorder')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  // A second roll bought is a spare behind the loaded one.
  cleanup()
  orders = [bought('2026-09-04', [roll(COCOA, 'spool', 2)])]
  draw()
  await screen.findByRole('region', { name: 'In the AMS' })
  expect(screen.queryByRole('status', { name: /Reorder soon/ })).toBeNull()
})

test('a low colour with nothing bought says so', async () => {
  admin = true
  amsSlots = [loadedSlot('3', '#FFFFFFFF', 4)]
  draw()
  const banner = await screen.findByRole('status', { name: 'Reorder soon' })
  assert.match(banner.textContent ?? '', /Jade White 10100 — 4% left in AMS 1 · slot 4, and none is left on your shelf/)
})

test('an old reading says when it was taken; an unreported percentage never warns', async () => {
  admin = true
  amsReportedAt = '2026-09-01T09:30:00.000Z'
  amsSlots = [loadedSlot('0', '#6F5034FF', 3), loadedSlot('1', '#8E9089FF', null)]
  draw()
  const banner = await screen.findByRole('status', { name: 'Reorder soon' })
  assert.match(banner.textContent ?? '', /last reading/)
  assert.doesNotMatch(banner.textContent ?? '', /Gray/)
  const sheet = await openColour(userEvent.setup(), 'PLA Basic Gray 10103')
  await within(sheet).findByText('In A2')
})

test('usage is costed from what was paid for it', async () => {
  admin = true
  orders = [bought('2026-09-04', [roll(JADE, 'spool', 1, 20)])]
  jobs = [used('p1', '#FFFFFF', 1000)]
  draw()
  // 1 kg of a colour bought at 20 a kilogram.
  const line = await screen.findByText(/of filament, from the/)
  expect(line.textContent).toMatch(/\$20\.00/)
})

test('the AMS is drawn with every tray, and names what is in each', async () => {
  admin = true
  orders = [bought('2026-09-04', [roll(COCOA, 'spool', 2)])]
  // Tray 3 is empty and the printer does not report it, as a real AMS does not.
  amsSlots = [
    loadedSlot('0', '#6F5034FF', 40),
    // Assumed: the AMS names a gradient spool by its product line, as it does
    // every other Bambu spool. Not yet seen from a real printer.
    { ...loadedSlot('1', '#307FE2FF', 80), subBrand: 'PLA Basic Gradient' },
    loadedSlot('3', '#8E9089FF', null),
  ]
  draw()

  const panel = await screen.findByRole('region', { name: 'In the AMS' })
  // One picture of the unit, described in full for anyone who cannot see it.
  const unit = within(panel).getByRole('group', { name: /^AMS 1:/ })
  const described = unit.getAttribute('aria-label') ?? ''
  expect(described).toMatch(/A1: PLA Basic Cocoa Brown 10802, 40% · ≈400 g/)
  expect(described).toMatch(/A3: empty/)
  expect(described).toMatch(/A4: .*Amount not reported/)
  // The gradient spool reports its first colour and is recognised by it.
  expect(described).toMatch(/A2: PLA Basic Gradient Ocean to Meadow 10902/)
  expect(within(panel).getByText('Empty')).toBeTruthy()
})

test('a spool loaded on the external holder sits beside the AMS', async () => {
  admin = true
  amsSlots = [
    loadedSlot('0', '#6F5034FF', 40),
    { ...loadedSlot('254', '#6F5034FF', 70), amsId: 'external' },
  ]
  draw()
  const panel = await screen.findByRole('region', { name: 'In the AMS' })
  expect(within(panel).getByRole('group', { name: /^External spool: Ext: PLA Basic Cocoa Brown 10802, 70%/ })).toBeTruthy()
  expect(within(panel).getByText('External')).toBeTruthy()
})

test('a colour says what its prints reported, and one source can be set aside', async () => {
  const user = userEvent.setup()
  admin = true
  jobs = [used('w1', '#FFFFFF', 24)]
  draw()
  await screen.findByRole('heading', { name: 'Print usage', level: 2 })
  const sheet = await openColour(user, 'PLA Basic Jade White 10100')
  expect(within(sheet).getByText('24 g · 1 print · matched automatically')).toBeTruthy()

  await user.click(within(sheet).getByRole('button', { name: 'Don’t track PLA · GFA00 · #FFFFFF' }))
  await waitFor(() => assert.deepEqual(mappingPuts.at(-1), [{
    source: { material: 'PLA', filamentId: 'GFA00', color: '#FFFFFF' }, key: null,
  }]))
  await waitFor(() => expect(within(sheet).queryByRole('heading', { name: 'Printed as' })).toBeNull())
  await user.keyboard('{Escape}')
  await screen.findByText('not tracked (24 g)')
})
