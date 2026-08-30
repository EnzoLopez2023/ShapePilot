// @vitest-environment jsdom
import assert from 'node:assert/strict'
import type * as MsalModuleType from '../../src/auth/msal.ts'
import { useEffect } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, test, vi } from 'vitest'

type MsalModule = typeof MsalModuleType

const auth = vi.hoisted(() => {
  const state = {
    accounts: [] as { homeAccountId: string }[],
    active: null as { homeAccountId: string } | null,
  }
  const instance = {
    getActiveAccount: vi.fn(() => state.active),
    setActiveAccount: vi.fn((account: { homeAccountId: string }) => { state.active = account }),
    acquireTokenSilent: vi.fn(async ({ account }: { account: { homeAccountId: string } }) => ({
      accessToken: `token-${account.homeAccountId}`,
    })),
    acquireTokenRedirect: vi.fn(),
    loginRedirect: vi.fn(),
  }
  return { state, instance }
})

// This suite is about what happens when Entra auth IS on, so it says so rather
// than inheriting VITE_AUTH_MODE from the ambient environment. A developer with
// `VITE_AUTH_MODE=development` in .env.local would otherwise see it fail
// locally and pass in CI, which is exactly what happened.
vi.mock('../../src/auth/msal.ts', async importOriginal => ({
  ...(await importOriginal<MsalModule>()),
  AUTH_ENABLED: true,
}))

vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({ instance: auth.instance, accounts: auth.state.accounts }),
  AuthenticatedTemplate: ({ children }: { children: React.ReactNode }) => children,
  UnauthenticatedTemplate: () => null,
}))

import { AuthGuard } from '../../src/auth/AuthGuard.tsx'
import { apiRequest, setAccessTokenProvider } from '../../src/services/http.ts'

function MountRequest() {
  useEffect(() => {
    void apiRequest('/settings')
  }, [])
  return <div>mounted</div>
}

beforeEach(() => {
  auth.state.accounts = [{ homeAccountId: 'account-a' }]
  auth.state.active = auth.state.accounts[0]
  auth.instance.acquireTokenSilent.mockClear()
})

afterEach(() => {
  cleanup()
  setAccessTokenProvider(async () => null)
  vi.unstubAllGlobals()
})

test('first-mount and account-change requests wait for the matching token provider', async () => {
  const requests: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>
    requests.push(headers.authorization ?? '')
    return new Response('{}', { status: 200 })
  }))

  const view = render(
    <AuthGuard><MountRequest /></AuthGuard>,
  )
  await waitFor(() => assert.deepEqual(requests, ['Bearer token-account-a']))

  await act(async () => {
    auth.state.accounts = [{ homeAccountId: 'account-b' }]
    auth.state.active = auth.state.accounts[0]
    view.rerender(<AuthGuard><MountRequest /></AuthGuard>)
  })
  await waitFor(() => assert.deepEqual(requests, [
    'Bearer token-account-a',
    'Bearer token-account-b',
  ]))
  assert.deepEqual(
    auth.instance.acquireTokenSilent.mock.calls.map(([request]) => request.account.homeAccountId),
    ['account-a', 'account-b'],
  )
})
