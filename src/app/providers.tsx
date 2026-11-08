import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { MsalProvider } from '@azure/msal-react'
import { msalInstance } from '../auth/msal.ts'
import { AuthGuard } from '../auth/AuthGuard.tsx'
import { AppErrorBoundary } from '../components/AppErrorBoundary.tsx'
import { ConfirmDialogProvider } from '../components/ConfirmDialogProvider.tsx'
import { ThemeModeProvider } from '../theme/ThemeModeProvider.tsx'
import BambuStudioNotice from '../components/BambuStudioNotice.tsx'

/**
 * The complete global provider set: auth, theme, confirmation and the error
 * boundary, plus the notice every "Open in Bambu Studio" reports to. Nothing
 * else is global.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AppErrorBoundary>
      <MsalProvider instance={msalInstance()}>
        <ThemeModeProvider>
          <ConfirmDialogProvider>
            <BrowserRouter>
              <AuthGuard>{children}<BambuStudioNotice /></AuthGuard>
            </BrowserRouter>
          </ConfirmDialogProvider>
        </ThemeModeProvider>
      </MsalProvider>
    </AppErrorBoundary>
  )
}
