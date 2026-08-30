import { useEffect } from 'react'
import { AuthenticatedTemplate, UnauthenticatedTemplate, useMsal } from '@azure/msal-react'
import type { ReactNode } from 'react'
import { AUTH_ENABLED, authConfigured, loginRequest } from './msal.ts'
import { useAccessToken } from './useAccessToken.ts'
import { LandingPage } from '../features/landing/LandingPage.tsx'

/**
 * What every signed-out visitor sees: the marketing landing page, whose
 * "Sign in with Microsoft" actions start the same redirect the app has always
 * used (cache cleared first so a stale account never blocks the prompt).
 */
function SignInPanel() {
  const { instance } = useMsal()
  return (
    <LandingPage
      authConfigured={authConfigured}
      onSignIn={() => {
        void instance.clearCache().then(() => instance.loginRedirect(loginRequest))
      }}
    />
  )
}

/**
 * Gates the app on a signed-in account and installs the access-token provider.
 *
 * With VITE_AUTH_MODE=development the gate is skipped and no token is sent, so
 * a developer can run the app against a server started with the documented
 * SHAPEPILOT_DEV_AUTH bypass. Neither half of that is reachable in production.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const tokenProviderReady = useAccessToken()
  const { instance, accounts } = useMsal()

  useEffect(() => {
    if (!AUTH_ENABLED) return
    if (!instance.getActiveAccount() && accounts.length > 0) {
      instance.setActiveAccount(accounts[0])
    }
  }, [instance, accounts])

  if (!tokenProviderReady) return null
  if (!AUTH_ENABLED) return <>{children}</>

  return (
    <>
      <AuthenticatedTemplate>{children}</AuthenticatedTemplate>
      <UnauthenticatedTemplate><SignInPanel /></UnauthenticatedTemplate>
    </>
  )
}
