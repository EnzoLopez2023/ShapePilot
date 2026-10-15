// Settings → Library: the Macs whose organizer may sync into this account.
//
// A device token is shown once, at creation, and only lets the organizer sync
// the library index; it cannot read anything else. Revoking one stops that Mac
// on its next sync.
import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Divider, Paper, Stack, TextField, Typography,
} from '@mui/material'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import type { LibraryDevice } from '../../../../lib/contracts/library.ts'
import { useConfirm } from '../../../components/ConfirmDialogProvider.tsx'
import { errorMessage } from '../../../services/errors.ts'
import { relativeDate } from '../model/format.ts'
import { createDevice, listDevices, revokeDevice } from '../service.ts'

export default function LibraryDevicesPanel() {
  const confirm = useConfirm()
  const [devices, setDevices] = useState<LibraryDevice[] | null>(null)
  const [name, setName] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    listDevices().then(setDevices).catch(cause => setError(errorMessage(cause)))
  }, [])
  useEffect(load, [load])

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const created = await createDevice(name.trim() || 'Mac')
      setToken(created.token)
      setName('')
      load()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (device: LibraryDevice) => {
    const ok = await confirm({
      title: `Disconnect ${device.name}?`,
      message: 'Its organizer stops syncing on its next run. Its files on the Mac are not touched.',
      confirmLabel: 'Disconnect',
      destructive: true,
    })
    if (!ok) return
    try {
      await revokeDevice(device.id)
      load()
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  const commands = token ? `npm run library -- connect ${token}\nnpm run library -- install` : ''
  const active = devices?.filter(d => !d.revokedAt) ?? []

  return (
    <Stack spacing={1.5} id="library">
      <Box>
        <Typography variant="h2" component="h2">Library</Typography>
        <Typography variant="body2" color="text.secondary">
          Connect the Mac that holds your STL and 3MF files. The token only lets it sync the library index; it cannot
          read anything else.
        </Typography>
      </Box>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {active.length > 0 && (
        <Paper variant="outlined">
          {active.map((device, i) => (
            <Box key={device.id}>
              {i > 0 && <Divider />}
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', p: 1.25 }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{device.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Connected {relativeDate(device.createdAt).toLowerCase()}
                    {device.lastSeenAt ? ` · last synced ${relativeDate(device.lastSeenAt).toLowerCase()}` : ' · not synced yet'}
                  </Typography>
                </Box>
                <Button size="small" color="error" onClick={() => void revoke(device)}>Disconnect</Button>
              </Stack>
            </Box>
          ))}
        </Paper>
      )}
      {token ? (
        <Alert severity="success" onClose={() => setToken(null)}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Run these in the ShapePilot folder on the Mac. The token is shown only now.
          </Typography>
          <Box component="pre" sx={{ m: 0, p: 1, bgcolor: 'action.hover', borderRadius: 1, fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {commands}
          </Box>
          <Button size="small" startIcon={<ContentCopyRoundedIcon />} sx={{ mt: 1 }}
            onClick={() => void navigator.clipboard.writeText(commands)}>
            Copy commands
          </Button>
        </Alert>
      ) : (
        <Stack direction="row" spacing={1} component="form" onSubmit={e => { e.preventDefault(); void create() }}>
          <TextField size="small" label="Device name" placeholder="Studio Mac" value={name} sx={{ flex: 1, maxWidth: 280 }}
            slotProps={{ htmlInput: { maxLength: 80 } }} onChange={e => setName(e.target.value)} />
          <Button type="submit" variant="outlined" disabled={busy}>Create device token</Button>
        </Stack>
      )}
    </Stack>
  )
}
