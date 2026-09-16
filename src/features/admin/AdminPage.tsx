import { lazy, Suspense, useEffect, useState } from 'react'
import { Alert, Button, Stack, Tab, Tabs, Typography } from '@mui/material'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import HealthPanel from './HealthPanel.tsx'
import AuditPanel from './AuditPanel.tsx'
import { getSettings } from '../settings/preferences.ts'
import { ErrorState, LoadingState } from '../../components/LoadingState.tsx'
import { errorMessage } from '../../services/errors.ts'

const ElementStatisticsPage = lazy(() => import('./element-statistics/ElementStatisticsPage.tsx'))

/**
 * Admin is app-local. There is no shared cross-app admin surface and no shared
 * permissions database; every server route behind this page re-verifies the
 * caller's role from the ShapePilot membership table.
 */
export default function AdminPage() {
  const { pathname } = useLocation()
  const [access, setAccess] = useState<'loading' | 'admin' | 'user'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const statistics = pathname.startsWith('/admin/el-ement-statistics')

  useEffect(() => {
    let cancelled = false
    setAccess('loading')
    setError(null)
    void getSettings().then(({ profile }) => {
      if (!cancelled) setAccess(profile.role)
    }).catch(reason => {
      if (!cancelled) setError(errorMessage(reason))
    })
    return () => { cancelled = true }
  }, [pathname, retry])

  if (error) return <ErrorState message={error} onRetry={() => setRetry(value => value + 1)} />
  if (access === 'loading') return <LoadingState label="Checking administrator access..." />
  if (access !== 'admin') {
    return (
      <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Alert severity="warning">Administrator access is required to open Admin.</Alert>
        <Button component={Link} to="/">Return to the workshop</Button>
      </Stack>
    )
  }

  return (
    <Stack spacing={2} sx={{ maxWidth: 1200, width: '100%', minWidth: 0 }}>
      <Typography variant="h1" component="h1">Admin</Typography>
      <Tabs value={statistics ? 'statistics' : 'overview'} aria-label="Admin sections" variant="scrollable">
        <Tab component={Link} to="/admin" value="overview" label="Service overview"
          id="admin-overview-tab" aria-controls="admin-content" />
        <Tab component={Link} to="/admin/el-ement-statistics" value="statistics"
          label="EL-ement Statistics" id="admin-statistics-tab" aria-controls="admin-content" />
      </Tabs>
      <Stack id="admin-content" role="tabpanel"
        aria-labelledby={statistics ? 'admin-statistics-tab' : 'admin-overview-tab'} spacing={2}>
        <Routes>
          <Route index element={<><HealthPanel /><AuditPanel /></>} />
          <Route path="el-ement-statistics" element={
            <Suspense fallback={<LoadingState label="Loading EL-ement Statistics..." />}>
              <ElementStatisticsPage />
            </Suspense>
          } />
          <Route path="*" element={<Alert severity="info">That Admin page does not exist.</Alert>} />
        </Routes>
      </Stack>
    </Stack>
  )
}
