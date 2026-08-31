// @vitest-environment jsdom
//
// The settings page through the real components, with the API stubbed at the
// fetch boundary. What is pinned is the two things a person can get wrong
// silently: a designer default that does not save, and a sign-out that ends
// the session only in this browser.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MsalProvider } from '@azure/msal-react'

// The repo's own .env.local sets VITE_AUTH_MODE=development, which correctly
// disables sign-out -- the dev bypass has no session to end. The behaviour
// worth pinning is the deployed one, so auth is forced on here.
vi.mock('../../src/auth/msal.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AUTH_ENABLED: true,
}))
import SettingsPage from '../../src/features/settings/SettingsPage.tsx'
import { SHIPPED_DESIGNER_DEFAULTS } from '../../src/features/settings/preferences.ts'
import { ThemeModeProvider } from '../../src/theme/ThemeModeProvider.tsx'

interface Saved { designerDefaults?: unknown }

let saved: Saved[] = []
let logoutCalls: unknown[] = []

const settingsBody = () => ({
  preferences: {
    themeMode: 'light', units: 'mm', reducedMotion: 'system',
    designerDefaults: SHIPPED_DESIGNER_DEFAULTS,
  },
  profile: {
    tenantId: 't', oid: 'o', displayName: 'Test Person', email: 't@example.invalid',
    role: 'user', authSource: 'entra',
  },
})

const logger = {
  clone: () => logger,
  verbose: () => {}, info: () => {}, warning: () => {}, error: () => {}, trace: () => {},
}

/** Only what the page touches: an active account and a redirect sign-out. */
const stubMsal = () => ({
  getActiveAccount: () => ({ homeAccountId: 'a', environment: 'e', tenantId: 't',
    username: 't@example.invalid', localAccountId: 'o' }),
  logoutRedirect: (request: unknown) => { logoutCalls.push(request); return Promise.resolve() },
  addEventCallback: () => null,
  removeEventCallback: () => {},
  initialize: () => Promise.resolve(),
  getAllAccounts: () => [],
  setActiveAccount: () => {},
  enableAccountStorageEvents: () => {},
  disableAccountStorageEvents: () => {},
  getLogger: () => logger,
  initializeWrapperLibrary: () => {},
})

const renderPage = () => render(
  <ThemeModeProvider initialPreference="light">
    <MsalProvider instance={stubMsal() as never}>
      <SettingsPage />
    </MsalProvider>
  </ThemeModeProvider>,
)

beforeEach(() => {
  saved = []
  logoutCalls = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, '')
    const method = (init.method ?? 'GET').toUpperCase()
    if (path === '/api/settings' && method === 'PUT') {
      const body = JSON.parse(String(init.body)) as Saved
      saved.push(body)
      return new Response(JSON.stringify({ preferences: body }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    if (path === '/api/settings') {
      return new Response(JSON.stringify(settingsBody()), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ ok: true }), { status: 202 })
  })
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('each designer has its own section, with only its own controls', async () => {
  renderPage()
  await waitFor(() => expect(
    screen.getByRole('heading', { name: 'Designer defaults' })).toBeTruthy())

  // Offering a designer the other's controls would be offering a setting that
  // does nothing, so the sections are not the same.
  assert.ok(screen.getByRole('heading', { name: 'Keycap tray' }))
  assert.ok(screen.getByRole('heading', { name: 'Shaper designer' }))
  assert.ok(screen.getByRole('heading', { name: 'Bambu designer' }))
  // The build plate and the gizmo belong to one designer each.
  assert.ok(screen.getByLabelText('Show plate'))
  assert.ok(screen.getByRole('combobox', { name: 'Gizmo' }))
})

test('changing a default saves it under that designer alone', async () => {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(screen.getByLabelText('Show buffer')).toBeTruthy())

  await user.click(screen.getByLabelText('Show buffer'))

  await waitFor(() => expect(saved.length).toBeGreaterThan(0))
  const defaults = saved.at(-1)?.designerDefaults as typeof SHIPPED_DESIGNER_DEFAULTS
  assert.equal(defaults.keycapTray.showBuffer, true)
  // Nothing else moved.
  assert.deepEqual(defaults.shaper, SHIPPED_DESIGNER_DEFAULTS.shaper)
  assert.deepEqual(defaults.bambu, SHIPPED_DESIGNER_DEFAULTS.bambu)
})

test('signing out ends the session at the identity provider', async () => {
  const user = userEvent.setup()
  renderPage()
  const account = await screen.findByRole('heading', { name: 'Account' })
  assert.ok(account)

  await user.click(screen.getByRole('button', { name: 'Sign out' }))

  // Redirect, not a local cache clear: ending it only in this browser would
  // leave the next sign-in silently reusing the same account.
  assert.equal(logoutCalls.length, 1)
  assert.ok((logoutCalls[0] as { account?: unknown }).account)
  // Nothing about a dev bypass is claimed when there is a real session.
  assert.equal(screen.queryByText(/no session to end/), null)
})

test('the account section names who is signed in', async () => {
  renderPage()
  const section = (await screen.findByRole('heading', { name: 'Account' })).parentElement!
  await waitFor(() => expect(within(section).getByText('Test Person')).toBeTruthy())
  assert.ok(within(section).getByText('t@example.invalid'))
})
