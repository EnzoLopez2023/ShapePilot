import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Box, Button, Stack, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { AppShell } from './AppShell.tsx'
import { AuditProvider } from '../audit/AuditProvider.tsx'
import { LoadingState } from '../components/LoadingState.tsx'

// Real URL routing with lazy feature boundaries. There is no global conditional
// view switch: each section is its own route and its own chunk.
const KeycapTrayPage = lazy(() => import('../features/keycap-tray/KeycapTrayPage.tsx'))
const SettingsPage = lazy(() => import('../features/settings/SettingsPage.tsx'))
const AdminPage = lazy(() => import('../features/admin/AdminPage.tsx'))

function NotFound() {
  return (
    <Stack spacing={2} sx={{ alignItems: 'flex-start', p: 2 }}>
      <Typography variant="h1" component="h1">Page not found</Typography>
      <Typography color="text.secondary">
        That address does not match anything in ShapePilot.
      </Typography>
      <Button component={Link} to="/keycap-tray" variant="contained">
        Go to the keycap tray designer
      </Button>
    </Stack>
  )
}

export function AppRoutes() {
  return (
    <AuditProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/keycap-tray" replace />} />
          <Route
            path="/keycap-tray"
            element={
              <Box sx={{ flex: 1, minHeight: 0 }}>
                <Suspense fallback={<LoadingState label="Loading the designer…" />}>
                  <KeycapTrayPage />
                </Suspense>
              </Box>
            }
          />
          <Route
            path="/settings"
            element={
              <Suspense fallback={<LoadingState label="Loading settings…" />}>
                <SettingsPage />
              </Suspense>
            }
          />
          <Route
            path="/admin"
            element={
              <Suspense fallback={<LoadingState label="Loading admin…" />}>
                <AdminPage />
              </Suspense>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AuditProvider>
  )
}
