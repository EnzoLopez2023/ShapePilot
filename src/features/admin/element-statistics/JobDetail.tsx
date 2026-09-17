import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { Link as RouterLink } from 'react-router-dom'
import type { ElementJobDetail } from '../../../../lib/contracts/elementStatistics.ts'
import { ErrorState, LoadingState } from '../../../components/LoadingState.tsx'
import { errorMessage } from '../../../services/errors.ts'
import { getElementJob } from './service.ts'
import { listDocuments } from '../../../services/designDocuments.ts'
import type { DocumentSummary } from '../../../services/designDocuments.ts'
import { designPath, matchDesign } from './designLinks.ts'
import { duration, grams, instant, length, resultLabels } from './format.ts'

export default function JobDetail({ connectionId, jobId, timeZone, onClose }: {
  connectionId: string; jobId: string; timeZone: string; onClose(): void
}) {
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'))
  const [detail, setDetail] = useState<ElementJobDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  // The saved designs, to put a recorded print back with the thing it came
  // from. A failure here costs the link and nothing else.
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  useEffect(() => {
    let cancelled = false
    void listDocuments()
      .then(found => { if (!cancelled) setDocuments(found) })
      .catch(() => { /* no link is offered */ })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setDetail(null)
    setError(null)
    void getElementJob(connectionId, jobId, controller.signal).then(value => {
      if (!controller.signal.aborted) setDetail(value)
    }).catch(reason => {
      if (!controller.signal.aborted) setError(errorMessage(reason))
    })
    return () => controller.abort()
  }, [connectionId, jobId, retry])
  const job = detail?.job
  const design = useMemo(() => matchDesign(job?.title, documents), [job?.title, documents])
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" fullScreen={fullScreen}
      aria-labelledby="element-job-heading">
      <DialogTitle id="element-job-heading">{job?.title ?? `Recorded job ${jobId}`}</DialogTitle>
      <DialogContent dividers>
        {error ? <ErrorState message={error} onRetry={() => setRetry(value => value + 1)} />
          : !job || !detail ? <LoadingState label="Loading recorded job..." />
            : (
              <Stack spacing={2}>
                <Typography>{detail.connection.printerName} / {detail.connection.printerId}</Typography>
                <Typography variant="body2" color="text.secondary">
                  Account {detail.connection.accountName ?? detail.connection.accountId} ({detail.connection.region}).
                  Cloud task ID {job.id}. Raw result: {job.rawStatus ?? 'unreported'}.
                </Typography>
                <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'max-content 1fr' }, gap: 1, '& dd': { m: 0 } }}>
                  <Typography component="dt" color="text.secondary">Result</Typography>
                  <Typography component="dd">{resultLabels[job.result]}</Typography>
                  <Typography component="dt" color="text.secondary">Start / end ({timeZone})</Typography>
                  <Typography component="dd">{instant(job.startedAt, timeZone)} / {instant(job.endedAt, timeZone)}</Typography>
                  <Typography component="dt" color="text.secondary">Recorded elapsed runtime</Typography>
                  <Typography component="dd">{duration(job.actualDurationSeconds)}</Typography>
                  <Typography component="dt" color="text.secondary">Full sliced time estimate</Typography>
                  <Typography component="dd">{duration(job.estimatedDurationSeconds)}</Typography>
                  <Typography component="dt" color="text.secondary">Full-job filament estimate</Typography>
                  <Typography component="dd">{grams(job.estimatedWeightGrams)} / {length(job)}</Typography>
                  <Typography component="dt" color="text.secondary">First / last recorded (UTC)</Typography>
                  <Typography component="dd">{instant(job.firstSeenAt, 'UTC')} / {instant(job.lastSeenAt, 'UTC')}</Typography>
                </Box>
                {design && (
                  <Alert
                    severity="success"
                    action={(
                      <Button component={RouterLink} to={designPath(design.document)} size="small">
                        Open design
                      </Button>
                    )}
                  >
                    {design.exact
                      ? `This job's name matches your design "${design.document.name}".`
                      : `This job's name contains your design "${design.document.name}".`}
                    {' '}Names are all there is to go on, so check it is the one you mean.
                  </Alert>
                )}
                <Alert severity="info">
                  Weight, length and sliced time describe the entire planned job, even when it failed
                  or was aborted. They do not measure actual extrusion, waste or a lifetime odometer.
                </Alert>
                {job.warnings.length > 0 && <Alert severity="warning">
                  {job.warnings.map(warning => warning.replaceAll('_', ' ')).join('; ')}
                </Alert>}
                <Typography variant="h2" component="h3">Reported material mapping</Typography>
                {job.materials.length === 0 ? <Typography>No material mapping was reported.</Typography> : (
                  <TableContainer tabIndex={0} aria-label="Job material mapping">
                    <Table size="small" sx={{ minWidth: 570 }}>
                      <TableHead><TableRow>
                        <TableCell>Material / filament ID</TableCell><TableCell>Colour</TableCell>
                        <TableCell align="right">Estimated grams</TableCell><TableCell>Nozzle / AMS / slot</TableCell>
                      </TableRow></TableHead>
                      <TableBody>{job.materials.map((material, index) => (
                        <TableRow key={index}>
                          <TableCell>{material.material ?? 'Unavailable'} / {material.filamentId ?? 'unreported'}</TableCell>
                          <TableCell>{material.color ?? 'Unavailable'}</TableCell>
                          <TableCell align="right">{grams(material.estimatedWeightGrams)}</TableCell>
                          <TableCell>{material.nozzleId ?? 'unreported'} / {material.amsId ?? 'unreported'} / {material.slotId ?? 'unreported'}</TableCell>
                        </TableRow>
                      ))}</TableBody>
                    </Table>
                  </TableContainer>
                )}
                <Typography variant="h2" component="h3">Recorded job events</Typography>
                {detail.events.length === 0
                  ? <Typography color="text.secondary">No live events are associated with this cloud task ID. Cloud backfill does not recreate past telemetry.</Typography>
                  : detail.events.map(event => <Box key={event.id}>
                    <Typography variant="body2" color="text.secondary">{instant(event.occurredAt, timeZone)}</Typography>
                    <Typography>{event.message}</Typography>
                  </Box>)}
              </Stack>
            )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close job details</Button></DialogActions>
    </Dialog>
  )
}
