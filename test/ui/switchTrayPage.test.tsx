// @vitest-environment jsdom
//
// The switch tray designer, exercised through the real components with the API
// stubbed at the fetch boundary. What is pinned here is the thing the designer
// exists to do: change a setting, and the number of switches that fit changes
// with it -- plus that a click really takes a cell out of the generated grid.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SwitchTrayPage from '../../src/features/switch-tray/SwitchTrayPage.tsx'
import { ThemeModeProvider } from '../../src/theme/ThemeModeProvider.tsx'
import { ConfirmDialogProvider } from '../../src/components/ConfirmDialogProvider.tsx'

interface StubState {
  designs: { id: string; name: string; profileKind: string; switchLabel: string; updatedAt: string }[]
  calls: { method: string; path: string; body?: unknown }[]
}

let state: StubState

beforeEach(() => {
  state = { designs: [], calls: [] }
  localStorage.clear()
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, '')
    const method = (init.method ?? 'GET').toUpperCase()
    const body = init.body ? JSON.parse(String(init.body)) as unknown : undefined
    state.calls.push({ method, path, body })
    const json = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status, headers: { 'content-type': 'application/json' },
      })
    if (path === '/api/switch-trays' && method === 'GET') return json(200, state.designs)
    if (path === '/api/switch-trays' && method === 'POST') {
      const created = body as { name: string }
      state.designs = [...state.designs, {
        id: '1', name: created.name, profileKind: 'preset',
        switchLabel: 'Cherry MX', updatedAt: '2026-09-01 12:00:00',
      }]
      return json(201, { id: '1' })
    }
    return json(202, { ok: true })
  })
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const renderPage = () => render(
  <ThemeModeProvider initialPreference="light">
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={['/switch-tray']}>
        <Routes>
          <Route path="/switch-tray" element={<SwitchTrayPage />} />
          <Route path="/switch-tray/:designId" element={<SwitchTrayPage />} />
          <Route path="*" element={<SwitchTrayPage />} />
        </Routes>
      </MemoryRouter>
    </ConfirmDialogProvider>
  </ThemeModeProvider>,
)

/** The headline count, as the panel words it. */
const capacity = (): number => {
  const text = screen.getByText(/\d+ switches$/).textContent ?? ''
  return Number.parseInt(text, 10)
}

test('a fresh tray is already full of switches — nothing is placed by hand', async () => {
  renderPage()
  await waitFor(() => expect(capacity()).toBeGreaterThan(80))
  // The plain Systainer preset, an MX drop-in shelf, four posts taking a cell
  // each: the exact number is the fill planner's business, but it is a plate
  // full of switches without a single click.
  assert.ok(screen.getByRole('application', { name: /Switch tray layout/ }))
})

test('opening the pitch up costs switches, and the count says so', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(capacity()).toBeGreaterThan(80))
  const before = capacity()

  const slider = screen.getByRole('slider', { name: /Pitch across/ })
  slider.focus()
  // Each press is one 0.05 mm step; enough of them to lose a column.
  for (let i = 0; i < 40; i++) await user.keyboard('{ArrowRight}')

  await waitFor(() => expect(capacity()).toBeLessThan(before))
})

test('clicking a cell leaves it out, and it can be put back', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(capacity()).toBeGreaterThan(80))
  const before = capacity()

  const canvas = screen.getByRole('application', { name: /Switch tray layout/ })
  const cells = canvas.querySelectorAll('rect[style*="cursor: pointer"]')
  assert.ok(cells.length > 0, 'no clickable cells were rendered')
  await user.click(cells[0])

  await waitFor(() => expect(capacity()).toBe(before - 1))
  assert.ok(screen.getByRole('button', { name: /Put all 1 back/ }))

  await user.click(screen.getByRole('button', { name: /Put all 1 back/ }))
  await waitFor(() => expect(capacity()).toBe(before))
})

test('switching to Choc changes the switch, the plate and the stacking pitch', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(capacity()).toBeGreaterThan(80))
  assert.ok(screen.getByText(/20\.4 mm per tier/))

  await user.click(screen.getByRole('combobox', { name: 'Switch' }))
  await user.click(await screen.findByRole('option', { name: 'Kailh Choc v1' }))

  // Half the switch, so two more trays fit the same case.
  await waitFor(() => expect(screen.getByText(/15\.0 mm per tier/)).toBeTruthy())
  assert.ok(screen.getByText(/4 trays fit/))
})

test('the bottom of the stack is a build you can switch to and export', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(capacity()).toBeGreaterThan(80))

  // The stacked build is the default, and its posts clear a whole switch.
  const height = () => (screen.getByLabelText(/^Post height/) as HTMLInputElement).value
  assert.match(screen.getByRole('combobox', { name: 'Building' }).textContent ?? '',
    /stands on another/)
  assert.equal(height(), '16.8')

  await user.click(screen.getByRole('combobox', { name: 'Building' }))
  await user.click(await screen.findByRole('option', { name: /bottom of the stack/i }))

  // Switching really changes the tray, not just a readout.
  await waitFor(() => expect(height()).toBe('7.2'))
  assert.ok(screen.getByLabelText('Post height (bottom)'))
})

test('the stack figure says which builds it is counting', async () => {
  renderPage()
  await waitFor(() => expect(capacity()).toBeGreaterThan(80))
  // The count is only reachable by building two different trays, so it says so
  // rather than promising a number the export cannot produce.
  assert.ok(screen.getByText(/one bottom tray \(7\.2 mm posts\)/))
  assert.ok(screen.getByText(/export each build once/))
})

test('a clip-in plate packs tighter than a drop-in shelf', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(capacity()).toBeGreaterThan(80))
  const shelf = capacity()

  await user.click(screen.getByRole('combobox', { name: 'Retention' }))
  await user.click(await screen.findByRole('option', { name: 'Clip-in plate' }))

  // The plate only has to cut the 14 mm body, not clear the 15.6 mm housing.
  await waitFor(() => expect(capacity()).toBeGreaterThan(shelf))
})

test('saving posts every parameter and nothing that is generated', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(capacity()).toBeGreaterThan(80))

  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(
    state.calls.some(c => c.method === 'POST' && c.path === '/api/switch-trays')).toBe(true))

  const posted = state.calls.find(
    c => c.method === 'POST' && c.path === '/api/switch-trays')?.body as Record<string, unknown>
  // `notes` is absent on a fresh tray, so JSON drops it; everything the
  // geometry needs is here.
  assert.deepEqual(Object.keys(posted).sort(), [
    'caseClearHeightMm', 'feet', 'fill', 'name', 'nameplate', 'plate', 'profile',
    'skippedCells', 'switch',
  ])
  // The cells are generated, so they are never sent.
  assert.equal('cells' in posted, false)
})

test('the Open dialog lists saved trays by their switch', async () => {
  const user = userEvent.setup()
  state.designs = [{
    id: '3', name: 'MX spares', profileKind: 'preset',
    switchLabel: 'Cherry MX', updatedAt: '2026-09-01 12:00:00',
  }]
  renderPage()
  await waitFor(() => expect(capacity()).toBeGreaterThan(80))

  await user.click(screen.getByRole('button', { name: 'Open' }))
  const dialog = await screen.findByRole('dialog')
  assert.ok(within(dialog).getByText('MX spares'))
  assert.ok(within(dialog).getByText(/Cherry MX/))
})
