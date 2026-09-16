// Turning reorder reminders on for this device.
//
// Every state says what it means and, where there is one, what to do next:
// the server has no signing key, this browser cannot receive push, this is an
// iPhone that needs ShapePilot on its Home Screen first, notifications are
// blocked, or reminders are on and can be tested. A switch that silently does
// nothing on half the devices it appears on would be worse than no switch.
import { useCallback, useEffect, useState } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded'
import {
  PushSetupError, currentSubscription, disablePush, enablePush, getPushConfig, pushSupport,
  sendTestPush,
} from '../push.ts'
import type { PushServerConfig } from '../push.ts'

type State =
  | { kind: 'loading' }
  | { kind: 'hidden' }
  | { kind: 'server-off' }
  | { kind: 'install-first' }
  | { kind: 'unsupported' }
  | { kind: 'off'; publicKey: string }
  | { kind: 'on'; publicKey: string }

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : 'That did not work.'

export default function ReminderControl() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    let config: PushServerConfig
    try {
      config = await getPushConfig()
    } catch {
      setState({ kind: 'hidden' })
      return
    }
    if (!config.eligible) return setState({ kind: 'hidden' })
    if (!config.enabled || !config.publicKey) return setState({ kind: 'server-off' })
    const support = pushSupport()
    if (support !== 'supported') return setState({ kind: support })
    const subscription = await currentSubscription().catch(() => null)
    const granted = Notification.permission === 'granted'
    setState({ kind: subscription && granted ? 'on' : 'off', publicKey: config.publicKey })
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const act = (work: () => Promise<string | null>) => {
    setBusy(true)
    setNote(null)
    void work()
      .then(message => setNote(message))
      .catch(error => setNote(error instanceof PushSetupError ? error.message : messageOf(error)))
      .finally(() => { setBusy(false); void refresh() })
  }

  if (state.kind === 'loading' || state.kind === 'hidden') return null

  let text: string
  let action: React.ReactNode = null
  switch (state.kind) {
    case 'server-off':
      text = 'Reorder reminders are not set up on this server yet.'
      break
    case 'install-first':
      text = 'To get reminders on this iPhone or iPad, add ShapePilot to your Home Screen from '
        + 'the Share menu, open it from there, and turn them on.'
      break
    case 'unsupported':
      text = 'This browser cannot receive push notifications.'
      break
    case 'off':
      text = 'Get a notification on this device when a loaded filament needs reordering.'
      action = (
        <Button size="small" variant="outlined" disabled={busy}
          onClick={() => act(async () => { await enablePush(state.publicKey); return 'Reminders are on for this device.' })}>
          Turn on reminders
        </Button>
      )
      break
    case 'on':
      text = 'Reminders are on for this device.'
      action = (
        <Stack direction="row" sx={{ gap: 1 }}>
          <Button size="small" disabled={busy}
            onClick={() => act(async () => {
              const result = await sendTestPush()
              return result.sent > 0
                ? 'Test sent. It should arrive in a few seconds.'
                : 'The test did not reach any of your devices.'
            })}>
            Send a test
          </Button>
          <Button size="small" color="inherit" disabled={busy}
            onClick={() => act(async () => { await disablePush(); return 'Reminders are off for this device.' })}>
            Turn off
          </Button>
        </Stack>
      )
      break
  }

  return (
    <Box
      component="section"
      aria-label="Reorder reminders"
      sx={{ mt: 2, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, alignItems: { sm: 'center' } }}>
        <Stack direction="row" sx={{ gap: 1, alignItems: 'flex-start', flex: 1 }}>
          <NotificationsActiveRoundedIcon fontSize="small" sx={{ color: 'text.secondary', mt: 0.25 }} aria-hidden />
          <Typography variant="body2" color="text.secondary">{text}</Typography>
        </Stack>
        {action}
      </Stack>
      {note && (
        <Typography variant="body2" role="status" sx={{ mt: 0.75 }}>{note}</Typography>
      )}
    </Box>
  )
}
