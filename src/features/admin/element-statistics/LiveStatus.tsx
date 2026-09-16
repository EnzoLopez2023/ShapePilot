import {
  Box, Button, Chip, LinearProgress, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material'
import type {
  ElementConnectionState, ElementSnapshot, ElementStatus,
} from '../../../../lib/contracts/elementStatistics.ts'
import { instant, number } from './format.ts'

const stateLabels: Record<ElementConnectionState, string> = {
  unconfigured: 'Not configured', disabled: 'Monitoring disabled', connecting: 'Connecting',
  connected: 'Cloud connected', offline: 'Live status offline', expired: 'Credential expired',
  selection_required: 'Printer selection required', error: 'Connection error',
}

function Metric({ label, value, field, snapshot }: {
  label: string; value: string; field: keyof ElementSnapshot; snapshot: ElementSnapshot | null
}) {
  const reported = snapshot?.fieldUpdatedAt[field]
  const description = reported ? `Last reported ${instant(reported, 'UTC')} UTC` : 'Not reported by this printer'
  return (
    <Box>
      <Typography component="dt" variant="body2" color="text.secondary">{label}</Typography>
      <Tooltip title={description}>
        <Typography component="dd" tabIndex={0} sx={{ m: 0, fontVariantNumeric: 'tabular-nums' }}
          aria-label={`${label}: ${value}. ${description}`}>
          {value}
        </Typography>
      </Tooltip>
    </Box>
  )
}

const temperature = (actual: number | null | undefined, target: number | null | undefined) =>
  `${actual == null ? 'Unavailable' : `${number(actual)} \u00b0C`} / ${
    target == null ? 'unavailable' : `${number(target)} \u00b0C`
  } target`

export default function LiveStatus({ status, onSetup }: { status: ElementStatus; onSetup(): void }) {
  const snapshot = status.snapshot
  const connection = status.connections.find(item => item.id === status.settings.activeConnectionId)
  return (
    <Paper component="section" aria-labelledby="element-live-heading" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
          <Box>
            <Typography id="element-live-heading" variant="h2" component="h3">
              {connection?.printerName ?? 'Live printer status'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {connection?.printerModel ?? 'Printer model unreported'}
              {connection ? ` / ${connection.printerId}` : ''}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
            <Chip size="small" variant="outlined" label={stateLabels[status.connectionState]}
              color={status.connectionState === 'connected' ? 'success'
                : status.connectionState === 'expired' || status.connectionState === 'error' ? 'error'
                  : status.connectionState === 'offline' ? 'warning' : 'default'} />
            <Button size="small" onClick={onSetup}>Connection setup</Button>
          </Stack>
        </Stack>
        <Typography variant="body2" color={status.freshness === 'stale' ? 'warning.main' : 'text.secondary'}>
          {snapshot
            ? `${status.freshness === 'fresh' ? 'Recent report' : 'Stale / last known report'}: ${
              instant(snapshot.receivedAt, 'UTC')
            } UTC. Field timestamps are available on focus or hover.`
            : 'No live report has been received. Unreported metrics are unavailable, not zero.'}
        </Typography>
        <Box component="dl" sx={{
          m: 0, display: 'grid', gap: 2,
          gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
          '& dd': { overflowWrap: 'anywhere' },
        }}>
          <Metric label="Job state" value={snapshot?.state ?? 'Unavailable'} field="state" snapshot={snapshot} />
          <Metric label="Job name" value={snapshot?.jobName ?? 'Unavailable'} field="jobName" snapshot={snapshot} />
          <Metric label="Progress" value={snapshot?.progressPercent == null ? 'Unavailable' : `${number(snapshot.progressPercent)}%`}
            field="progressPercent" snapshot={snapshot} />
          <Metric label="Time remaining" value={snapshot?.remainingMinutes == null ? 'Unavailable' : `${number(snapshot.remainingMinutes, 0)} min`}
            field="remainingMinutes" snapshot={snapshot} />
          <Metric label="Layer / total" value={`${number(snapshot?.currentLayer ?? null, 0)} / ${number(snapshot?.totalLayers ?? null, 0)}`}
            field="currentLayer" snapshot={snapshot} />
          <Metric label="Nozzle" value={temperature(snapshot?.nozzleActualC, snapshot?.nozzleTargetC)}
            field="nozzleActualC" snapshot={snapshot} />
          <Metric label="Bed" value={temperature(snapshot?.bedActualC, snapshot?.bedTargetC)}
            field="bedActualC" snapshot={snapshot} />
          <Metric label="Wi-Fi signal" value={snapshot?.wifiSignalDbm == null ? 'Unavailable' : `${number(snapshot.wifiSignalDbm, 0)} dBm`}
            field="wifiSignalDbm" snapshot={snapshot} />
          <Metric label="Print error" value={snapshot?.printError === '0' ? 'None reported (0)' : snapshot?.printError ?? 'Unavailable'}
            field="printError" snapshot={snapshot} />
          <Metric label="HMS information" value={snapshot?.hms == null ? 'Unavailable'
            : snapshot.hms.length === 0 ? 'No issues reported' : snapshot.hms.map(issue => issue.code).join(', ')}
          field="hms" snapshot={snapshot} />
        </Box>
        {snapshot?.progressPercent != null && (
          <LinearProgress variant="determinate" value={snapshot.progressPercent}
            aria-label="Reported print progress" />
        )}
        <Box>
          <Typography variant="h3" component="h4" sx={{ mb: 1 }}>AMS and external spool</Typography>
          {snapshot?.ams == null ? (
            <Typography variant="body2" color="text.secondary">Slot information has not been reported.</Typography>
          ) : snapshot.ams.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No slots were included in the latest AMS report.</Typography>
          ) : (
            <TableContainer tabIndex={0} aria-label="Reported filament slots" sx={{ maxWidth: '100%' }}>
              <Table size="small" sx={{ minWidth: 540 }}>
                <TableHead><TableRow>
                  <TableCell>Slot</TableCell><TableCell>Material / sub-brand</TableCell>
                  <TableCell>Colour</TableCell><TableCell align="right">Remaining</TableCell><TableCell>State</TableCell>
                </TableRow></TableHead>
                <TableBody>{snapshot.ams.map(slot => (
                  <TableRow key={`${slot.amsId}/${slot.slotId}`}>
                    <TableCell>{slot.amsId === 'external' ? 'External' : `AMS ${slot.amsId}`} / {slot.slotId}</TableCell>
                    <TableCell>{slot.material ?? 'Unavailable'}{slot.subBrand ? ` / ${slot.subBrand}` : ''}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        {slot.color && /^#?[0-9a-f]{6}([0-9a-f]{2})?$/i.test(slot.color) && (
                          <Box aria-hidden="true" sx={{
                            width: 16, height: 16, border: '1px solid', borderColor: 'divider',
                            bgcolor: `#${slot.color.replace('#', '')}`, borderRadius: '50%', flexShrink: 0,
                          }} />
                        )}
                        <span>{slot.color ?? 'Unavailable'}</span>
                      </Stack>
                    </TableCell>
                    <TableCell align="right">{slot.remainingPercent === null ? 'Unavailable' : `${number(slot.remainingPercent)}%`}</TableCell>
                    <TableCell>{slot.empty === null ? 'Unreported' : slot.empty ? 'Empty' : 'Present'}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      </Stack>
    </Paper>
  )
}
