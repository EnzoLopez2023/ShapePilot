import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
} from '@mui/material'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Confirm | null>(null)

/** Every destructive action in the app goes through this one dialog. */
export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback<Confirm>((next) => {
    setOptions(next)
    return new Promise<boolean>((resolve) => { resolver.current = resolve })
  }, [])

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value)
    resolver.current = null
    setOptions(null)
  }, [])

  const value = useMemo(() => confirm, [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog
        open={options !== null}
        onClose={() => settle(false)}
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle id="confirm-title">{options?.title}</DialogTitle>
        <DialogContent>
          <DialogContentText id="confirm-message">{options?.message}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => settle(false)}>{options?.cancelLabel ?? 'Cancel'}</Button>
          <Button
            variant="contained"
            color={options?.destructive ? 'error' : 'primary'}
            onClick={() => settle(true)}
            autoFocus
          >
            {options?.confirmLabel ?? 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): Confirm {
  const value = useContext(ConfirmContext)
  if (!value) throw new Error('useConfirm must be used inside ConfirmDialogProvider')
  return value
}
