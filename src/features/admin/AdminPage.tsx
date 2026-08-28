import { Stack, Typography } from '@mui/material'
import HealthPanel from './HealthPanel.tsx'
import AuditPanel from './AuditPanel.tsx'

/**
 * Admin is app-local. There is no shared cross-app admin surface and no shared
 * permissions database; every server route behind this page re-verifies the
 * caller's role from the ShapePilot membership table.
 */
export default function AdminPage() {
  return (
    <Stack spacing={2} sx={{ maxWidth: 1100 }}>
      <Typography variant="h1" component="h1">Admin</Typography>
      <HealthPanel />
      <AuditPanel />
    </Stack>
  )
}
