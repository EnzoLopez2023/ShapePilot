import { useState } from 'react'
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, MenuItem,
  Stack, TextField, Typography,
} from '@mui/material'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import type { ElementAccount, ElementStatus } from '../../../../lib/contracts/elementStatistics.ts'
import { errorMessage } from '../../../services/errors.ts'
import { configureElementConnection, discoverElementConnection } from './service.ts'
import { instant } from './format.ts'

interface Props {
  status: ElementStatus
  expanded: boolean
  onExpanded(value: boolean): void
  onChanged(): void
}

export default function ConnectionPanel({ status, expanded, onExpanded, onChanged }: Props) {
  const [account, setAccount] = useState<ElementAccount | null>(null)
  const [printerId, setPrinterId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const verify = async () => {
    onExpanded(true)
    setBusy('Verifying connection...')
    setError(null)
    setMessage(null)
    setAccount(null)
    setPrinterId('')
    try {
      const discovered = await discoverElementConnection()
      setAccount(discovered)
      if (discovered.printers.length === 1) setPrinterId(discovered.printers[0].id)
      onChanged()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(null)
    }
  }
  const save = async (enabled: boolean) => {
    onExpanded(true)
    setBusy(enabled ? 'Enabling monitoring...' : 'Disabling monitoring...')
    setError(null)
    setMessage(null)
    try {
      await configureElementConnection(enabled
        ? { enabled, accountId: account?.accountId, printerId } : { enabled })
      setMessage(enabled
        ? 'Monitoring is enabled. Available cloud history will import in the background.'
        : 'Monitoring is disabled. Previously recorded jobs and reports are retained.')
      onChanged()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(null)
    }
  }
  return (
    <Accordion expanded={expanded} onChange={(_event, value) => onExpanded(value)}
      disableGutters sx={{ '&::before': { display: 'none' } }}>
      <AccordionSummary id="element-connection-heading" aria-controls="element-connection-body"
        expandIcon={<ExpandMoreRoundedIcon />}>
        <Typography variant="h2" component="h3">Household printer connection</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2} sx={{ maxWidth: 850 }}>
          <Typography>
            One server-held Bambu account, one selected household printer. Only ShapePilot
            administrators can view its status, history or reports.
          </Typography>
          <Box component="ol" sx={{ m: 0, pl: 3, '& li + li': { mt: 1 }, overflowWrap: 'anywhere' }}>
            <li>
              Store a Bambu Cloud access token in the server secret store as{' '}
              <Box component="code">SHAPEPILOT_BAMBU_ACCESS_TOKEN</Box>. Do not paste credentials
              into this page, a URL, browser storage or source control.
            </li>
            <li>
              Set <Box component="code">SHAPEPILOT_BAMBU_REGION</Box> to{' '}
              <Box component="code">global</Box> or <Box component="code">china</Box>,
              matching the account. Restart ShapePilot after changing server configuration.
            </li>
            <li>Verify the configured account below, select a bound printer, then enable monitoring.</li>
          </Box>
          <Typography variant="body2" color="text.secondary">
            Server credential: {status.credential.configured ? 'Configured (value never returned)' : 'Not available'}.{' '}
            Region: {status.credential.region}.{' '}
            Token expiry: {status.credential.expiresAt
              ? instant(status.credential.expiresAt, 'UTC') + ' UTC'
              : 'Unreported; verification can still fail if the token has expired'}.
          </Typography>
          {status.problem && <Alert severity={status.connectionState === 'unconfigured' ? 'info' : 'warning'}>
            {status.problem.message}
          </Alert>}
          {error && <Alert severity="error">{error}</Alert>}
          {message && <Alert severity="success">{message}</Alert>}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
            <Button variant="outlined" onClick={() => void verify()}
              disabled={!status.credential.configured || busy !== null}>
              Verify connection
            </Button>
            {status.settings.enabled && (
              <Button onClick={() => void save(false)} disabled={busy !== null}>
                Disable monitoring
              </Button>
            )}
            {busy && <Typography role="status" variant="body2">{busy}</Typography>}
          </Stack>
          {account && (
            <Stack spacing={2}>
              <Typography>
                Verified account: <strong>{account.name ?? account.accountId}</strong>{' '}
                (ID {account.accountId}, {account.region}).
              </Typography>
              {account.printers.length === 0 ? (
                <Alert severity="info">
                  This account has no bound printers. Bind your printer in Bambu Handy or
                  Bambu Studio using this account, then verify again.
                </Alert>
              ) : (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
                  <TextField select size="small" label="Verified household printer" value={printerId}
                    onChange={event => setPrinterId(event.target.value)}
                    sx={{ minWidth: { sm: 280 }, flex: 1 }}>
                    {account.printers.map(printer => (
                      <MenuItem key={printer.id} value={printer.id}>
                        {printer.name} ({printer.model ?? 'model unreported'}) / {printer.id}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button variant="contained" disabled={!printerId || busy !== null}
                    onClick={() => void save(true)}>
                    {status.settings.enabled ? 'Use this printer' : 'Enable monitoring'}
                  </Button>
                </Stack>
              )}
            </Stack>
          )}
          <Typography variant="body2" color="text.secondary">
            Rotation: replace the token in the server secret store, restart ShapePilot, then verify
            again. Bambu token refresh is not relied on. A different account or printer requires
            a new selection and gets its own history partition; earlier records remain available.
            No printer commands, camera stream or filament inventory adjustments are made.
          </Typography>
        </Stack>
      </AccordionDetails>
    </Accordion>
  )
}
