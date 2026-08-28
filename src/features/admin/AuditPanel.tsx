import { useCallback, useEffect, useState } from 'react'
import {
  Box, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Typography,
} from '@mui/material'
import { apiRequest } from '../../services/http.ts'
import { EmptyState, ErrorState, LoadingState } from '../../components/LoadingState.tsx'
import { errorMessage } from '../../services/errors.ts'

interface AuditEvent {
  id: string
  occurredAt: string
  actorTenantId: string | null
  actorOid: string | null
  category: string
  action: string
  outcome: string
  httpMethod: string | null
  httpPath: string | null
  httpStatus: number | null
  subject: string | null
}

const CATEGORIES = ['', 'auth', 'http', 'keycap-tray', 'settings', 'admin', 'navigation', 'client']

export default function AuditPanel() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [category, setCategory] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (next: string) => {
    setLoading(true)
    setError(null)
    try {
      const query = next ? `?category=${encodeURIComponent(next)}&limit=100` : '?limit=100'
      setEvents(await apiRequest<AuditEvent[]>(`/admin/audit${query}`))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(category) }, [load, category])

  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Typography variant="h2" component="h2">Audit</Typography>
        <Typography variant="body2" color="text.secondary">
          Actors are the verified token identity, never a value supplied by the client.
          Detail fields are bounded and credential-shaped keys are redacted before storage.
        </Typography>
        <TextField
          select size="small" label="Category" value={category}
          onChange={e => setCategory(e.target.value)}
          sx={{ width: 220 }}
        >
          {CATEGORIES.map(c => (
            <MenuItem key={c || 'all'} value={c}>{c || 'All categories'}</MenuItem>
          ))}
        </TextField>

        {loading && <LoadingState label="Loading audit events…" />}
        {error && <ErrorState message={error} onRetry={() => void load(category)} />}
        {!loading && !error && events.length === 0 && (
          <EmptyState title="No audit events" description="Nothing has been recorded for this filter yet." />
        )}
        {!loading && !error && events.length > 0 && (
          <TableContainer sx={{ maxHeight: 480 }}>
            <Table size="small" stickyHeader aria-label="Audit events">
              <TableHead>
                <TableRow>
                  <TableCell>Time</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell>Action</TableCell>
                  <TableCell>Outcome</TableCell>
                  <TableCell>Request</TableCell>
                  <TableCell>Actor</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {events.map(event => (
                  <TableRow key={event.id}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{event.occurredAt}</TableCell>
                    <TableCell>{event.category}</TableCell>
                    <TableCell>{event.action}</TableCell>
                    <TableCell>{event.outcome}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>
                      {event.httpMethod ? `${event.httpMethod} ${event.httpPath ?? ''}` : '—'}
                      {event.httpStatus ? ` (${event.httpStatus})` : ''}
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>
                      <Box sx={{ overflowWrap: 'anywhere' }}>{event.actorOid ?? '—'}</Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Stack>
    </Paper>
  )
}
