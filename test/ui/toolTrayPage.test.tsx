// @vitest-environment jsdom
//
// The tool tray designer, exercised through the real components with the API
// stubbed at the fetch boundary. What is pinned here is what this designer
// exists to do, and what the other two cannot: drop a part in, get a pocket
// with several depths, and be told when one of them reaches somewhere it must
// not.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ToolTrayPage from '../../src/features/tool-tray/ToolTrayPage.tsx'
import { ThemeModeProvider } from '../../src/theme/ThemeModeProvider.tsx'
import { ConfirmDialogProvider } from '../../src/components/ConfirmDialogProvider.tsx'

interface StubState {
  designs: { id: string; name: string; profileKind: string; pocketCount: number; updatedAt: string }[]
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
    if (path === '/api/tool-trays' && method === 'GET') return json(200, state.designs)
    if (path === '/api/tool-trays' && method === 'POST') {
      const created = body as { name: string; pockets: unknown[] }
      state.designs = [...state.designs, {
        id: '1', name: created.name, profileKind: 'preset',
        pocketCount: created.pockets.length, updatedAt: '2026-09-09 12:00:00',
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
      <MemoryRouter initialEntries={['/tool-tray']}>
        <Routes>
          <Route path="/tool-tray" element={<ToolTrayPage />} />
          <Route path="/tool-tray/:designId" element={<ToolTrayPage />} />
          <Route path="*" element={<ToolTrayPage />} />
        </Routes>
      </MemoryRouter>
    </ConfirmDialogProvider>
  </ThemeModeProvider>,
)

/** The readout under the canvas: "N pockets · M floor levels · … triangles". */
const readout = (): string => screen.getByText(/pockets ·/).textContent ?? ''
const pocketCount = (): number => Number.parseInt(readout(), 10)
const levelCount = (): number =>
  Number.parseInt(/·\s*(\d+) floor levels/.exec(readout())?.[1] ?? '0', 10)

const drop = async (user: ReturnType<typeof userEvent.setup>, label: string) => {
  const palette = screen.getByRole('heading', { name: 'Parts' }).closest('div')
  assert.ok(palette)
  await user.click(within(palette as HTMLElement).getByRole('button', { name: new RegExp(label) }))
}

test('a fresh tray is empty, and the outline is already the real one', async () => {
  renderPage()
  await waitFor(() => expect(screen.getByText(/pockets ·/)).toBeTruthy())
  assert.equal(pocketCount(), 0)
  // Two levels even when empty: the underside and the rim.
  assert.equal(levelCount(), 2)
  assert.ok(screen.getByText(/249\.0 × 165\.5 mm/))
})

test('dropping a hotend in gives one pocket with three depths', async () => {
  // The thing neither other designer can do: one pocket, several floors.
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByText(/pockets ·/)).toBeTruthy())

  await drop(user, 'Hotend')
  await waitFor(() => expect(pocketCount()).toBe(1))

  // 0 and the rim, plus one level per distinct step depth (11, 4, 7).
  assert.equal(levelCount(), 5)
  assert.ok(screen.getByText(/3 tiers, deepest 11/))
})

test('dropping several parts lays them out rather than stacking them', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByText(/pockets ·/)).toBeTruthy())

  await drop(user, 'Hotend')
  await drop(user, 'Hotend')
  await drop(user, 'Hotend')
  await waitFor(() => expect(pocketCount()).toBe(3))

  // Three pockets and no overlap complaint: the page found each one a free spot.
  assert.equal(screen.queryByText(/overlap/), null)
})

test('several parts dropped at once do not land on top of each other', async () => {
  // The placement is chosen inside the state mutator, not at click time. It was
  // the other way round first, and every part in one React batch then saw the
  // same pocket list and picked the same spot -- twelve pockets, all
  // overlapping. Firing the clicks with no await between them is exactly that
  // case.
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByText(/pockets ·/)).toBeTruthy())

  const palette = screen.getByRole('heading', { name: 'Parts' }).closest('div') as HTMLElement
  const hotend = within(palette).getByRole('button', { name: /Hotend/ })
  await user.click(hotend)
  await user.click(hotend)
  await user.click(hotend)
  await user.click(hotend)
  await user.click(hotend)
  await waitFor(() => expect(pocketCount()).toBe(5))

  assert.equal(screen.queryByText(/overlap/), null)
  // ...and nothing was pushed off the tray or into a recess either.
  assert.equal(screen.queryByText(/off the edge/), null)
  assert.equal(screen.queryByText(/lift recess/), null)
})

test('auto-placement keeps deep parts out of the lift recesses', async () => {
  // The app must not place a pocket and then complain about its own placement.
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByText(/pockets ·/)).toBeTruthy())
  const palette = screen.getByRole('heading', { name: 'Parts' }).closest('div') as HTMLElement
  for (const label of ['Hotend', 'Lubricant tube', 'Allen keys and rods',
    'Screws and small parts', 'Silicone socks', 'Nozzle wiper', 'Long bay']) {
    await user.click(within(palette).getByRole('button', { name: new RegExp(label) }))
  }
  await waitFor(() => expect(pocketCount()).toBe(7))
  assert.equal(screen.queryByText(/lift recess/), null)
  assert.equal(screen.queryByText(/off the edge/), null)
  assert.equal(screen.queryByText(/overlap/), null)
})

test('a pocket over a lift recess is reported, because that opens a hole', async () => {
  // The defect this designer was built to stop shipping. The long bay is 19 mm
  // deep, so dragged to the left edge it reaches into the underside recess.
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByText(/pockets ·/)).toBeTruthy())

  await drop(user, 'Long bay')
  await waitFor(() => expect(pocketCount()).toBe(1))

  // Move it onto a recess by typing the position rather than dragging, since
  // jsdom has no pointer capture.
  const x = screen.getByLabelText('X')
  await user.clear(x)
  await user.type(x, '6{Enter}')
  const y = screen.getByLabelText('Y')
  await user.clear(y)
  await user.type(y, '40{Enter}')

  await waitFor(() => expect(screen.getByText(/hex-key lift recess/)).toBeTruthy())
})

test('the stack budget is reported against the measured base cavity', async () => {
  renderPage()
  await waitFor(() => expect(screen.getByText(/pockets ·/)).toBeTruthy())
  // 21 mm trays in a 48 mm cavity.
  assert.ok(screen.getByText(/2 of these stack in the 48 mm base cavity/))
})

test('the tray height is the one number the pocket depths hang off', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByText(/pockets ·/)).toBeTruthy())
  await drop(user, 'Screws and small parts')
  await waitFor(() => expect(pocketCount()).toBe(1))

  // A 19 mm pocket in a 21 mm tray is fine. Take the tray down to 19 and the
  // floor check has something to say -- there is no separate floor field to
  // keep in step, which is the whole point of the model.
  const height = screen.getByLabelText('Tray height')
  await user.clear(height)
  await user.type(height, '19{Enter}')
  await waitFor(() => expect(screen.getByText(/leaves 0\.00 mm of floor/)).toBeTruthy())
})

test('saving sends exactly the fields the server accepts', async () => {
  // The cheapest guard against client/server drift: the payload's key set has
  // to match the validator's DESIGN_KEYS, which the parity test reads from the
  // same source file.
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByText(/pockets ·/)).toBeTruthy())
  await drop(user, 'Hotend')
  await user.click(screen.getByRole('button', { name: /^Save$/ }))

  await waitFor(() => expect(
    state.calls.some(c => c.method === 'POST' && c.path === '/api/tool-trays')).toBe(true))
  const post = state.calls.find(c => c.method === 'POST' && c.path === '/api/tool-trays')
  assert.ok(post)
  assert.deepEqual(Object.keys(post.body as object).sort(), [
    'caseClearHeightMm', 'feet', 'heightMm', 'layerHeightMm', 'minFloorMm',
    'name', 'notes', 'pockets', 'profile', 'undersideReliefs',
  ])
})

test('a dropped preset carries its provenance but is stored whole', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByText(/pockets ·/)).toBeTruthy())
  await drop(user, 'Lubricant tube')
  await user.click(screen.getByRole('button', { name: /^Save$/ }))

  await waitFor(() => expect(
    state.calls.some(c => c.method === 'POST')).toBe(true))
  const post = state.calls.find(c => c.method === 'POST')
  const pockets = (post!.body as { pockets: { presetId?: string; steps: unknown[] }[] }).pockets
  assert.equal(pockets.length, 1)
  // The id rides along for provenance, and the steps travel with it -- so the
  // tray still prints the same if the catalogue later changes.
  assert.equal(pockets[0]!.presetId, 'bambu-lube-tube')
  assert.equal(pockets[0]!.steps.length, 1)
})
