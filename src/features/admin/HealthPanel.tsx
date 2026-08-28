import { useCallback, useEffect, useState } from 'react'
import { Box, Chip, Paper, Stack, Typography } from '@mui/material'
import { apiRequest } from '../../services/http.ts'
import { ErrorState, LoadingState } from '../../components/LoadingState.tsx'
import { errorMessage } from '../../services/errors.ts'

interface ReadinessReport {
  status: 'ready' | 'not-ready'
  app: string
  lifecycle: string
  build: { version: string; build: string; commit: string; builtAt: string }
  database: {
    authority: string
    reachable: boolean
    journalMode: string | null
    foreignKeys: boolean | null
    schemaIdentity: string | null
    expectedSchemaIdentity: string
    headMigration: string | null
    expectedHeadMigration: string
  }
  checkedAt: string
  durationMs: number
  reason?: string
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <>
    <Typography component="dt" variant="body2" color="text.secondary">{label}</Typography>
    <Typography
      component="dd" variant="body2"
      sx={{ m: 0, fontFamily: 'monospace', overflowWrap: 'anywhere' }}
    >
      {value}
    </Typography>
  </>
)

export default function HealthPanel() {
  const [report, setReport] = useState<ReadinessReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setReport(await apiRequest<ReadinessReport>('/admin/health'))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading) return <LoadingState label="Checking service health…" />
  if (error) return <ErrorState message={error} onRetry={() => void load()} />
  if (!report) return null

  const healthy = report.status === 'ready'

  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="h2" component="h2">Service health</Typography>
          <Chip
            size="small"
            color={healthy ? 'success' : 'error'}
            variant="outlined"
            label={healthy ? 'Ready' : `Not ready${report.reason ? ` — ${report.reason}` : ''}`}
          />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          This is the same bounded probe /api/ready runs: one cheap read plus a schema
          comparison. No integrity scan or backup runs here or at startup.
        </Typography>
        <Box
          component="dl"
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'max-content 1fr' },
            columnGap: 3,
            rowGap: 0.75,
            m: 0,
          }}
        >
          <Row label="Lifecycle" value={report.lifecycle} />
          <Row label="Version" value={`${report.build.version} (build ${report.build.build})`} />
          <Row label="Commit" value={report.build.commit} />
          <Row label="Database" value={report.database.authority} />
          <Row label="Journal mode" value={report.database.journalMode ?? '—'} />
          <Row label="Foreign keys" value={report.database.foreignKeys ? 'on' : 'off'} />
          <Row label="Head migration" value={report.database.headMigration ?? '—'} />
          <Row label="Schema identity" value={report.database.schemaIdentity ?? '—'} />
          <Row label="Probe duration" value={`${report.durationMs} ms`} />
        </Box>
      </Stack>
    </Paper>
  )
}
