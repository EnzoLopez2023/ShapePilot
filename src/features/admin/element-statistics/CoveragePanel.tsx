import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import type { ElementReport, ElementStatus } from '../../../../lib/contracts/elementStatistics.ts'
import { instant } from './format.ts'

export default function CoveragePanel({ status, report, busy, onRescan }: {
  status: ElementStatus; report: ElementReport | null; busy: boolean; onRescan(): void
}) {
  const coverage = report?.coverage ?? status.coverage
  return (
    <Accordion disableGutters sx={{ '&::before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}
        id="element-coverage-heading" aria-controls="element-coverage-body">
        <Typography variant="h2" component="h3">Coverage, sync and reporting assumptions</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
          <Alert severity="info">
            This is a ledger of jobs ShapePilot has recorded, not a lifetime printer odometer.
            Bambu cloud retention and coverage of local or SD-card jobs are not guaranteed.
            Scanning all available pages does not prove complete printer history.
          </Alert>
          {coverage.length === 0 ? <Typography>No printer history has been recorded yet.</Typography> : (
            <TableContainer tabIndex={0} aria-label="Recorded coverage by printer connection">
              <Table size="small" sx={{ minWidth: 800 }}>
                <TableHead><TableRow>
                  <TableCell>Printer / account</TableCell><TableCell>Recorded start-date coverage (UTC)</TableCell>
                  <TableCell>Import progress</TableCell><TableCell>Last successful sync (UTC)</TableCell>
                </TableRow></TableHead>
                <TableBody>{coverage.map(item => {
                  const connection = status.connections.find(value => value.id === item.connectionId)
                  return <TableRow key={item.connectionId}>
                    <TableCell>{connection?.printerName ?? 'Recorded printer'}
                      <Typography variant="body2" color="text.secondary">
                        {connection?.accountName ?? connection?.accountId ?? 'Unreported account'}
                      </Typography>
                      <Typography variant="body2">{item.jobCount} jobs; {item.undatedJobs} undated</Typography>
                    </TableCell>
                    <TableCell>{instant(item.earliestJobAt, 'UTC')} to {instant(item.latestJobAt, 'UTC')}
                      <Typography variant="body2" color="text.secondary">
                        Recording began {instant(item.firstRecordedAt, 'UTC')}
                      </Typography>
                    </TableCell>
                    <TableCell>{item.sync.backfillComplete ? 'Available pages scanned' : 'Backfill incomplete'}
                      <Typography variant="body2">{item.sync.backfillPages} pages in this pass</Typography>
                      <Typography variant="body2">Cloud total: {item.sync.remoteTotal ?? 'unreported'}</Typography>
                      {item.sync.remoteTotal !== null && item.jobCount < item.sync.remoteTotal && (
                        <Typography variant="body2" color="warning.main">More jobs are reported by the cloud than are recorded here.</Typography>
                      )}
                    </TableCell>
                    <TableCell>{instant(item.sync.lastSuccessAt, 'UTC')}
                      <Typography variant="body2" color="text.secondary">
                        Next attempt: {item.sync.nextSyncAt ? instant(item.sync.nextSyncAt, 'UTC') : 'not scheduled'}
                      </Typography>
                      {item.sync.problem && <Typography variant="body2" color="error.main">{item.sync.problem.message}</Typography>}
                    </TableCell>
                  </TableRow>
                })}</TableBody>
              </Table>
            </TableContainer>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
            <Button variant="outlined" onClick={onRescan}
              disabled={!status.settings.enabled || !status.credential.configured || busy || status.syncing}>
              Rescan available history
            </Button>
            <Typography variant="body2" color="text.secondary">Restarts pagination without deleting imported jobs.</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            The server refreshes history every five minutes, rechecks recent and active jobs, and
            rescans available history daily. Sync resumes from committed page checkpoints after
            failures. Live telemetry is sampled at most once per minute and retained for 30 days;
            the job ledger and recorded state/error events are retained. A shutdown flushes pending
            observations; an abrupt crash can lose the latest sampling interval.
          </Typography>
          {report && <Box component="ul" sx={{ m: 0, pl: 3 }}>
            {report.assumptions.map(assumption => <Typography component="li" variant="body2" key={assumption}>
              {assumption}
            </Typography>)}
          </Box>}
          <Typography variant="h3" component="h4">Recent monitoring events (all connections)</Typography>
          {status.events.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No events have been recorded. This does not prove there were no historical errors or gaps.</Typography>
          ) : status.events.map(event => (
            <Box key={event.id}>
              <Typography variant="body2" color="text.secondary">
                {instant(event.occurredAt, 'UTC')} UTC / {status.connections.find(item => item.id === event.connectionId)?.printerName ?? 'Recorded printer'}
              </Typography>
              <Typography variant="body2">{event.message}</Typography>
            </Box>
          ))}
        </Stack>
      </AccordionDetails>
    </Accordion>
  )
}
