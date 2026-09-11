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
import FilamentsPage from '../../src/features/filaments/FilamentsPage.tsx'
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

interface PutBody { owned: { key: string; variant: string }[] }

let puts: PutBody[] = []
let owned: { key: string; variant: string }[] = []
let failLoad = false
let failSave = false

const stubFetch = () => vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
  const path = String(url)
  if (!path.includes('/api/filaments')) throw new Error(`unexpected fetch ${path}`)
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
  <ThemeModeProvider><FilamentsPage /></ThemeModeProvider>,
)

beforeEach(() => {
  puts = []
  owned = []
  failLoad = false
  failSave = false
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

  for (const label of ['PLA Basic', 'PLA Matte', 'PETG Basic', 'PLA Wood', 'ABS']) {
    await screen.findByRole('heading', { name: label, level: 2 })
  }
})

// A column heading cannot name a grid cell, so each of the 165 checkboxes has
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
    { key: 'bambu-lab/pla/basic/jade-white-10100', variant: 'spool' },
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
      { key: 'bambu-lab/pla/basic/jade-white-10100', variant: 'refill' },
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
  owned = [{ key: 'bambu-lab/petg/basic/blue-30600', variant: 'spool' }]
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
  owned = [{ key: 'bambu-lab/petg/basic/blue-30600', variant: 'spool' }]
  draw()
  await screen.findByRole('heading', { name: 'PETG Basic', level: 2 })

  await user.click(screen.getByLabelText('PETG Basic Blue 30600, with spool'))
  await waitFor(() => { assert.deepEqual(puts.at(-1)?.owned, []) })

  const box = screen.getByLabelText('PETG Basic Blue 30600, with spool') as HTMLInputElement
  assert.equal(box.checked, false)
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
