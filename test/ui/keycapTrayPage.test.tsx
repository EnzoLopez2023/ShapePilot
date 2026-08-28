// @vitest-environment jsdom
//
// State and interaction parity for the designer, exercised through the real
// components. The API is stubbed at the fetch boundary so the whole client
// stack — service, HTTP client, state hook, components — is under test.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import KeycapTrayPage from '../../src/features/keycap-tray/KeycapTrayPage.tsx'
import { useTrayDesign, pocketExtent } from '../../src/features/keycap-tray/state/useTrayDesign.ts'
import { PYTHON_SIZING } from '../../src/features/keycap-tray/geometry/shapes.ts'
import { ThemeModeProvider } from '../../src/theme/ThemeModeProvider.tsx'
import { ConfirmDialogProvider } from '../../src/components/ConfirmDialogProvider.tsx'
import type { ReactElement } from 'react'

interface StubState {
  designs: { id: string; name: string; pocketCount: number; updatedAt: string; profileKind: string }[]
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

const renderPage = (ui: ReactElement = <KeycapTrayPage />) => render(
  <ThemeModeProvider initialPreference="light">
    <ConfirmDialogProvider>{ui}</ConfirmDialogProvider>
  </ThemeModeProvider>,
)

beforeEach(() => {
  state = {
    designs: [],
    library: [{ id: '1', name: '14mm square', units: 0.5 }],
    calls: [],
  }
  installFetchStub()
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

  test('pocketExtent honours rotation, explicit sizes and the ISO Enter footprint', () => {
    const flat = pocketExtent({ id: 'a', units: 2, x: 0, y: 0 }, PYTHON_SIZING)
    const tall = pocketExtent({ id: 'a', units: 2, x: 0, y: 0, rotationDeg: 90 }, PYTHON_SIZING)
    assert.ok(Math.abs(flat.w - tall.h) < 1e-9)
    assert.ok(Math.abs(flat.h - tall.w) < 1e-9)

    const explicit = pocketExtent(
      { id: 'a', units: 1, x: 0, y: 0, widthMm: 14, heightMm: 14 }, PYTHON_SIZING)
    assert.deepEqual([explicit.w, explicit.h], [14, 14])

    const iso = pocketExtent({ id: 'a', units: 1.5, x: 0, y: 0, shape: 'iso-enter' }, PYTHON_SIZING)
    assert.ok(Math.abs(iso.h - 2 * PYTHON_SIZING.height) < 1e-9)
  })
})

describe('designer page', () => {
  test('it renders the workbench with an accessible canvas and panels', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('application')).toBeTruthy())
    assert.ok(screen.getByRole('heading', { name: 'Pockets' }))
    assert.ok(screen.getByRole('heading', { name: 'Tray' }))
    assert.ok(screen.getByRole('heading', { name: 'Export' }))
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
})
