// The shared harness for the keycap designer suites.
//
// This was one 1,054-line file running 46 tests. Vitest parallelises by file
// and cannot overlap a file with itself, so it was the long pole of the whole
// quality job at 160 s on CI -- longer than most of the rest of the suite put
// together. Splitting it costs nothing in coverage and takes that off the
// critical path.
//
// What lives here is only the part every split file needs identically: the
// stub state, the fetch stub standing in for the whole API, the two render
// helpers, and the per-test setup. The tests themselves stay with the concern
// they describe. `installHarness()` is called once per file rather than the
// hooks being exported loose, so a suite cannot half-install it.
import { afterEach, beforeEach, expect, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import {
  forgetDesignerDefaults, SHIPPED_DESIGNER_DEFAULTS,
} from '../../src/features/settings/preferences.ts'
import type { DesignerDefaults } from '../../src/features/settings/preferences.ts'
import KeycapTrayPage from '../../src/features/keycap-tray/KeycapTrayPage.tsx'
import { PYTHON_SIZING } from '../../src/features/keycap-tray/geometry/shapes.ts'
import { ThemeModeProvider } from '../../src/theme/ThemeModeProvider.tsx'
import { ConfirmDialogProvider } from '../../src/components/ConfirmDialogProvider.tsx'
import type { ReactElement } from 'react'

export interface StubState {
  designs: {
    id: string; name: string; pocketCount: number; updatedAt: string; profileKind: string
    projectId?: string | null; projectName?: string | null
  }[]
  project?: {
    id: string
    items: { units: number; heightUnits?: number; count?: number; legend?: string }[]
    coverage: { units: number; heightUnits: number; shape: string | null; pockets: number }[]
  }
  projectList?: { id: string; name: string; trayCount?: number; updatedAt?: string }[]
  library: { id: string; name: string; units: number }[]
  calls: { method: string; path: string; body?: unknown }[]
  designerDefaults?: DesignerDefaults
  failListWith?: number
  createGate?: Promise<void>
  loadGate?: Promise<void>
  updateGate?: Promise<void>
}

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

export let state: StubState

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

    if (path === '/api/keycap-projects' && method === 'GET') {
      return json(200, state.projectList ?? [])
    }
    if (path === '/api/keycap-projects' && method === 'POST') {
      return json(201, { id: 'p-new' })
    }
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
      const created = body as { name: string; projectId?: string | null; pockets?: unknown[] }
      state.designs = [...state.designs, {
        id, name: created.name, pocketCount: created.pockets?.length ?? 0,
        updatedAt: '2026-08-28 12:00:00', profileKind: 'preset',
        projectId: created.projectId ?? null,
        projectName: created.projectId ? 'Womier' : null,
      }]
      return json(201, { id })
    }
    if (/^\/api\/keycap-trays\/\d+$/.test(path) && method === 'PUT') {
      await state.updateGate
      return json(200, { ok: true })
    }
    if (/^\/api\/keycap-trays\/\d+$/.test(path) && method === 'DELETE') {
      const id = path.split('/').pop()
      state.designs = state.designs.filter(d => d.id !== id)
      return json(200, { ok: true })
    }
    if (/^\/api\/keycap-trays\/\d+$/.test(path) && method === 'GET') {
      await state.loadGate
      const id = path.split('/').pop() as string
      const summary = state.designs.find(d => d.id === id)
      const pocketCount = summary?.pocketCount ?? 0
      return json(200, {
        id, name: summary?.name ?? 'Loaded',
        projectId: summary?.projectId ?? null,
        profile: { kind: 'preset', id: 'systainer-s76-plain' },
        sizing: { ...PYTHON_SIZING },
        floorThicknessMm: 2.4, pocketDepthMm: 10, engraveDepthMm: 0.4,
        pockets: Array.from({ length: pocketCount }, (_, i) => ({
          id: `p${i + 1}`, units: 1, heightUnits: 1, x: 10 + i * 20, y: 10, rotationDeg: 0,
          isThrough: false, label: `pocket ${i + 1}`, labelMode: 'guide',
        })),
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
    if (path === '/api/settings') {
      return json(200, {
        preferences: {
          themeMode: 'light', units: 'mm', reducedMotion: 'system',
          designerDefaults: state.designerDefaults ?? SHIPPED_DESIGNER_DEFAULTS,
        },
        profile: {
          tenantId: 't', oid: 'o', displayName: null, email: null,
          role: 'user', authSource: 'development',
        },
      })
    }
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

/** The designer with a tray open -- the working state, now that a tray only
 *  exists inside a project. Seeds one project-linked tray unless the test set
 *  up its own `state.designs`. */
const renderWorkbench = (route = '/keycap-tray/1') => {
  if (!state.designs.some(d => d.id === '1')) {
    state.designs = [
      {
        id: '1', name: 'Untitled tray', pocketCount: 0, updatedAt: '2026-08-28 12:00:00',
        profileKind: 'preset', projectId: '9', projectName: 'Womier',
      },
      ...state.designs,
    ]
  }
  return renderPage(<KeycapTrayPage />, route)
}

/** Resolves once the tray in the URL has finished loading -- Clone flips on
 *  when `savedId` is set and `busy` clears, so it is a clean "load done" gate
 *  before clicking a `disabled={busy}` toolbar action. */
const awaitTrayLoaded = () => waitFor(() => expect(
  (screen.getByRole('button', { name: 'Clone' }) as HTMLButtonElement).disabled).toBe(false))

/** Everything a suite needs installed around each test. */
export function installHarness(): void {
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
    // The defaults are cached for the session, which is right for a browser and
    // wrong for a suite where each test is its own session.
    forgetDesignerDefaults()
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
}

export { installFetchStub, renderPage, renderWorkbench, awaitTrayLoaded }
