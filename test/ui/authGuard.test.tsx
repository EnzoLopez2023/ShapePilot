// @vitest-environment jsdom
import assert from 'node:assert/strict'
import { useEffect } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, test, vi } from 'vitest'

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
