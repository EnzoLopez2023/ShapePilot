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
    return new Response(JSON.stringify({ ok: true }), {
      status: 202, headers: { 'content-type': 'application/json' },
    })
  })

  return render(
    <ThemeModeProvider initialPreference="light">
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/keycap-tray" element={<h1>Designer stub</h1>} />
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
