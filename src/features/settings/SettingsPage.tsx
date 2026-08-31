import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Divider, MenuItem, Paper, Snackbar, Stack, TextField, Typography,
} from '@mui/material'
import { useMsal } from '@azure/msal-react'
import { AUTH_ENABLED } from '../../auth/msal.ts'
import { getSettings, putPreferences } from './preferences.ts'
import type { AccountProfile, AppPreferences } from './preferences.ts'
import { useThemeMode } from '../../theme/ThemeModeProvider.tsx'
import { ErrorState, LoadingState } from '../../components/LoadingState.tsx'
import DesignerDefaultsPanel from './DesignerDefaultsPanel.tsx'
import { errorMessage } from '../../services/errors.ts'

const FIELD_WIDTH = 260

export default function SettingsPage() {
  const { preference, setPreference } = useThemeMode()
  const { instance } = useMsal()
  const [preferences, setPreferences] = useState<AppPreferences | null>(null)
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getSettings()
      setPreferences(result.preferences)
      setProfile(result.profile)
      setPreference(result.preferences.themeMode)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [setPreference])

  useEffect(() => { void load() }, [load])

  const update = useCallback(async (patch: Partial<AppPreferences>) => {
    if (!preferences) return
    const next = { ...preferences, ...patch }
    setPreferences(next)
    if (patch.themeMode) setPreference(patch.themeMode)
    try {
      await putPreferences(next)
      setSaved(true)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [preferences, setPreference])

  if (loading) return <LoadingState label="Loading your settings…" />
  if (error && !preferences) return <ErrorState message={error} onRetry={() => void load()} />

  return (
    <Stack spacing={2} sx={{ maxWidth: 760 }}>
      <Typography variant="h1" component="h1">Settings</Typography>

      <Paper sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="h2" component="h2">Appearance</Typography>
          <TextField
            select size="small" label="Theme" sx={{ width: FIELD_WIDTH }}
            value={preferences?.themeMode ?? preference}
            onChange={e => void update({ themeMode: e.target.value as AppPreferences['themeMode'] })}
            helperText="System follows your operating system setting."
          >
            <MenuItem value="system">System</MenuItem>
            <MenuItem value="light">Light</MenuItem>
            <MenuItem value="dark">Dark</MenuItem>
          </TextField>

          <TextField
            select size="small" label="Default units" sx={{ width: FIELD_WIDTH }}
            value={preferences?.units ?? 'mm'}
            onChange={e => void update({ units: e.target.value as AppPreferences['units'] })}
            helperText="Lengths are always stored in millimetres; this only changes how they are shown."
          >
            <MenuItem value="mm">Millimetres</MenuItem>
            <MenuItem value="in">Inches (nearest 1/32&quot;)</MenuItem>
          </TextField>

          <TextField
            select size="small" label="Motion" sx={{ width: FIELD_WIDTH }}
            value={preferences?.reducedMotion ?? 'system'}
            onChange={e => void update({
              reducedMotion: e.target.value as AppPreferences['reducedMotion'],
            })}
            helperText="System honours your operating system's reduced-motion setting."
          >
            <MenuItem value="system">Follow system</MenuItem>
            <MenuItem value="reduce">Reduce motion</MenuItem>
            <MenuItem value="no-preference">Allow motion</MenuItem>
          </TextField>
        </Stack>
      </Paper>

      <Paper sx={{ p: 2 }}>
        {preferences && (
          <DesignerDefaultsPanel
            defaults={preferences.designerDefaults}
            onChange={next => void update({ designerDefaults: next })}
          />
        )}
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <Typography variant="h2" component="h2">Account</Typography>
          <Divider />
          <Box
            component="dl"
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'max-content 1fr' },
              columnGap: 3,
              rowGap: 1,
              m: 0,
            }}
          >
            <Typography component="dt" variant="body2" color="text.secondary">Name</Typography>
            <Typography component="dd" variant="body2" sx={{ m: 0 }}>
              {profile?.displayName ?? '—'}
            </Typography>
            <Typography component="dt" variant="body2" color="text.secondary">Sign-in</Typography>
            <Typography component="dd" variant="body2" sx={{ m: 0 }}>
              {profile?.email ?? '—'}
            </Typography>
            <Typography component="dt" variant="body2" color="text.secondary">Role</Typography>
            <Typography component="dd" variant="body2" sx={{ m: 0 }}>{profile?.role ?? '—'}</Typography>
            <Typography component="dt" variant="body2" color="text.secondary">Object id</Typography>
            <Typography
              component="dd" variant="body2"
              sx={{ m: 0, fontFamily: 'monospace', overflowWrap: 'anywhere' }}
            >
              {profile?.oid ?? '—'}
            </Typography>
          </Box>
          {profile?.authSource === 'development' && (
            <Alert severity="warning">
              This server is running with the development authentication bypass. It is
              refused when NODE_ENV=production.
            </Alert>
          )}

          <Divider />
          <Box>
            <Button
              variant="outlined"
              disabled={!AUTH_ENABLED}
              onClick={() => {
                // Redirect rather than popup, matching how signing in works, and
                // it ends the session at Microsoft rather than only locally --
                // clearing this browser alone would leave the next sign-in
                // silently reusing the same account.
                void instance.logoutRedirect({ account: instance.getActiveAccount() })
              }}
            >
              Sign out
            </Button>
            {!AUTH_ENABLED && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                There is no session to end: this build runs with the development
                authentication bypass.
              </Typography>
            )}
          </Box>
        </Stack>
      </Paper>

      <Box>
        <Button onClick={() => void load()}>Reload settings</Button>
      </Box>

      <Snackbar
        open={saved} autoHideDuration={2000} onClose={() => setSaved(false)} message="Settings saved"
      />
      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
      </Snackbar>
    </Stack>
  )
}
