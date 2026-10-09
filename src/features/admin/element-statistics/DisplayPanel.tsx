import { useEffect, useState } from 'react'
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import type { DisplayGrant } from '../../../../lib/contracts/elementDisplay.ts'
import { apiRequest } from '../../../services/http.ts'
import { errorMessage } from '../../../services/errors.ts'

const base = '/admin/element-displays'
export default function DisplayPanel() {
  const [displays, setDisplays] = useState<DisplayGrant[]>([])
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('XENEON EDGE')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void apiRequest<DisplayGrant[]>(base, { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) { setDisplays(value); setError(null) }
    }).catch(reason => {
      if (!controller.signal.aborted) setError(errorMessage(reason))
    })
    return () => controller.abort()
  }, [revision])
  const action = async (id?: string) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await apiRequest(id ? `${base}/${id}` : `${base}/approve`, {
        method: id ? 'DELETE' : 'POST',
        ...(id ? {} : { body: { code: code.replace(/\s/g, '').toUpperCase(), label: label.trim() } }),
      })
      setMessage(id ? 'Display access revoked.' : 'Display paired. The EDGE will show the current job automatically.')
      if (!id) setCode('')
      setRevision(value => value + 1)
    } catch (reason) { setError(errorMessage(reason)) }
    finally { setBusy(false) }
  }
  return (
    <Paper component="section" aria-labelledby="edge-displays-heading" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Box>
          <Typography id="edge-displays-heading" variant="h2" component="h3">EDGE displays</Typography>
          <Typography color="text.secondary">
            Open /display/element in the widget and start pairing. Approve only a code you can see on your own display.
            Access is read-only, lasts 90 days, and is pinned to the currently selected household printer.
          </Typography>
        </Box>
        {error && <Alert severity="error" action={<Button onClick={() => setRevision(value => value + 1)}>Reload</Button>}>{error}</Alert>}
        {message && <Alert severity="success">{message}</Alert>}
        <Stack component="form" direction={{ xs: 'column', sm: 'row' }} spacing={2}
          onSubmit={event => { event.preventDefault(); void action() }}>
          <TextField label="Display pairing code" value={code} onChange={event => setCode(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 11, autoComplete: 'off' } }} required />
          <TextField label="Display name" value={label} onChange={event => setLabel(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 80 } }} required />
          <Button type="submit" variant="contained" disabled={busy || !/^[a-f0-9]{10}$/i.test(code.replace(/\s/g, '')) || !label.trim()}>
            Approve display
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          These are displays approved by your account. Revocation also takes effect if your admin role is removed.
          Resetting the widget only forgets its local key; revoke it here before sharing or retiring a display.
        </Typography>
        {displays.map(display => (
          <Stack key={display.id} direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography>{display.label}</Typography>
              <Typography variant="body2" color="text.secondary">Expires {new Date(display.expiresAt).toLocaleDateString()}</Typography>
            </Box>
            <Button disabled={busy} color="error" onClick={() => void action(display.id)}>Revoke</Button>
          </Stack>
        ))}
      </Stack>
    </Paper>
  )
}
