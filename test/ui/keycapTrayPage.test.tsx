// @vitest-environment jsdom
//
// State and interaction parity for the designer, exercised through the real
// components. The API is stubbed at the fetch boundary so the whole client
// stack — service, HTTP client, state hook, components — is under test.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import KeycapTrayPage from '../../src/features/keycap-tray/KeycapTrayPage.tsx'
import { useTrayDesign, pocketExtent, pocketAABB } from '../../src/features/keycap-tray/state/useTrayDesign.ts'
import { PYTHON_SIZING } from '../../src/features/keycap-tray/geometry/shapes.ts'
import { ThemeModeProvider } from '../../src/theme/ThemeModeProvider.tsx'
import { ConfirmDialogProvider } from '../../src/components/ConfirmDialogProvider.tsx'
import type { ReactElement } from 'react'

interface StubState {
  designs: {
    id: string; name: string; pocketCount: number; updatedAt: string; profileKind: string
    projectId?: string | null; projectName?: string | null
  }[]
  project?: {
    id: string
    items: { units: number; heightUnits?: number; count?: number; legend?: string }[]
    coverage: { units: number; heightUnits: number; shape: string | null; pockets: number }[]
  }
  library: { id: string; name: string; units: number }[]
  calls: { method: string; path: string; body?: unknown }[]
  failListWith?: number
  createGate?: Promise<void>
  loadGate?: Promise<void>
}

let state: StubState

function installFetchStub() {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : String(input)
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    const method = (init.method ?? 'GET').toUpperCase()
    const body = init.body ? JSON.parse(String(init.body)) as unknown : undefined
    state.calls.push({ method, path, body })

    const json = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status, headers: { 'content-type': 'application/json' },
      })

    if (path.startsWith('/api/keycap-projects/') && method === 'GET') {
      if (!state.project) return json(404, { error: { code: 'not_found', message: 'no project' } })
      return json(200, { ...state.project, name: 'Womier', photos: [] })
    }
    if (path === '/api/keycap-trays' && method === 'GET') {
      if (state.failListWith) {
        return json(state.failListWith, {
          error: { code: 'unavailable', message: 'The list could not be loaded.' },
        })
      }
      return json(200, state.designs)
    }
    if (path === '/api/keycap-trays' && method === 'POST') {
      await state.createGate
      const id = String(state.designs.length + 1)
      const created = body as { name: string; pockets?: unknown[] }
      state.designs = [...state.designs, {
        id, name: created.name, pocketCount: created.pockets?.length ?? 0,
        updatedAt: '2026-08-28 12:00:00', profileKind: 'preset',
      }]
      return json(201, { id })
    }
    if (/^\/api\/keycap-trays\/\d+$/.test(path) && method === 'PUT') return json(200, { ok: true })
    if (/^\/api\/keycap-trays\/\d+$/.test(path) && method === 'DELETE') {
      const id = path.split('/').pop()
      state.designs = state.designs.filter(d => d.id !== id)
      return json(200, { ok: true })
    }
    if (/^\/api\/keycap-trays\/\d+$/.test(path) && method === 'GET') {
      await state.loadGate
      const id = path.split('/').pop() as string
      return json(200, {
        id, name: state.designs.find(d => d.id === id)?.name ?? 'Loaded',
        profile: { kind: 'preset', id: 'systainer-s76-plain' },
        sizing: { ...PYTHON_SIZING },
        floorThicknessMm: 2.4, pocketDepthMm: 10, engraveDepthMm: 0.4,
        pockets: [{
          id: 'p1', units: 1, heightUnits: 1, x: 10, y: 10, rotationDeg: 0,
          isThrough: false, label: 'loaded pocket', labelMode: 'guide',
        }],
        createdAt: '2026-08-28 11:00:00', updatedAt: '2026-08-28 12:00:00', revision: 0,
      })
    }
    if (path.endsWith('/clone') && method === 'POST') {
      state.designs = [...state.designs, {
        id: '99', name: 'Copy', pocketCount: 1, updatedAt: '2026-08-28 12:05:00',
        profileKind: 'preset',
      }]
      return json(201, { id: '99' })
    }
    if (path === '/api/keycap-trays/library/pockets' && method === 'GET') {
      return json(200, state.library)
    }
    if (path === '/api/keycap-trays/library/pockets' && method === 'POST') {
      const created = body as { name: string; units?: number }
      // The real route has UNIQUE(owner, name) and answers 409.
      if (state.library.some(p => p.name === created.name)) {
        return json(409, {
          error: {
            code: 'conflict',
            message: `a pocket named "${created.name}" already exists`,
          },
        })
      }
      const id = String(state.library.length + 1)
      state.library = [...state.library, { id, name: created.name, units: created.units ?? 1 }]
      return json(201, { id })
    }
    if (path.startsWith('/api/keycap-trays/library/pockets/') && method === 'DELETE') {
      const id = path.split('/').pop()
      state.library = state.library.filter(p => p.id !== id)
      return json(200, { ok: true })
    }
    if (path === '/api/audit/events') return json(202, { ok: true })
    return json(404, { error: { code: 'not_found', message: 'no stub' } })
  })
}

/** The designer reads the open tray's id out of the URL, so it needs a router
 *  even when the test is only about the canvas. */
const renderPage = (ui: ReactElement = <KeycapTrayPage />, route = '/keycap-tray') => render(
  <ThemeModeProvider initialPreference="light">
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/keycap-tray" element={ui} />
          <Route path="/keycap-tray/:designId" element={ui} />
          <Route path="*" element={ui} />
        </Routes>
      </MemoryRouter>
    </ConfirmDialogProvider>
  </ThemeModeProvider>,
)

beforeEach(() => {
  state = {
    designs: [],
    library: [{ id: '1', name: '14mm square', units: 0.5 }],
    calls: [],
  }
  installFetchStub()
  // Per-tray view settings live here, so a test that opens a tray must not
  // inherit how a previous test left it.
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  window.URL.createObjectURL = vi.fn(() => 'blob:stub')
  window.URL.revokeObjectURL = vi.fn()
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('tray design state', () => {
  test('undo/redo is bounded at 50 steps and restores the previous design', () => {
    const { result } = renderHook(() => useTrayDesign())
    assert.equal(result.current.canUndo, false)

    act(() => { result.current.addPocket(1, 0, 0) })
    assert.equal(result.current.design.pockets.length, 1)
    assert.equal(result.current.canUndo, true)

    act(() => { result.current.undo() })
    assert.equal(result.current.design.pockets.length, 0)
    act(() => { result.current.redo() })
    assert.equal(result.current.design.pockets.length, 1)

    // 60 further edits, then 60 undos: only the last 50 are recoverable.
    for (let i = 0; i < 60; i += 1) act(() => { result.current.addPocket(1, i, 0) })
    assert.equal(result.current.design.pockets.length, 61)
    for (let i = 0; i < 60; i += 1) act(() => { result.current.undo() })
    assert.equal(result.current.design.pockets.length, 11)
    assert.equal(result.current.canUndo, false)
  })

  test('a drag commits one history entry, not one per frame', () => {
    const { result } = renderHook(() => useTrayDesign())
    let id = ''
    act(() => { id = result.current.addPocket(1, 0, 0) })
    act(() => { result.current.movePockets([id], 5, 5) })
    const moved = result.current.design.pockets[0]
    assert.deepEqual([moved.x, moved.y], [5, 5])

    act(() => { result.current.undo() })
    const back = result.current.design.pockets[0]
    assert.deepEqual([back.x, back.y], [0, 0], 'one undo must reverse the whole move')
  })

  test('the revision counter advances on every mutation and resets on load', () => {
    const { result } = renderHook(() => useTrayDesign())
    const start = result.current.design.revision
    act(() => { result.current.addPocket(1, 0, 0) })
    assert.equal(result.current.design.revision, start + 1)
    act(() => { result.current.setDesign({ ...result.current.design, revision: 7 }) })
    assert.equal(result.current.design.revision, 0)
    assert.equal(result.current.canUndo, false, 'loading clears history')
  })

  test('selection is replaced, extended and cleared', () => {
    const { result } = renderHook(() => useTrayDesign())
    let a = '', b = ''
    act(() => { a = result.current.addPocket(1, 0, 0) })
    act(() => { b = result.current.addPocket(1, 30, 0) })

    act(() => { result.current.toggleSelection(a, false) })
    assert.deepEqual([...result.current.selection], [a])

    act(() => { result.current.toggleSelection(b, true) })
    assert.equal(result.current.selection.size, 2)

    act(() => { result.current.toggleSelection(b, true) })
    assert.deepEqual([...result.current.selection], [a])

    act(() => { result.current.removePockets([a]) })
    assert.equal(result.current.selection.size, 0)
    assert.equal(result.current.design.pockets.length, 1)
  })

  test('pocketExtent is the un-rotated footprint (the rotation pivot box)', () => {
    const flat = pocketExtent({ id: 'a', units: 2, x: 0, y: 0 }, PYTHON_SIZING)
    const tilted = pocketExtent({ id: 'a', units: 2, x: 0, y: 0, rotationDeg: 90 }, PYTHON_SIZING)
    assert.deepEqual([tilted.w, tilted.h], [flat.w, flat.h])

    const explicit = pocketExtent(
      { id: 'a', units: 1, x: 0, y: 0, widthMm: 14, heightMm: 14 }, PYTHON_SIZING)
    assert.deepEqual([explicit.w, explicit.h], [14, 14])

    const iso = pocketExtent({ id: 'a', units: 1.5, x: 0, y: 0, shape: 'iso-enter' }, PYTHON_SIZING)
    assert.ok(Math.abs(iso.h - 2 * PYTHON_SIZING.height) < 1e-9)
  })

  test('pocketAABB gives the rotated bounds and a rotation-invariant centre', () => {
    const flat = pocketAABB({ id: 'a', units: 2, x: 0, y: 0 }, PYTHON_SIZING)
    const quarter = pocketAABB({ id: 'a', units: 2, x: 0, y: 0, rotationDeg: 90 }, PYTHON_SIZING)
    const diag = pocketAABB({ id: 'a', units: 2, x: 0, y: 0, rotationDeg: 45 }, PYTHON_SIZING)

    const w = (b: typeof flat) => b.maxX - b.minX
    const h = (b: typeof flat) => b.maxY - b.minY
    const mid = (b: typeof flat) => [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]

    // 90deg swaps the extent; 45deg grows it on both axes.
    assert.ok(Math.abs(w(flat) - h(quarter)) < 1e-6)
    assert.ok(Math.abs(h(flat) - w(quarter)) < 1e-6)
    assert.ok(w(diag) > w(flat) + 1e-6 && h(diag) > h(flat) + 1e-6)

    // The centre never moves -- rotation pivots on it.
    assert.deepEqual(mid(quarter).map(n => Math.round(n * 1e6)), mid(flat).map(n => Math.round(n * 1e6)))
    assert.deepEqual(mid(diag).map(n => Math.round(n * 1e6)), mid(flat).map(n => Math.round(n * 1e6)))
  })
})

describe('designer page', () => {
  test('it renders the workbench with an accessible canvas and panels', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    assert.ok(screen.getByRole('heading', { name: 'Pockets' }))
    assert.ok(screen.getByRole('heading', { name: 'Tray' }))
    assert.ok(screen.getByRole('group', { name: 'Fabrication target' }))
    assert.ok(screen.getByRole('group', { name: 'Canvas mode' }))
  })

  test('undo, redo and delete are disabled until there is something to act on', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    for (const name of ['Undo', 'Redo', 'Delete selected pockets']) {
      assert.equal(
        (screen.getByRole('button', { name }) as HTMLButtonElement).disabled, true, name)
    }
    assert.equal(
      (screen.getByRole('button', { name: 'Clone' }) as HTMLButtonElement).disabled, true)
  })

  test('adding a pocket from the palette updates the status line and enables undo', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    assert.ok(screen.getByText(/^0 pockets/))

    await user.click(await screen.findByRole('button', { name: 'Add a 1u pocket' }))
    await waitFor(() => expect(screen.getByText(/^1 pockets/)).toBeTruthy())
    assert.equal(
      (screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled, false)

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.getByText(/^0 pockets/)).toBeTruthy())
  })

  test('saving posts the design and then updates it, and cloning is enabled after save', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    await user.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(
      state.calls.some(c => c.method === 'POST' && c.path === '/api/keycap-trays')).toBe(true))
    await waitFor(() => expect(
      (screen.getByRole('button', { name: 'Clone' }) as HTMLButtonElement).disabled).toBe(false))

    await user.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(
      state.calls.some(c => c.method === 'PUT' && c.path.startsWith('/api/keycap-trays/'))).toBe(true))
  })

  test('document-switching actions stay disabled while a create is in flight', async () => {
    let releaseCreate: () => void = () => {}
    state.createGate = new Promise<void>((resolveCreate) => { releaseCreate = resolveCreate })
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    await user.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(
      state.calls.some(c => c.method === 'POST' && c.path === '/api/keycap-trays')).toBe(true))
    for (const name of ['New', 'Open', 'Clone']) {
      assert.equal((screen.getByRole('button', { name }) as HTMLButtonElement).disabled, true)
    }

    releaseCreate()
    await waitFor(() => expect(
      (screen.getByRole('button', { name: 'New' }) as HTMLButtonElement).disabled).toBe(false))
    assert.equal(
      (screen.getByRole('button', { name: 'Clone' }) as HTMLButtonElement).disabled,
      false,
    )
  })

  test('edits made during save remain explicitly unsaved', async () => {
    let releaseCreate: () => void = () => {}
    state.createGate = new Promise<void>((resolveCreate) => { releaseCreate = resolveCreate })
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    await user.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(
      state.calls.some(c => c.method === 'POST' && c.path === '/api/keycap-trays')).toBe(true))
    await user.click(await screen.findByRole('button', { name: 'Add a 1u pocket' }))
    releaseCreate()

    assert.ok(await screen.findByText('Saved earlier changes — newer edits are still unsaved'))
    assert.ok(screen.getByRole('button', { name: 'Save changes' }))
    assert.ok(screen.getByText(/^1 pockets/))
  })

  test('tabbing through rounded imperial values does not rewrite millimetres', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: 'in' }))
    const floor = screen.getByRole('textbox', { name: 'Floor' }) as HTMLInputElement
    assert.equal(floor.value, '3/32"')
    await user.click(floor)
    await user.tab()
    await user.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(
      state.calls.some(c => c.method === 'POST' && c.path === '/api/keycap-trays')).toBe(true))
    const create = state.calls.find(c => c.method === 'POST' && c.path === '/api/keycap-trays')
    assert.equal((create?.body as { floorThicknessMm?: number }).floorThicknessMm, 2.4)
  })

  test('the open dialog shows an empty state when nothing is saved', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    await user.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = await screen.findByRole('dialog')
    assert.ok(within(dialog).getByText('No saved trays yet'))
  })

  test('the open dialog lists a saved tray and loads it into the canvas', async () => {
    const user = userEvent.setup()
    state.designs = [{
      id: '1', name: 'Saved tray', pocketCount: 1, updatedAt: '2026-08-28 12:00:00',
      profileKind: 'preset',
    }]
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    await user.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = await screen.findByRole('dialog')
    assert.ok(await within(dialog).findByText('Saved tray'))
    await user.click(await within(dialog).findByRole('button', { name: 'Open' }))

    await waitFor(() => expect(screen.getByText(/^1 pockets/)).toBeTruthy())
  })

  test('saved-tray actions stay disabled while a load is in flight', async () => {
    let releaseLoad: () => void = () => {}
    state.loadGate = new Promise<void>((resolveLoad) => { releaseLoad = resolveLoad })
    state.designs = [
      {
        id: '1', name: 'First tray', pocketCount: 1, updatedAt: '2026-08-28 12:00:00',
        profileKind: 'preset',
      },
      {
        id: '2', name: 'Second tray', pocketCount: 1, updatedAt: '2026-08-28 12:00:00',
        profileKind: 'preset',
      },
    ]
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = await screen.findByRole('dialog')
    const openButtons = await within(dialog).findAllByRole('button', { name: 'Open' })
    await user.click(openButtons[0])
    await waitFor(() => expect(
      state.calls.some(call => call.path === '/api/keycap-trays/1')).toBe(true))
    for (const button of within(dialog).getAllByRole('button', { name: 'Open' })) {
      assert.equal((button as HTMLButtonElement).disabled, true)
    }
    assert.equal(
      (within(dialog).getByRole('button', { name: 'Delete Second tray' }) as HTMLButtonElement)
        .disabled,
      true,
    )
    releaseLoad()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    assert.equal(
      state.calls.some(call => call.path === '/api/keycap-trays/2'),
      false,
    )
  })

  test('deleting a saved tray asks for confirmation first', async () => {
    const user = userEvent.setup()
    state.designs = [{
      id: '1', name: 'Doomed tray', pocketCount: 0, updatedAt: '2026-08-28 12:00:00',
      profileKind: 'preset',
    }]
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    await user.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(await within(dialog).findByRole('button', { name: 'Delete Doomed tray' }))

    const confirm = await screen.findByRole('dialog', { name: 'Delete this tray?' })
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    assert.ok(!state.calls.some(c => c.method === 'DELETE'))

    await user.click(await within(dialog).findByRole('button', { name: 'Delete Doomed tray' }))
    const again = await screen.findByRole('dialog', { name: 'Delete this tray?' })
    await user.click(within(again).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(state.calls.some(c => c.method === 'DELETE')).toBe(true))
  })

  test('a failing list surfaces the server message instead of an empty screen', async () => {
    state.failListWith = 503
    renderPage()
    assert.ok(await screen.findByText('The list could not be loaded.'))
  })

  test('the unit toggle switches the length fields between mm and inches', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    const floor = screen.getByRole('textbox', { name: 'Floor' }) as HTMLInputElement
    assert.equal(floor.value, '2.4')

    await user.click(screen.getByRole('button', { name: 'in' }))
    await waitFor(() => expect(
      (screen.getByRole('textbox', { name: 'Floor' }) as HTMLInputElement).value).toBe('3/32"'))

    await user.click(screen.getByRole('button', { name: 'mm' }))
    await waitFor(() => expect(
      (screen.getByRole('textbox', { name: 'Floor' }) as HTMLInputElement).value).toBe('2.4'))
  })

  test('an invalid length is rejected and the field falls back to the old value', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    const depth = screen.getAllByRole('textbox', { name: 'Depth' })[0] as HTMLInputElement
    await user.clear(depth)
    await user.type(depth, 'not a number')
    await user.tab()
    await waitFor(() => expect(
      (screen.getAllByRole('textbox', { name: 'Depth' })[0] as HTMLInputElement).value).toBe('10'))
  })

  test('the export target switches between the printer and the CNC formats', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    assert.ok(screen.getByRole('button', { name: 'STL' }))
    assert.ok(screen.getByRole('button', { name: '3MF' }))
    assert.equal(screen.queryByRole('button', { name: 'SVG' }), null)

    await user.click(screen.getByRole('button', { name: 'Shaper Origin' }))
    assert.ok(await screen.findByRole('button', { name: 'SVG' }))
    assert.ok(screen.getByRole('button', { name: 'DXF' }))
    assert.equal(screen.queryByRole('button', { name: 'STL' }), null)
  })

  test('an export writes a file through the browser download path', async () => {
    const user = userEvent.setup()
    const clicks: string[] = []
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = realCreate(tag)
      if (tag === 'a') {
        vi.spyOn(element as HTMLAnchorElement, 'click').mockImplementation(() => {
          clicks.push((element as HTMLAnchorElement).download)
        })
      }
      return element
    })

    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: 'STL' }))

    assert.deepEqual(clicks, ['Untitled_tray.stl'])
    expect(window.URL.createObjectURL).toHaveBeenCalled()
    // Revoking synchronously cancels the download in Safari.
    expect(window.URL.revokeObjectURL).not.toHaveBeenCalled()
  })

  test('the pocket palette filters, pins and unpins', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    assert.ok(screen.getByRole('button', { name: 'Add a 6.25u pocket' }))
    await user.type(screen.getByRole('textbox', { name: 'Filter pockets' }), 'Spacebar')
    await waitFor(() => expect(
      screen.queryByRole('button', { name: 'Add a 1.5u pocket' })).toBe(null))
    assert.ok(screen.getByRole('button', { name: 'Add a 6.25u pocket' }))

    await user.clear(screen.getByRole('textbox', { name: 'Filter pockets' }))
    await user.click(await screen.findByRole('button', { name: 'Unpin 1u' }))
    await waitFor(() => expect(
      screen.queryByRole('button', { name: 'Add a 1u pocket' })).toBe(null))
  })

  test('the custom tab lists the seeded library pocket and can delete it', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    await user.click(screen.getByRole('tab', { name: 'Custom' }))
    assert.ok(await screen.findByRole('button', { name: 'Add a 14mm square pocket' }))

    await user.click(screen.getByRole('button', { name: 'Delete 14mm square' }))
    await waitFor(() => expect(
      state.calls.some(c => c.method === 'DELETE'
        && c.path.startsWith('/api/keycap-trays/library/pockets/'))).toBe(true))
  })

  test('the 14 mm seed is created once, only when the library is empty', async () => {
    state.library = []
    renderPage()
    await waitFor(() => expect(
      state.calls.some(c => c.method === 'POST'
        && c.path === '/api/keycap-trays/library/pockets')).toBe(true))
    const seeds = state.calls.filter(
      c => c.method === 'POST' && c.path === '/api/keycap-trays/library/pockets')
    assert.equal(seeds.length, 1, 'the seed is idempotent')
    assert.equal((seeds[0].body as { name: string }).name, '14mm square')
  })

  test('a custom pocket can be defined by exact dimensions', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    await user.click(screen.getByRole('tab', { name: 'Custom' }))
    await user.click(screen.getByRole('button', { name: 'Add custom pocket' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a custom pocket' })

    const add = within(dialog).getByRole('button', { name: 'Add' }) as HTMLButtonElement
    assert.equal(add.disabled, true, 'a nameless pocket cannot be added')

    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Artisan')
    await user.type(within(dialog).getByRole('spinbutton', { name: 'Width (mm)' }), '17')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(state.calls.some(
      c => c.method === 'POST' && c.path === '/api/keycap-trays/library/pockets'
        && (c.body as { name: string }).name === 'Artisan')).toBe(true))
  })

  test('the snap and grid controls are labelled', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    assert.ok(screen.getByRole('combobox', { name: 'Snap' }))
    assert.ok(screen.getByRole('combobox', { name: 'Grid' }))
  })

  test('snap offers 0.5 mm steps through 5 mm plus the key pitch', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    await user.click(screen.getByRole('combobox', { name: 'Snap' }))
    const labels = screen.getAllByRole('option').map(o => o.textContent)
    assert.deepEqual(labels, [
      'Off', '0.5 mm', '1 mm', '1.5 mm', '2 mm', '2.5 mm',
      '3 mm', '3.5 mm', '4 mm', '4.5 mm', '5 mm', '1u pitch',
    ])
  })

  test('the buffer distance dropdown is gated on Show buffer', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    const buffer = screen.getByRole('combobox', { name: 'Buffer' })
    assert.equal(buffer.getAttribute('aria-disabled'), 'true')

    await user.click(screen.getByRole('button', { name: 'Show buffer' }))
    await waitFor(() => expect(
      screen.getByRole('combobox', { name: 'Buffer' }).getAttribute('aria-disabled'),
    ).not.toBe('true'))

    await user.click(screen.getByRole('combobox', { name: 'Buffer' }))
    assert.ok(screen.getByRole('option', { name: '6 mm' }))
  })

  test('the plate, buffer and label toggles report their pressed state', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    const plate = screen.getByRole('button', { name: 'Show plate' })
    assert.equal(plate.getAttribute('aria-pressed'), 'false')
    await user.click(plate)
    await waitFor(() => expect(
      screen.getByRole('button', { name: 'Hide plate' }).getAttribute('aria-pressed')).toBe('true'))

    await user.click(screen.getByRole('button', { name: 'Show buffer' }))
    assert.ok(screen.getByRole('button', { name: 'Hide buffer' }))
    await user.click(screen.getByRole('button', { name: 'Hide labels' }))
    assert.ok(screen.getByRole('button', { name: 'Show labels' }))
  })

  test('the plate control is hidden for the Shaper Origin (CNC) target', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    assert.ok(screen.getByRole('button', { name: 'Show plate' }))

    await user.click(screen.getByRole('button', { name: 'Shaper Origin' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show plate' })).toBeNull())
    assert.equal(screen.queryByRole('button', { name: 'Hide plate' }), null)

    await user.click(screen.getByRole('button', { name: 'Bambu X2D' }))
    assert.ok(await screen.findByRole('button', { name: 'Show plate' }))
  })

  test('the selected pocket shows four rotate handles on the canvas', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())

    assert.equal(container.querySelectorAll('[aria-label="Rotate pocket"]').length, 0)

    // addPocket drops the pocket and selects it.
    await user.click(await screen.findByRole('button', { name: 'Add a 1u pocket' }))
    await waitFor(() =>
      assert.equal(container.querySelectorAll('[aria-label="Rotate pocket"]').length, 4))

    // A second pocket takes the selection; still exactly one pocket's worth.
    await user.click(screen.getByRole('button', { name: 'Add a 2u pocket' }))
    await waitFor(() =>
      assert.equal(container.querySelectorAll('[aria-label="Rotate pocket"]').length, 4))
  })

  test('the Angle field rotates the selected pocket and normalises the value', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    await user.click(await screen.findByRole('button', { name: 'Add a 1u pocket' }))

    const angle = screen.getByRole('textbox', { name: 'Angle in degrees' })
    await user.clear(angle)
    await user.type(angle, '400')
    await user.tab()
    await waitFor(() => assert.equal((angle as HTMLInputElement).value, '40'))

    await user.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => {
      const post = state.calls.find(c => c.method === 'POST' && c.path === '/api/keycap-trays')
      const pocket = (post?.body as { pockets: { rotationDeg: number }[] }).pockets[0]
      assert.equal(pocket.rotationDeg, 40)
    })
  })

  test('Mirror and Flip toggle the ISO Enter shape, not its position', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    await user.click(await screen.findByRole('button', { name: 'Add a ISO Enter pocket' }))

    await user.click(await screen.findByRole('switch', { name: 'Mirror' }))
    await user.click(screen.getByRole('switch', { name: 'Flip' }))

    await user.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => {
      const post = state.calls.find(c => c.method === 'POST' && c.path === '/api/keycap-trays')
      const pocket = (post?.body as {
        pockets: { mirrorX?: boolean; flipY?: boolean; x: number; y: number }[]
      }).pockets[0]
      assert.equal(pocket.mirrorX, true)
      assert.equal(pocket.flipY, true)
      assert.equal(pocket.x, 10) // position untouched -- addPocket dropped it at (10, 10)
      assert.equal(pocket.y, 10)
    })
  })

  test('Mirror and Flip are disabled for a rectangular pocket', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    await user.click(await screen.findByRole('button', { name: 'Add a 1u pocket' }))

    assert.equal((screen.getByRole('button', { name: 'Mirror' }) as HTMLButtonElement).disabled, true)
    assert.equal((screen.getByRole('button', { name: 'Flip' }) as HTMLButtonElement).disabled, true)
    assert.equal(screen.queryByRole('switch', { name: 'Mirror' }), null)
  })
})

test('the designer says what is left of the set, and a trough counts every cap in it', async () => {
  // A set is cut across several trays, so this is a question about the project:
  // the other trays come from the server and this one is read live, before
  // anything is saved.
  state.designs = [{
    id: '1', name: 'Top tray', pocketCount: 0, updatedAt: '2026-08-28 12:00:00',
    profileKind: 'preset', projectId: '9', projectName: 'Womier - Brown Grey',
  }]
  state.project = {
    id: '9',
    items: [
      { units: 1, count: 20, legend: 'alphas' },
      { units: 2.25, count: 1, legend: 'Enter' },
    ],
    // Another tray in the project already holds five 1u caps.
    coverage: [{ units: 1, heightUnits: 1, shape: null, pockets: 5 }],
  }

  const user = userEvent.setup()
  renderPage(<KeycapTrayPage />, '/keycap-tray/1')
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Set coverage' })).toBeTruthy())

  // Five 1u pockets on the other tray, plus the one this tray already carries.
  await waitFor(() => expect(screen.getByText(/6 of 21 placed/)).toBeTruthy())
  assert.ok(screen.getByText(/14 more 1u caps need room/))
  // The Enter has no home anywhere yet.
  assert.ok(screen.getByText('2.25u × 1'))

  // Drop one 10u pocket on this tray: ten more 1u caps have a home, live,
  // before anything is saved.
  await user.click(screen.getByRole('tab', { name: 'All 1u–13u' }))
  await user.click(await screen.findByRole('button', { name: 'Add a 10u pocket' }))
  await waitFor(() => expect(screen.getByText(/16 of 21 placed/)).toBeTruthy())
  assert.ok(screen.getByText(/4 more 1u caps need room/))
  // The Enter still needs a pocket of its own size; a trough will not do.
  assert.ok(screen.getByText('2.25u × 1'))
})

test('a tray in no project shows no coverage panel', async () => {
  state.designs = [{
    id: '1', name: 'Loose tray', pocketCount: 0, updatedAt: '2026-08-28 12:00:00',
    profileKind: 'preset', projectId: null, projectName: null,
  }]
  renderPage(<KeycapTrayPage />, '/keycap-tray/1')
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Tray' })).toBeTruthy())
  assert.equal(screen.queryByRole('heading', { name: 'Set coverage' }), null)
})

test('a project’s trays are switchable from the designer', async () => {
  // A set is laid out across several trays at once, so moving between them is
  // part of the work -- and the list is already in hand, so it costs nothing.
  state.designs = [
    { id: '1', name: 'Top tray', pocketCount: 3, updatedAt: '2026-08-28 12:00:00',
      profileKind: 'preset', projectId: '9', projectName: 'Womier' },
    { id: '2', name: 'Middle tray', pocketCount: 29, updatedAt: '2026-08-28 12:00:00',
      profileKind: 'preset', projectId: '9', projectName: 'Womier' },
    { id: '3', name: 'Someone else’s tray', pocketCount: 1, updatedAt: '2026-08-28 12:00:00',
      profileKind: 'preset', projectId: null, projectName: null },
  ]
  const user = userEvent.setup()
  renderPage(<KeycapTrayPage />, '/keycap-tray/1')

  const chip = await screen.findByRole('button', { name: /Womier — switch tray/ })
  await user.click(chip)

  const menu = await screen.findByRole('menu', { name: 'Trays in this project' })
  assert.ok(within(menu).getByRole('menuitem', { name: /Top tray/ }))
  assert.ok(within(menu).getByRole('menuitem', { name: /Middle tray/ }))
  // Only this project's trays; a loose tray is not in the set being laid out.
  assert.equal(within(menu).queryByRole('menuitem', { name: /Someone else/ }), null)

  await user.click(within(menu).getByRole('menuitem', { name: /Middle tray/ }))
  // Switching loads that tray, and the URL follows so the back button works.
  await waitFor(() => expect(
    state.calls.some(c => c.method === 'GET' && c.path === '/api/keycap-trays/2')).toBe(true))
})

test('a tray comes back the way it was last being looked at', async () => {
  // Snap, grid and the buffer guide are how someone was working on a tray, not
  // facts about it -- but retyping four dropdowns on every open is a tax.
  state.designs = [
    { id: '1', name: 'Top tray', pocketCount: 1, updatedAt: '2026-08-28 12:00:00',
      profileKind: 'preset' },
    { id: '2', name: 'Middle tray', pocketCount: 1, updatedAt: '2026-08-28 12:00:00',
      profileKind: 'preset' },
  ]
  const user = userEvent.setup()
  const first = renderPage(<KeycapTrayPage />, '/keycap-tray/1')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Hide labels' })).toBeTruthy())

  await user.click(screen.getByRole('button', { name: 'Hide labels' }))
  await user.click(screen.getByRole('button', { name: 'Show buffer' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Hide buffer' })).toBeTruthy())
  first.unmount()

  // A different tray is unaffected: each is remembered on its own.
  const second = renderPage(<KeycapTrayPage />, '/keycap-tray/2')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Hide labels' })).toBeTruthy())
  assert.ok(screen.getByRole('button', { name: 'Show buffer' }))
  second.unmount()

  // Reopening the first brings its settings back.
  renderPage(<KeycapTrayPage />, '/keycap-tray/1')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Show labels' })).toBeTruthy())
  assert.ok(screen.getByRole('button', { name: 'Hide buffer' }))
})

test('New starts from the defaults rather than the last tray’s settings', async () => {
  state.designs = [{
    id: '1', name: 'Top tray', pocketCount: 1, updatedAt: '2026-08-28 12:00:00',
    profileKind: 'preset',
  }]
  const user = userEvent.setup()
  renderPage(<KeycapTrayPage />, '/keycap-tray/1')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Hide labels' })).toBeTruthy())
  await user.click(screen.getByRole('button', { name: 'Hide labels' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Show labels' })).toBeTruthy())

  await user.click(screen.getByRole('button', { name: 'New' }))
  // A fresh tray is not the previous one's working state carried over -- and
  // it really is a fresh tray: clearing the address and the loaded design in
  // one commit is what stops the URL effect putting the old one straight back.
  // A fresh tray is not the previous one's working state carried over -- and it
  // really is a fresh tray. Clearing `savedId` used to look like "the address
  // names a tray nobody has loaded", which put the abandoned one straight back.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Hide labels' })).toBeTruthy())
  assert.notEqual(screen.getByRole('heading', { level: 1 }).textContent, 'Top tray')
  assert.equal(
    state.calls.filter(c => c.method === 'GET' && c.path === '/api/keycap-trays/1').length, 1,
    'New must not reload the tray it just abandoned',
  )
})
