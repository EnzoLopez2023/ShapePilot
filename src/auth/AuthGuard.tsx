import { useEffect } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import { AuthenticatedTemplate, UnauthenticatedTemplate, useMsal } from '@azure/msal-react'
import type { ReactNode } from 'react'
import { AUTH_ENABLED, authConfigured, loginRequest } from './msal.ts'
import { useAccessToken } from './useAccessToken.ts'

function SignInPanel() {
  const { instance } = useMsal()
  return (
    <Box
      component="main"
      sx={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        px: 3,
        bgcolor: 'background.default',
      }}
    >
      <Stack spacing={2.5} sx={{ maxWidth: 420, width: '100%' }}>
        <Typography variant="h1" component="h1">ShapePilot</Typography>
        <Typography color="text.secondary">
          Sign in with your work account to open your saved trays. Designs are scoped to
          your account and are not shared with anyone else.
        </Typography>
        {authConfigured ? (
          <Button
            variant="contained"
            onClick={() => { void instance.loginRedirect(loginRequest) }}
            sx={{ alignSelf: 'flex-start' }}
          >
            Sign in
          </Button>
        ) : (
          <Typography color="error">
            Sign-in is not configured for this build. Set VITE_ENTRA_CLIENT_ID,
            VITE_ENTRA_TENANT_ID and VITE_API_SCOPE, or run with
            VITE_AUTH_MODE=development.
          </Typography>
        )}
      </Stack>
    </Box>
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
