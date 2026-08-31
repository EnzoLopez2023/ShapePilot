// @vitest-environment jsdom
//
// The project page through the real components, with the API stubbed at the
// fetch boundary so the whole client stack -- service, HTTP client, derived
// summary, components -- is under test.
//
// The properties worth pinning: the breakdown is arithmetic over the line
// items, coverage joins the trays against it, and a proposal from the
// assistant becomes editable rows rather than a write.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ProjectPage from '../../src/features/keycap-projects/ProjectPage.tsx'
import ProjectsPage from '../../src/features/keycap-projects/ProjectsPage.tsx'
import { ThemeModeProvider } from '../../src/theme/ThemeModeProvider.tsx'
import { ConfirmDialogProvider } from '../../src/components/ConfirmDialogProvider.tsx'

interface Item {
  id?: string
  legend?: string
  units: number
  heightUnits?: number
  count?: number
  group?: string
  source?: string
}

interface StubState {
  project: {
    id: string
    name: string
    setName?: string
    capProfile?: string
    items: Item[]
    photos: { hash: string; caption?: string; createdAt: string }[]
    coverage: { units: number; heightUnits: number; shape: string | null; pockets: number }[]
    createdAt: string
    updatedAt: string
  }
  trays: { id: string; name: string; pocketCount: number; updatedAt: string }[]
  projects: { id: string; name: string; capCount: number; trayCount: number; photoCount: number; updatedAt: string }[]
  aiAvailable: boolean
  proposal: unknown
  calls: { method: string; path: string; body?: unknown }[]
}

let state: StubState

const HASH = 'a'.repeat(64)

function installFetchStub() {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : String(input)
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    const method = (init.method ?? 'GET').toUpperCase()
    const body = init.body && typeof init.body === 'string'
      ? JSON.parse(init.body) as unknown
      : undefined
    state.calls.push({ method, path, body })

    const json = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status, headers: { 'content-type': 'application/json' },
      })

    if (path === '/api/ai/status') return json(200, { available: state.aiAvailable })
    if (path === '/api/ai/keycap-set') return json(200, state.proposal)
    if (path === '/api/keycap-projects' && method === 'GET') return json(200, state.projects)
    if (path === '/api/keycap-projects' && method === 'POST') return json(201, { id: '7' })
    if (path === '/api/keycap-projects/1' && method === 'GET') return json(200, state.project)
    if (path === '/api/keycap-projects/1' && method === 'PUT') return json(200, { ok: true })
    if (path.startsWith('/api/keycap-trays')) return json(200, state.trays)
    if (path.startsWith('/api/design-assets')) {
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    }
    if (path === '/api/audit/events') return json(202, { ok: true })
    return json(404, { error: { code: 'not_found', message: 'no stub' } })
  })
}

const renderProject = () => render(
  <ThemeModeProvider initialPreference="light">
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={['/projects/1']}>
        <Routes>
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectPage />} />
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      </MemoryRouter>
    </ConfirmDialogProvider>
  </ThemeModeProvider>,
)

const renderList = () => render(
  <ThemeModeProvider initialPreference="light">
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={['/projects']}>
        <Routes>
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      </MemoryRouter>
    </ConfirmDialogProvider>
  </ThemeModeProvider>,
)

beforeEach(() => {
  state = {
    project: {
      id: '1',
      name: 'GMK Olivia',
      setName: 'Olivia',
      capProfile: 'Cherry',
      items: [
        { id: '1', legend: 'Esc', units: 1, count: 1, group: 'Modifiers', source: 'manual' },
        { id: '2', units: 1, count: 34, group: 'Alphas', source: 'manual' },
        { id: '3', legend: 'Space', units: 6.25, count: 1, group: 'Modifiers', source: 'manual' },
      ],
      photos: [],
      coverage: [{ units: 1, heightUnits: 1, shape: null, pockets: 28 }],
      createdAt: '2026-08-20 09:00:00',
      updatedAt: '2026-08-28 12:00:00',
    },
    trays: [{ id: '4', name: 'Tray one', pocketCount: 29, updatedAt: '2026-08-28 12:00:00' }],
    projects: [{
      id: '1', name: 'GMK Olivia', capCount: 36, trayCount: 1, photoCount: 2,
      updatedAt: '2026-08-28 12:00:00',
    }],
    aiAvailable: true,
    proposal: null,
    calls: [],
  }
  installFetchStub()
  vi.stubGlobal('URL', Object.assign(globalThis.URL, {
    createObjectURL: () => 'blob:stub',
    revokeObjectURL: () => {},
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the list shows what each project holds', async () => {
  renderList()
  await waitFor(() => expect(screen.getByText('GMK Olivia')).toBeTruthy())
  assert.match(screen.getByText(/36 caps/).textContent ?? '', /36 caps · 1 tray · 2 photos/)
})

test('the breakdown reads the set by size, with the trays joined in', async () => {
  renderProject()
  await waitFor(() => expect(screen.getByRole('heading', { name: 'GMK Olivia' })).toBeTruthy())

  // 35 1u caps (Esc is 1u, so it shares a trough like any other) and a spacebar.
  const summary = screen.getByText(/caps · .* placed/)
  assert.match(summary.textContent ?? '', /36 caps · 28 placed · 8 to go/)

  // Scoped to the breakdown: the size dropdowns in the editor below say '1u' too.
  const breakdown = within(screen.getByRole('list', { name: 'Breakdown by size' }))
  assert.ok(breakdown.getByText('1u'))
  assert.ok(breakdown.getByText('6.25u'))
  assert.ok(breakdown.getByText('7 still to place'))
})

test('a long pocket counts as the caps it holds, not as one cap', async () => {
  // The whole reason coverage is an allocation and not a size-for-size join: a
  // row of 1u caps merged into one 10u trough is still ten caps with a home.
  state.project.coverage = [{ units: 10, heightUnits: 1, shape: null, pockets: 3 }]
  renderProject()
  await waitFor(() => expect(screen.getByRole('heading', { name: 'GMK Olivia' })).toBeTruthy())

  // Three 10u troughs hold 30 of the 35 1u caps.
  assert.match(screen.getByText(/caps · .* placed/).textContent ?? '', /36 caps · 30 placed/)
  const breakdown = within(screen.getByRole('list', { name: 'Breakdown by size' }))
  assert.ok(breakdown.getByText('5 still to place'))
  // The spacebar is not one of them: it needs a pocket of its own size.
  assert.ok(breakdown.getByText('6.25u'))
  assert.ok(breakdown.getByText('1 still to place'))
})

test('the trays in the project are listed and open by URL', async () => {
  renderProject()
  await waitFor(() => expect(screen.getByText('Tray one')).toBeTruthy())
  assert.match(screen.getByText(/29 pockets/).textContent ?? '', /29 pockets · updated/)
  // The tray list is fetched scoped to this project, not filtered client-side.
  assert.ok(state.calls.some(c => c.path === '/api/keycap-trays?projectId=1'))
})

test('editing a row marks the project unsaved and sends the whole list', async () => {
  const user = userEvent.setup()
  renderProject()
  await waitFor(() => expect(screen.getByRole('heading', { name: 'GMK Olivia' })).toBeTruthy())

  const saveBefore = screen.getByRole('button', { name: 'Saved' })
  assert.equal((saveBefore as HTMLButtonElement).disabled, true)

  // Rows are grouped for reading, so position is not identity: find the row by
  // the quantity it currently shows. Cleared first, which the field allows.
  const quantity = screen.getByDisplayValue('34')
  await user.clear(quantity)
  await user.type(quantity, '40')

  const save = await screen.findByRole('button', { name: 'Save changes' })
  await user.click(save)

  await waitFor(() => expect(
    state.calls.some(c => c.method === 'PUT' && c.path === '/api/keycap-projects/1')).toBe(true))
  const put = state.calls.find(c => c.method === 'PUT')!
  const sent = put.body as { items: Item[] }
  assert.equal(sent.items.length, 3)
  assert.equal(sent.items[1].count, 40)
  // The edited row is the person's now, whatever it was before.
  assert.equal(sent.items[1].source, 'manual')
})

test('a row can be added and removed', async () => {
  const user = userEvent.setup()
  renderProject()
  await waitFor(() => expect(screen.getByRole('heading', { name: 'GMK Olivia' })).toBeTruthy())

  await user.click(screen.getByRole('button', { name: 'Add a row' }))
  await waitFor(() => expect(screen.getAllByLabelText('Qty')).toHaveLength(4))

  await user.click(screen.getByRole('button', { name: 'Remove Esc' }))
  await waitFor(() => expect(screen.getAllByLabelText('Qty')).toHaveLength(3))
})

test('a proposal from the assistant is reviewed, then becomes editable rows', async () => {
  const user = userEvent.setup()
  state.project.photos = [{ hash: HASH, caption: 'the set', createdAt: '2026-08-28 12:00:00' }]
  state.proposal = {
    set: {
      setName: 'Olivia', capProfile: 'Cherry',
      items: [
        { legend: 'F1', units: 1, count: 1, group: 'Function keys', source: 'photo' },
        { legend: 'Enter', units: 2.25, count: 1, group: 'Modifiers', source: 'photo' },
      ],
    },
    notes: 'The bottom row was partly out of frame.',
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
  }

  renderProject()
  await waitFor(() => expect(screen.getByRole('button', { name: /Read the photos/ })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: /Read the photos/ }))

  const dialog = await screen.findByRole('dialog')
  // The model's own account of what it could not read is shown, not hidden.
  assert.ok(within(dialog).getByText(/partly out of frame/))
  assert.ok(within(dialog).getByText(/2 caps in 2 rows/))

  // Nothing is written by reading: the only calls so far are reads.
  assert.ok(!state.calls.some(c => c.method === 'PUT'))

  await user.click(within(dialog).getByRole('button', { name: /Add to the 3 existing/ }))

  await waitFor(() => expect(screen.getAllByLabelText('Qty')).toHaveLength(5))
  assert.ok(screen.getByDisplayValue('Enter'))
  // Still unsaved: the person gets to correct the rows first. Awaited because
  // the dialog's own aria-hidden is lifted as it closes.
  assert.ok(await screen.findByRole('button', { name: 'Save changes' }))
})

test('a proposal can replace the list instead of adding to it', async () => {
  const user = userEvent.setup()
  state.project.photos = [{ hash: HASH, createdAt: '2026-08-28 12:00:00' }]
  state.proposal = {
    set: { items: [{ legend: 'F1', units: 1, count: 1, source: 'photo' }] },
    notes: '',
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
  }

  renderProject()
  await waitFor(() => expect(screen.getByRole('button', { name: /Read the photos/ })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: /Read the photos/ }))

  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: 'Replace the list' }))
  await waitFor(() => expect(screen.getAllByLabelText('Qty')).toHaveLength(1))
})

test('reading is offered only when the assistant is configured', async () => {
  state.project.photos = [{ hash: HASH, createdAt: '2026-08-28 12:00:00' }]
  state.aiAvailable = false
  renderProject()
  await waitFor(() => expect(screen.getByRole('button', { name: /Read the photos/ })).toBeTruthy())
  const button = screen.getByRole('button', { name: /Read the photos/ }) as HTMLButtonElement
  assert.equal(button.disabled, true)
  // The set can still be typed in by hand.
  assert.ok(screen.getByRole('button', { name: 'Add a row' }))
})

test('deleting a project says what happens to its trays', async () => {
  const user = userEvent.setup()
  renderProject()
  await waitFor(() => expect(screen.getByRole('heading', { name: 'GMK Olivia' })).toBeTruthy())

  await user.click(screen.getByRole('button', { name: 'Delete' }))
  const dialog = await screen.findByRole('dialog')
  assert.match(within(dialog).getByText(/tray stays/).textContent ?? '', /1 tray stays/)
})
