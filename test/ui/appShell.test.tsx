// @vitest-environment jsdom
//
// Real URL routing: each section is its own address, the browser's history
// works, and an unknown path lands on a recoverable page rather than a blank
// screen or a silently swapped global view.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from '../../src/app/AppShell.tsx'
import { ThemeModeProvider } from '../../src/theme/ThemeModeProvider.tsx'

const settingsResponse = (role: 'user' | 'admin') => ({
  preferences: { themeMode: 'system', units: 'mm', reducedMotion: 'system' },
  profile: {
    tenantId: 't', oid: 'o', displayName: 'Test', email: 't@example.invalid',
    role, authSource: 'entra',
  },
})

const renderAt = (path: string, role: 'user' | 'admin' = 'user') => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : String(input)
    if (url.includes('/api/settings')) {
      return new Response(JSON.stringify(settingsResponse(role)), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/version.json')) {
      return new Response(JSON.stringify({
        app: 'shapepilot', version: '2.5.3', build: '33410527399-1', buildNumber: '4',
        commit: 'a1b2c3d4e5f6',
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 202, headers: { 'content-type': 'application/json' },
    })
  })

  return render(
    <ThemeModeProvider initialPreference="light">
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/projects" element={<h1>Projects stub</h1>} />
            <Route path="/keycap-tray" element={<h1>Designer stub</h1>} />
            <Route path="/shaper-designer" element={<h1>Shaper stub</h1>} />
            <Route path="/bambu-designer" element={<h1>Bambu stub</h1>} />
            <Route path="/playground" element={<h1>Playground stub</h1>} />
            <Route path="/settings" element={<h1>Settings stub</h1>} />
            <Route path="/admin" element={<h1>Admin stub</h1>} />
            <Route path="*" element={<h1>Page not found</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeModeProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the shell renders a real navigation region with a skip link', async () => {
  renderAt('/keycap-tray')
  assert.ok(screen.getByRole('navigation', { name: 'Sections' }))
  assert.ok(screen.getByRole('main'))
  assert.ok(screen.getByRole('link', { name: 'Skip to content' }))
  assert.ok(screen.getByRole('heading', { name: 'Designer stub' }))
})

test('navigating changes the URL and the rendered section', async () => {
  const user = userEvent.setup()
  renderAt('/keycap-tray')
  await user.click(screen.getByRole('link', { name: 'Settings' }))
  assert.ok(await screen.findByRole('heading', { name: 'Settings stub' }))
  assert.equal(screen.queryByRole('heading', { name: 'Designer stub' }), null)
})

test('the admin link only appears for an administrator', async () => {
  renderAt('/keycap-tray', 'user')
  await waitFor(() => expect(screen.getByRole('link', { name: 'Keycap tray' })).toBeTruthy())
  assert.equal(screen.queryByRole('link', { name: 'Admin' }), null)

  cleanup()
  renderAt('/keycap-tray', 'admin')
  assert.ok(await screen.findByRole('link', { name: 'Admin' }))
})

test('an unknown address renders the not-found page inside the shell', async () => {
  renderAt('/does-not-exist')
  assert.ok(screen.getByRole('heading', { name: 'Page not found' }))
  assert.ok(screen.getByRole('navigation', { name: 'Sections' }))
})

test('the active section is marked for assistive technology and sighted users', async () => {
  renderAt('/settings')
  const active = screen.getByRole('link', { name: 'Settings' })
  assert.ok(active.className.includes('active'))
})

test('every designer has its own nav entry and its own address', async () => {
  const sections: [string, string][] = [
    ['/projects', 'Projects'],
    ['/keycap-tray', 'Keycap tray'],
    ['/shaper-designer', 'Shaper designer'],
    ['/bambu-designer', 'Bambu designer'],
    ['/playground', 'AI playground'],
  ]
  for (const [path, label] of sections) {
    renderAt(path)
    await waitFor(() => expect(screen.getByRole('link', { name: label })).toBeTruthy())
    // Real routing, not a view switch: the nav link points at the address.
    assert.equal(screen.getByRole('link', { name: label }).getAttribute('href'), path)
    cleanup()
  }
})

test('the nav marks only the current section as current', async () => {
  renderAt('/bambu-designer')
  await waitFor(() => expect(screen.getByRole('link', { name: 'Bambu designer' })).toBeTruthy())

  const current = screen.getByRole('link', { name: 'Bambu designer' })
  assert.equal(current.getAttribute('aria-current'), 'page')
  for (const other of ['Projects', 'Keycap tray', 'Shaper designer', 'AI playground']) {
    assert.notEqual(screen.getByRole('link', { name: other }).getAttribute('aria-current'), 'page')
  }
})

test('each designer route renders exactly one main and one h1', async () => {
  for (const path of ['/shaper-designer', '/bambu-designer', '/playground']) {
    renderAt(path)
    await waitFor(() => expect(screen.getAllByRole('main')).toHaveLength(1))
    assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1, path)
    cleanup()
  }
})

test('the sidebar names the build that is running', async () => {
  renderAt('/keycap-tray')
  // Which build is live has to be answerable at a glance -- during a deploy it
  // is the difference between "the fix is not working" and "the fix is not there".
  // The release counter, not the run identity: `build` is unique per attempt so
  // an image tag names one build, which makes it useless to read aloud.
  await waitFor(() => expect(screen.getByText('2.5.3 · build 4 · a1b2c3d')).toBeTruthy())
})

test('a build stamp that will not load is absent, not an error', async () => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : String(input)
    if (url.includes('/version.json')) return new Response(null, { status: 503 })
    if (url.includes('/api/settings')) {
      return new Response(JSON.stringify(settingsResponse('user')), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ ok: true }), { status: 202 })
  })
  render(
    <ThemeModeProvider initialPreference="light">
      <MemoryRouter initialEntries={['/keycap-tray']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/keycap-tray" element={<h1>Designer stub</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeModeProvider>,
  )
  await waitFor(() => expect(screen.getByRole('link', { name: 'Keycap tray' })).toBeTruthy())
  // The nav still works and nothing claims to have failed.
  assert.equal(screen.queryByText(/build /), null)
  assert.equal(screen.queryByRole('alert'), null)
})
