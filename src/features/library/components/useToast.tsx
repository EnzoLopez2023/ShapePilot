// One snackbar per page, with an optional action (the organizer's Undo).
import { useCallback, useState } from 'react'
import { Alert, Button, Snackbar } from '@mui/material'
import { errorMessage } from '../../../services/errors.ts'

interface Toast {
  severity: 'success' | 'error' | 'warning' | 'info'
  message: string
  action?: { label: string; onClick: () => void }
}

export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null)
  const show = useCallback((next: Toast) => setToast(next), [])
  const success = useCallback((message: string, action?: Toast['action']) => setToast({ severity: 'success', message, action }), [])
  const failure = useCallback((what: string, cause?: unknown) =>
    setToast({ severity: 'error', message: cause === undefined ? what : `${what}: ${errorMessage(cause)}` }), [])
  const element = (
    <Snackbar
      open={!!toast} autoHideDuration={toast?.action ? 10_000 : 6000} onClose={() => setToast(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      {toast ? (
        <Alert
          severity={toast.severity}
          onClose={() => setToast(null)}
          sx={{ whiteSpace: 'pre-line' }}
          action={toast.action ? (
            <Button color="inherit" size="small" onClick={() => { toast.action!.onClick(); setToast(null) }}>
              {toast.action.label}
            </Button>
          ) : undefined}
        >
          {toast.message}
        </Alert>
      ) : <span />}
    </Snackbar>
  )
  return { show, success, failure, element }
}
