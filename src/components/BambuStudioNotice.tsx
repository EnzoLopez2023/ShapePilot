// The one place "Open in Bambu Studio" reports back, whichever designer sent it.
import { useEffect, useState } from 'react'
import { Alert, Button, CircularProgress, Snackbar, Stack, Typography } from '@mui/material'
import { STUDIO_EVENT, type StudioStatus } from '../export/bambuStudio.ts'

export default function BambuStudioNotice() {
  const [status, setStatus] = useState<StudioStatus | null>(null)
  useEffect(() => {
    const listen = (event: Event) => setStatus((event as CustomEvent<StudioStatus>).detail)
    window.addEventListener(STUDIO_EVENT, listen)
    return () => window.removeEventListener(STUDIO_EVENT, listen)
  }, [])
  const close = () => setStatus(null)
  if (!status) return null

  return (
    <Snackbar
      open anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      autoHideDuration={status.state === 'uploading' ? null : 12_000} onClose={close}
    >
      {status.state === 'uploading' ? (
        <Alert severity="info" icon={<CircularProgress size={18} />}>Sending {status.name} to Bambu Studio…</Alert>
      ) : status.state === 'failed' ? (
        <Alert severity="error" onClose={close}>Could not send {status.name}: {status.message}</Alert>
      ) : (
        <Alert
          severity="success" onClose={close}
          action={<Button color="inherit" size="small" href={status.link}>Open again</Button>}
        >
          <Stack>
            <span>Opening {status.name} in Bambu Studio.</span>
            <Typography variant="caption">
              Studio will ask whether to open a file from ShapePilot: choose Yes. Nothing happened? Make sure Studio is installed, then press Open again. The link works for 15 minutes.
            </Typography>
          </Stack>
        </Alert>
      )}
    </Snackbar>
  )
}
