// @vitest-environment jsdom
//
// The filaments page through the real components, with the API stubbed at the
// fetch boundary. What is pinned is what a person can get wrong silently: a
// checkbox nobody can name, a tick that never reaches the server, a line
// offering a variant it is not sold in, and a coalescing writer that drops the
// last tick of a fast run.
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
import {
  FILAMENT_CATALOG, FILAMENT_LINES, FILAMENT_PAIR_COUNT,
} from '../../lib/contracts/bambuFilaments.ts'

const VARIANT_COUNT = new Map(FILAMENT_LINES.map(
  line => [`${line.brand}/${line.material}/${line.type}`, line.variants.length]))

/** Pairs left once the discontinued colours are filtered out -- the page's default. */
const LISTED_PAIR_COUNT = FILAMENT_CATALOG.reduce(
  (total, color) => total + (color.discontinued ? 0 : VARIANT_COUNT.get(color.line) ?? 0), 0)

const showEverything = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(await screen.findByRole('switch', { name: 'Hide discontinued' }))

interface PutBody { owned: { key: string; variant: string; quantity: number }[] }

let puts: PutBody[] = []
let owned: { key: string; variant: string; quantity: number }[] = []
let failLoad = false
let failSave = false
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
  if (!path.includes('/api/filaments')) throw new Error(`unexpected fetch ${path}`)
  if (path.includes('/api/filaments/usage')) {
    if (!admin) return Response.json({ error: { code: 'forbidden', message: 'No.' } }, { status: 403 })
    if ((init?.method ?? 'GET') === 'PUT') {
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
  if ((init?.method ?? 'GET') === 'GET') {
    if (failLoad) return new Response('nope', { status: 500 })
    return Response.json({ owned })
  }
  const body = JSON.parse(String(init?.body)) as PutBody
  puts.push(body)
  if (failSave) return new Response('nope', { status: 500 })
  owned = body.owned
  return Response.json({ owned })
}))

const draw = () => render(
  <MemoryRouter><ThemeModeProvider><FilamentsPage /></ThemeModeProvider></MemoryRouter>,
)

beforeEach(() => {
  puts = []
  owned = []
  failLoad = false
  failSave = false
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

// A column heading cannot name a grid cell, so each of the 193 checkboxes has
// to name itself. A duplicate name means two of them are indistinguishable by
// ear, which is the failure this page is most prone to.
test('gives every checkbox a unique accessible name', async () => {
  const user = userEvent.setup()
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })
  await showEverything(user)

  const boxes = screen.getAllByRole('checkbox')
  assert.equal(boxes.length, FILAMENT_PAIR_COUNT)

  const names = boxes.map(box => box.getAttribute('aria-label'))
  assert.ok(names.every(name => name && name.length > 0), 'a checkbox has no accessible name')
  assert.equal(new Set(names).size, names.length, 'two checkboxes share an accessible name')
})

// The catalogue's shape, surfaced: only the two PLA lines are sold as refills.
test('offers two variants on PLA Basic and one on ABS', async () => {
  draw()
  const basic = await screen.findByRole('region', { name: 'PLA Basic' })
  const abs = await screen.findByRole('region', { name: 'ABS' })

  assert.ok(within(basic).getByLabelText('PLA Basic Jade White 10100, with spool'))
  assert.ok(within(basic).getByLabelText('PLA Basic Jade White 10100, refill'))

  assert.ok(within(abs).getByLabelText('ABS Red 40200, with spool'))
  assert.equal(within(abs).queryByLabelText('ABS Red 40200, refill'), null)
})

test('a tick sends the whole inventory and survives a reload', async () => {
  const user = userEvent.setup()
  const first = draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })

  await user.click(screen.getByLabelText('PLA Basic Jade White 10100, with spool'))
  await waitFor(() => { assert.ok(puts.length >= 1) })
  assert.deepEqual(puts.at(-1)?.owned, [
    { key: 'bambu-lab/pla/basic/jade-white-10100', variant: 'spool', quantity: 1 },
  ])

  first.unmount()
  draw()
  await waitFor(() => {
    expect((screen.getByLabelText('PLA Basic Jade White 10100, with spool') as HTMLInputElement)
      .checked).toBe(true)
  })
})

test('unticking removes just that pair', async () => {
  const user = userEvent.setup()
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })

  await user.click(screen.getByLabelText('PLA Basic Jade White 10100, with spool'))
  await user.click(screen.getByLabelText('PLA Basic Jade White 10100, refill'))
  await waitFor(() => { assert.equal(puts.at(-1)?.owned.length, 2) })

  await user.click(screen.getByLabelText('PLA Basic Jade White 10100, with spool'))
  await waitFor(() => {
    assert.deepEqual(puts.at(-1)?.owned, [
      { key: 'bambu-lab/pla/basic/jade-white-10100', variant: 'refill', quantity: 1 },
    ])
  })
})

// The writer coalesces, so a fast run is not one request per tick -- but the
// last request must still describe everything that was ticked.
test('coalesces a fast run without losing the last tick', async () => {
  const user = userEvent.setup()
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })

  const labels = [
    'PLA Basic Jade White 10100, with spool',
    'PLA Basic Black 10101, with spool',
    'PLA Basic Gray 10103, with spool',
    'PLA Basic Red 10200, with spool',
  ]
  for (const label of labels) await user.click(screen.getByLabelText(label))

  await waitFor(() => { assert.equal(puts.at(-1)?.owned.length, 4) })
  assert.ok(puts.length <= labels.length, 'the writer issued more requests than ticks')
  assert.deepEqual(
    puts.at(-1)?.owned.map(entry => entry.key).sort(),
    [
      'bambu-lab/pla/basic/black-10101',
      'bambu-lab/pla/basic/gray-10103',
      'bambu-lab/pla/basic/jade-white-10100',
      'bambu-lab/pla/basic/red-10200',
    ],
  )
})

// The denominator is what is on screen, not what the catalogue holds: counting
// against rows the filter is hiding would read as a page that lost something.
test('counts what is owned against what is listed', async () => {
  const user = userEvent.setup()
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })
  await screen.findByText(new RegExp(`^0 of ${LISTED_PAIR_COUNT} owned`))

  await user.click(screen.getByLabelText('PLA Basic Jade White 10100, with spool'))
  await screen.findByText(new RegExp(`^1 of ${LISTED_PAIR_COUNT} owned`))

  await showEverything(user)
  await screen.findByText(new RegExp(`^1 of ${FILAMENT_PAIR_COUNT} owned`))
})

// Half of PETG Basic is gone from the shop. The default is the shop.
test('hides discontinued colours until the switch is turned off', async () => {
  const user = userEvent.setup()
  draw()
  await screen.findByRole('heading', { name: 'PETG Basic', level: 2 })

  const listed = screen.getAllByRole('checkbox')
  assert.equal(listed.length, LISTED_PAIR_COUNT)
  assert.equal(screen.queryByLabelText('PETG Basic Blue 30600, with spool'), null)
  assert.ok(screen.getByLabelText('PETG Basic Pine Green 30503, with spool'))

  await showEverything(user)
  assert.equal(screen.getAllByRole('checkbox').length, FILAMENT_PAIR_COUNT)
  assert.ok(screen.getByLabelText('PETG Basic Blue 30600, with spool'))
})

// The catalogue keeps dead SKUs because a spool outlives its listing. A tick
// the filter hid would be a tick nobody could find, let alone correct.
test('never hides a discontinued filament you own', async () => {
  owned = [{ key: 'bambu-lab/petg/basic/blue-30600', variant: 'spool', quantity: 1 }]
  draw()
  await screen.findByRole('heading', { name: 'PETG Basic', level: 2 })

  const box = screen.getByLabelText('PETG Basic Blue 30600, with spool') as HTMLInputElement
  assert.equal(box.checked, true)
  assert.equal(screen.queryByLabelText('PETG Basic Gold 30401, with spool'), null)
})

// Clearing a tick must not pull the row out from under the pointer -- you may
// have meant to tick the other variant, or to put the tick straight back.
test('an owned discontinued row stays put when its last tick is cleared', async () => {
  const user = userEvent.setup()
  owned = [{ key: 'bambu-lab/petg/basic/blue-30600', variant: 'spool', quantity: 1 }]
  draw()
  await screen.findByRole('heading', { name: 'PETG Basic', level: 2 })

  await user.click(screen.getByLabelText('PETG Basic Blue 30600, with spool'))
  await waitFor(() => { assert.deepEqual(puts.at(-1)?.owned, []) })

  const box = screen.getByLabelText('PETG Basic Blue 30600, with spool') as HTMLInputElement
  assert.equal(box.checked, false)
})

// A tick is one spool. The count sits beside it on every owned tick, so the way
// to say "I have three of these" is on screen rather than behind a gesture.
test('steps a count up and down, and sends it', async () => {
  const user = userEvent.setup()
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })
  const name = 'PLA Basic Jade White 10100, with spool'

  // Nothing to count until it is owned.
  assert.equal(screen.queryByRole('button', { name: new RegExp(`^${name}:`) }), null)
  await user.click(screen.getByLabelText(name))
  await user.click(await screen.findByRole('button', { name: `${name}: 1 spool. Change how many` }))

  const stepper = await screen.findByRole('dialog', { name: `How many: ${name}` })
  // Stops at one: going to none is unticking, which has its own control.
  assert.equal((within(stepper).getByRole('button', { name: 'One fewer' }) as HTMLButtonElement)
    .disabled, true)

  await user.click(within(stepper).getByRole('button', { name: 'One more' }))
  await user.click(within(stepper).getByRole('button', { name: 'One more' }))
  await within(stepper).findByText('3 spools')
  await waitFor(() => {
    assert.deepEqual(puts.at(-1)?.owned, [
      { key: 'bambu-lab/pla/basic/jade-white-10100', variant: 'spool', quantity: 3 },
    ])
  })

  await user.click(within(stepper).getByRole('button', { name: 'One fewer' }))
  await waitFor(() => { assert.equal(puts.at(-1)?.owned[0].quantity, 2) })
  await user.keyboard('{Escape}')
  assert.ok(await screen.findByRole('button', { name: `${name}: 2 spools. Change how many` }))
})

test('reads stored counts back, per form, and totals the rolls', async () => {
  owned = [
    { key: 'bambu-lab/pla/basic/jade-white-10100', variant: 'spool', quantity: 3 },
    { key: 'bambu-lab/pla/basic/jade-white-10100', variant: 'refill', quantity: 2 },
  ]
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })

  assert.ok(screen.getByRole('button', {
    name: 'PLA Basic Jade White 10100, with spool: 3 spools. Change how many',
  }))
  assert.ok(screen.getByRole('button', {
    name: 'PLA Basic Jade White 10100, refill: 2 refills. Change how many',
  }))
  // Two ticks, five rolls on the shelf.
  await screen.findByText(new RegExp(`^2 of ${LISTED_PAIR_COUNT} owned \\(5 rolls\\)`))
})

// Unticking is the only way to own none, and it forgets the count with it.
test('unticking a counted filament removes it outright', async () => {
  const user = userEvent.setup()
  owned = [{ key: 'bambu-lab/pla/basic/black-10101', variant: 'spool', quantity: 4 }]
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })

  await user.click(screen.getByLabelText('PLA Basic Black 10101, with spool'))
  await waitFor(() => { assert.deepEqual(puts.at(-1)?.owned, []) })
  assert.equal(screen.queryByRole('button', {
    name: /^PLA Basic Black 10101, with spool:/,
  }), null)
})

test('a failed load offers a retry that works', async () => {
  const user = userEvent.setup()
  failLoad = true
  draw()

  await screen.findByRole('alert')
  assert.equal(screen.queryAllByRole('checkbox').length, 0)

  failLoad = false
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })
})

// A tick that did not store must not sit on screen looking stored with nothing
// said about it.
test('says so when a tick could not be saved', async () => {
  const user = userEvent.setup()
  failSave = true
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })

  await user.click(screen.getByLabelText('PLA Basic Jade White 10100, with spool'))
  const alert = await screen.findByRole('alert')
  assert.match(alert.textContent ?? '', /Not saved/)
})

/** A recorded print using one filament, shaped as the statistics history holds it. */
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
  assert.equal(screen.queryByRole('heading', { name: 'Print usage' }), null)
  assert.equal(screen.queryByText(/used$/), null)
  assert.equal(screen.queryByRole('alert'), null)
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
  assert.equal(screen.queryByRole('heading', { name: /Not linked to a colour/ }), null)
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
  assert.equal(screen.queryByRole('heading', { name: /Not linked to a colour/ }), null)
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
  assert.equal(screen.queryByRole('heading', { name: /Not linked to a colour/ }), null)

  await user.click(screen.getByRole('button', { name: 'Remove the link for ABS · GFB99 · #161616' }))
  await screen.findByRole('heading', { name: 'Not linked to a colour · 85 g', level: 3 })
  assert.deepEqual(mappingPuts.at(-1), [])
})

const loadedSlot = (slotId: string, color: string, remainingPercent: number | null): ElementAmsSlot => ({
  amsId: '0', slotId, material: 'PLA', subBrand: 'PLA Basic', color, remainingPercent, empty: false,
})

test('says to reorder a low loaded spool with no spare, and a spare clears it', async () => {
  const user = userEvent.setup()
  admin = true
  owned = [{ key: 'bambu-lab/pla/basic/cocoa-brown-10802', variant: 'spool', quantity: 1 }]
  amsSlots = [loadedSlot('0', '#6F5034FF', 12), loadedSlot('1', '#8E9089FF', 62)]
  draw()

  const banner = await screen.findByRole('status', { name: 'Reorder soon' })
  assert.match(banner.textContent ?? '', /PLA Basic · Cocoa Brown 10802 — 12% left in AMS 1 · slot 1, with no spare on the shelf/)
  // Gray is loaded but not low, so it is not in the banner.
  assert.doesNotMatch(banner.textContent ?? '', /Gray/)
  // The note carries the grams that percentage is of a full spool.
  await screen.findByText('AMS 12% · ≈120 g · reorder')
  await screen.findByText('AMS 62% · ≈620 g')

  // One more Cocoa Brown on the shelf is a spare behind the loaded spool.
  const name = 'PLA Basic Cocoa Brown 10802, with spool'
  await user.click(screen.getByRole('button', { name: `${name}: 1 spool. Change how many` }))
  await user.click(await screen.findByRole('button', { name: 'One more' }))
  await waitFor(() => {
    assert.equal(screen.queryByRole('status', { name: /Reorder soon/ }), null)
  })
  await screen.findByText('AMS 12% · ≈120 g · spare on shelf')
})

test('a low colour never ticked in the inventory says so', async () => {
  admin = true
  amsSlots = [loadedSlot('3', '#FFFFFFFF', 4)]
  draw()
  const banner = await screen.findByRole('status', { name: 'Reorder soon' })
  assert.match(banner.textContent ?? '', /Jade White 10100 — 4% left in AMS 1 · slot 4, and it is not in your inventory/)
})

test('an old reading says when it was taken; an unreported percentage never warns', async () => {
  admin = true
  amsReportedAt = '2026-09-01T09:30:00.000Z'
  amsSlots = [loadedSlot('0', '#6F5034FF', 3), loadedSlot('1', '#8E9089FF', null)]
  draw()
  const banner = await screen.findByRole('status', { name: 'Reorder soon' })
  assert.match(banner.textContent ?? '', /last reading/)
  assert.doesNotMatch(banner.textContent ?? '', /Gray/)
  await screen.findByText('in AMS')
})

test('search narrows every line to the colours that match, and Escape clears it', async () => {
  const user = userEvent.setup()
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })
  const before = screen.getAllByRole('checkbox').length

  await user.type(screen.getByLabelText('Search colours'), 'jade')

  await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBeLessThan(before))
  for (const box of screen.getAllByRole('checkbox')) {
    expect(box.getAttribute('aria-label')?.toLowerCase()).toContain('jade')
  }

  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBe(before))
})

test('a search that matches nothing says so rather than showing an empty page', async () => {
  const user = userEvent.setup()
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })

  await user.type(screen.getByLabelText('Search colours'), 'zzzz')

  await screen.findByText('No colour matches those filters.')
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
})

test('"/" jumps to the search box', async () => {
  const user = userEvent.setup()
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })

  await user.keyboard('/')

  expect(document.activeElement).toBe(screen.getByLabelText('Search colours'))
  // And it is a shortcut, not a character: the field is still empty.
  expect((screen.getByLabelText('Search colours') as HTMLInputElement).value).toBe('')
})

test('Owned only leaves just the ticked colours', async () => {
  owned = [{ key: 'bambu-lab/pla/basic/jade-white-10100', variant: 'spool', quantity: 1 }]
  const user = userEvent.setup()
  draw()
  await screen.findByRole('heading', { name: 'PLA Basic', level: 2 })

  await user.click(await screen.findByRole('switch', { name: 'Owned only' }))

  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2))
  // One colour, both of the forms PLA Basic is sold in; the ticked one is on.
  expect(screen.getAllByRole('checkbox').filter(box => (box as HTMLInputElement).checked))
    .toHaveLength(1)
})
