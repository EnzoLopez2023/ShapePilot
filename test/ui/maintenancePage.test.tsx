// @vitest-environment jsdom
//
// The maintenance page through the real components, with the API stubbed at the
// fetch boundary and the clock pinned so "today" is a fixed day.
//
// What is pinned here is what a person can get wrong silently: a calendar that
// schedules from a date nobody entered, a due date that disagrees with the job
// card next to it, a logged service that never reached the server, and a
// calendar grid whose days cannot be reached or understood without sight.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MaintenancePage from '../../src/features/maintenance/MaintenancePage.tsx'
import { ThemeModeProvider } from '../../src/theme/ThemeModeProvider.tsx'
import { MAINTENANCE_TASKS } from '../../lib/contracts/x2dMaintenance.ts'
// The app formats dates in the reader's own locale, so the expected strings
// are built with the same helper rather than written out in one locale's form.
// Hard-coding "3 Nov 2026" would pass in London and fail in New York.
import { formatDay } from '../../src/features/maintenance/components/statusStyle.ts'

// The printer entered service on 4 September 2026, and it is now the 15th.
const COMMISSIONED = '2026-09-04'
const TODAY = new Date(2026, 8, 15, 10, 0, 0)

interface Profile {
  commissionedOn: string
  usageTier: string
  filamentWear: string
  rollsUsed: number
}

interface Event {
  id: number
  taskKey: string
  performedOn: string
  note: string | null
  createdAt: string
}

let profile: Profile | null = null
let events: Event[] = []
let posted: unknown[] = []
let puts: unknown[] = []
let deleted: number[] = []
let failWrite = false
let nextId = 100

const stubFetch = () => vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
  const path = String(url)
  const method = init?.method ?? 'GET'
  if (!path.includes('/api/maintenance')) throw new Error(`unexpected fetch ${path}`)

  if (method === 'GET') return Response.json({ profile, events })
  if (failWrite) return new Response('nope', { status: 500 })

  if (method === 'PUT') {
    const body = JSON.parse(String(init?.body)) as Profile
    puts.push(body)
    profile = body
    return Response.json(body)
  }
  if (method === 'POST') {
    const body = JSON.parse(String(init?.body)) as { taskKey: string; performedOn: string }
    posted.push(body)
    const event: Event = {
      id: nextId++,
      taskKey: body.taskKey,
      performedOn: body.performedOn,
      note: null,
      createdAt: `${body.performedOn}T10:00:00Z`,
    }
    events = [event, ...events]
    return Response.json(event, { status: 201 })
  }
  const id = Number(path.split('/').pop())
  deleted.push(id)
  events = events.filter(event => event.id !== id)
  return Response.json({ ok: true })
}))

const draw = () => render(
  <ThemeModeProvider><MaintenancePage /></ThemeModeProvider>,
)

/** A page that already has a profile, which is the normal case. */
const withProfile = (overrides: Partial<Profile> = {}) => {
  profile = {
    commissionedOn: COMMISSIONED,
    usageTier: 'regular',
    filamentWear: 'standard',
    rollsUsed: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(TODAY)
  profile = null
  events = []
  posted = []
  puts = []
  deleted = []
  failWrite = false
  nextId = 100
  stubFetch()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

test('asks when the printer entered service before scheduling anything', async () => {
  draw()
  await screen.findByRole('heading', { name: 'When did this printer enter service?', level: 2 })

  // No calendar and no job cards until it has an answer: every date on the page
  // would otherwise be counted from a day nobody supplied.
  assert.equal(screen.queryByRole('grid', { name: 'Maintenance calendar' }), null)
  assert.equal(screen.queryByText('Clean and lubricate the X and Y axes'), null)
})

test('starting the calendar saves the profile and reveals the schedule', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  draw()
  const date = await screen.findByLabelText('First used')
  await user.clear(date)
  await user.type(date, '2026-09-04')
  await user.click(screen.getByRole('button', { name: 'Start the calendar' }))

  await waitFor(() => assert.equal(puts.length, 1))
  assert.deepEqual(puts[0], {
    commissionedOn: COMMISSIONED,
    usageTier: 'regular',
    filamentWear: 'standard',
    rollsUsed: 0,
  })
  await screen.findByRole('grid', { name: 'Maintenance calendar' })
})

test('renders one h1 and every catalogue task', async () => {
  withProfile()
  draw()
  await screen.findByRole('heading', { name: 'X2D maintenance', level: 1 })
  assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1)

  for (const task of MAINTENANCE_TASKS) {
    await screen.findByRole('heading', { name: task.title, level: 3 })
  }
})

test('a printer 11 days old is overdue for nothing', async () => {
  withProfile()
  draw()
  await screen.findByRole('heading', { name: 'Nothing is due', level: 2 })
  // The plate is the first job due: 4 Sep + 14 days.
  await screen.findByText(/in 3 days, on/)
})

test('dates each job from the day the printer entered service', async () => {
  withProfile()
  draw()
  const heading = await screen.findByRole('heading', {
    name: 'Clean and lubricate the X and Y axes', level: 3,
  })
  // 4 Sep + 60 days at the regular tier is 3 November.
  const card = heading.closest('button') as HTMLElement
  assert.match(card.textContent ?? '', /First service due in 49 days/)
  assert.ok((card.textContent ?? '').includes(formatDay('2026-11-03')))
  assert.match(card.textContent ?? '', /Never logged/)
})

test('says whose interval each one is', async () => {
  withProfile()
  draw()
  const axes = (await screen.findByRole('heading', {
    name: 'Clean and lubricate the X and Y axes', level: 3,
  })).closest('button') as HTMLElement
  assert.match(axes.textContent ?? '', /Bambu’s interval|Bambu's interval/)

  const plate = (await screen.findByRole('heading', {
    name: 'Wash the textured PEI plate', level: 3,
  })).closest('button') as HTMLElement
  assert.match(plate.textContent ?? '', /ShapePilot’s suggestion/)
})

test('logging a service sends it and moves the due date', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  withProfile()
  draw()

  const heading = await screen.findByRole('heading', {
    name: 'Clean and lubricate the X and Y axes', level: 3,
  })
  await user.click(heading.closest('button') as HTMLElement)
  await user.click(await screen.findByRole('button', { name: 'Log this service' }))
  await user.click(await screen.findByRole('button', { name: 'Save to the log' }))

  await waitFor(() => assert.equal(posted.length, 1))
  assert.deepEqual(posted[0], { taskKey: 'xy-axes', performedOn: '2026-09-15', note: '' })

  // 15 Sep + 60 days is 14 November, and the card now says so.
  await waitFor(() => {
    const card = screen.getByRole('heading', {
      name: 'Clean and lubricate the X and Y axes', level: 3,
    }).closest('button') as HTMLElement
    assert.ok((card.textContent ?? '').includes(formatDay('2026-11-14')))
    assert.ok((card.textContent ?? '').includes(`Last done ${formatDay('2026-09-15')}`))
  })
})

test('a failed write says so rather than showing a service that was not saved', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  withProfile()
  failWrite = true
  draw()

  const heading = await screen.findByRole('heading', {
    name: 'Wash the textured PEI plate', level: 3,
  })
  await user.click(heading.closest('button') as HTMLElement)
  await user.click(await screen.findByRole('button', { name: 'Log this service' }))
  await user.click(await screen.findByRole('button', { name: 'Save to the log' }))

  await screen.findByText('Not saved')
  // And the card still says the job has never been done, because it has not.
  const card = screen.getByRole('heading', {
    name: 'Wash the textured PEI plate', level: 3,
  }).closest('button') as HTMLElement
  assert.match(card.textContent ?? '', /Never logged/)
})

test('overdue jobs are listed at the top, soonest first', async () => {
  // A printer commissioned in March and never touched since.
  withProfile({ commissionedOn: '2026-03-01' })
  draw()

  const heading = await screen.findByRole('heading', { name: /jobs to do/, level: 2 })
  const panel = heading.parentElement as HTMLElement
  const text = panel.textContent ?? ''
  assert.match(text, /Wash the textured PEI plate/)
  assert.match(text, /Clean and lubricate the X and Y axes/)
  // The plate is on a 14-day interval and the axes on 60, so the plate is the
  // more overdue of the two and is listed first.
  assert.ok(text.indexOf('Wash the textured PEI plate') < text.indexOf('Clean and lubricate'))
  // The condition-based jobs never appear here.
  assert.ok(!text.includes('Replace the auxiliary PTFE tube'))
})

test('the calendar names every day for a screen reader, dots and all', async () => {
  withProfile()
  draw()
  const grid = await screen.findByRole('grid', { name: 'Maintenance calendar' })
  const cells = within(grid).getAllByRole('gridcell')
  assert.equal(cells.length, 42)

  // Every cell is reachable and named, not only the ones with something on them.
  const names = cells.map(cell => cell.getAttribute('aria-label'))
  assert.ok(names.every(name => name && name.length > 0), 'a day has no accessible name')

  const today = cells.find(cell => cell.getAttribute('aria-current') === 'date')
  assert.ok(today, 'today is not marked')
  assert.equal(today.getAttribute('aria-label'), `${formatDay('2026-09-15')}, today`)

  // 18 Sep is the plate wash, 14 days after commissioning, and it says so.
  const due = cells.find(
    cell => cell.getAttribute('aria-label')?.startsWith(formatDay('2026-09-18')))
  assert.match(due?.getAttribute('aria-label') ?? '', /due — Wash the textured PEI plate/)
})

test('choosing a day says what falls due on it', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  withProfile()
  draw()
  const grid = await screen.findByRole('grid', { name: 'Maintenance calendar' })

  await user.click(within(grid).getByRole('gridcell', {
    name: new RegExp(`^${formatDay('2026-09-18')}`),
  }))
  await screen.findByText(formatDay('2026-09-18'))
  await screen.findByText('Wash the textured PEI plate', { selector: 'p' })

  await user.click(within(grid).getByRole('gridcell', { name: formatDay('2026-09-17') }))
  await screen.findByText('Nothing falls due on this day.')
})

test('paging to another month keeps the grid six weeks tall', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  withProfile()
  draw()
  await screen.findByRole('heading', { name: 'September 2026', level: 2 })

  await user.click(screen.getByRole('button', { name: 'Next month' }))
  await screen.findByRole('heading', { name: 'October 2026', level: 2 })
  const grid = screen.getByRole('grid', { name: 'Maintenance calendar' })
  assert.equal(within(grid).getAllByRole('gridcell').length, 42)

  await user.click(screen.getByRole('button', { name: 'Today' }))
  await screen.findByRole('heading', { name: 'September 2026', level: 2 })
})

test('the roll counter writes straight through, and a blade check resets it', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  withProfile({ rollsUsed: 7 })
  draw()

  await user.click(await screen.findByRole('button', { name: '+1 roll' }))
  await waitFor(() => assert.equal((puts[0] as Profile).rollsUsed, 8))
  // At 8 rolls the blade is due a look, and says so in both places it appears:
  // the attention list at the top and the job's own card.
  await waitFor(() => assert.equal(screen.getAllByText(/inspect the blade/).length, 2))

  const heading = screen.getByRole('heading', {
    name: 'Check the filament cutter blade', level: 3,
  })
  await user.click(heading.closest('button') as HTMLElement)
  await user.click(await screen.findByRole('button', { name: 'Log this service' }))
  await user.click(await screen.findByRole('button', { name: 'Save to the log' }))

  // Logging the check is what zeroes the count -- the reader should not have to.
  await waitFor(() => assert.equal((puts.at(-1) as Profile).rollsUsed, 0))
})

/** One logged service, for the two removal tests below. */
const withOneEntry = () => {
  withProfile()
  events = [{
    id: 42,
    taskKey: 'xy-axes',
    performedOn: '2026-09-10',
    note: 'Ran quiet afterwards',
    createdAt: '2026-09-10T10:00:00Z',
  }]
}

const REMOVE_LABEL = () =>
  `Remove the Clean and lubricate the X and Y axes entry from ${formatDay('2026-09-10')}`

// The two outcomes are separate tests rather than one sequence, because a MUI
// dialog is aria-modal: while it is closing it still hides the page behind it
// from the accessibility tree, so re-querying the button in the same test waits
// on a transition rather than on anything the feature does.
test('removing a log entry asks before doing it', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  withOneEntry()
  draw()

  await screen.findByText('Ran quiet afterwards')
  await user.click(await screen.findByRole('button', { name: REMOVE_LABEL() }))

  await screen.findByRole('heading', { name: 'Remove this entry?' })
  await user.click(screen.getByRole('button', { name: 'Keep it' }))

  // Declining leaves the record exactly where it was.
  assert.deepEqual(deleted, [])
  assert.ok(screen.getByText('Ran quiet afterwards'))
})

test('confirming the removal sends the delete and drops the entry', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  withOneEntry()
  draw()

  await screen.findByText('Ran quiet afterwards')
  await user.click(await screen.findByRole('button', { name: REMOVE_LABEL() }))
  await screen.findByRole('heading', { name: 'Remove this entry?' })
  await user.click(screen.getByRole('button', { name: 'Remove' }))

  await waitFor(() => assert.deepEqual(deleted, [42]))
  await waitFor(() => assert.equal(screen.queryByText('Ran quiet afterwards'), null))
})
