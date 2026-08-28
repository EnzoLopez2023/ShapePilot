// Access-token plumbing.
//
// The HTTP client asks for a token before every request; MSAL serves it from
// cache and refreshes silently when it has expired. Only this module knows
// about MSAL — feature services just call `apiRequest`.
import { useLayoutEffect, useMemo, useState } from 'react'
import { InteractionRequiredAuthError } from '@azure/msal-browser'
import { useMsal } from '@azure/msal-react'
import { AUTH_ENABLED, apiTokenRequest } from './msal.ts'
import { setAccessTokenProvider } from '../services/http.ts'

/**
 * Installs the token provider for the lifetime of the app. In development-auth
 * mode no token is sent at all and the server's documented bypass applies.
 */
export function useAccessToken(): boolean {
  const { instance, accounts } = useMsal()
  const activeAccount = instance.getActiveAccount()
  const desiredKey = useMemo(() => {
    if (!AUTH_ENABLED) return 'development'
    const active = activeAccount?.homeAccountId ?? ''
    return `${active}\u0000${accounts.map((account) => account.homeAccountId).join('\u0000')}`
  }, [activeAccount?.homeAccountId, accounts])
  const [installedKey, setInstalledKey] = useState<string | null>(null)

  useLayoutEffect(() => {
    if (!AUTH_ENABLED) {
      setAccessTokenProvider(async () => null)
    } else {
      setAccessTokenProvider(async () => {
        const account = instance.getActiveAccount() ?? accounts[0]
        if (!account) return null
        try {
          const result = await instance.acquireTokenSilent({ ...apiTokenRequest, account })
          return result.accessToken
        } catch (error) {
          if (error instanceof InteractionRequiredAuthError) {
            await instance.acquireTokenRedirect({ ...apiTokenRequest, account })
          }
          return null
        }
      })
    }
    setInstalledKey(desiredKey)
    return () => { setAccessTokenProvider(async () => null) }
  }, [instance, accounts, desiredKey])

  return installedKey === desiredKey
}
