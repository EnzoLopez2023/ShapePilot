import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { buildTheme } from './theme.ts'
import type { ThemeMode } from './theme.ts'
import { DEFAULT_THEME_PALETTE } from './palettes.ts'
import type { ThemePaletteId } from './palettes.ts'
import { isThemePaletteId } from '../../lib/contracts/themePalettes.ts'

export type ThemePreference = 'light' | 'dark' | 'system'

interface ThemeModeContextValue {
  preference: ThemePreference
  mode: ThemeMode
  setPreference: (preference: ThemePreference) => void
  /** The colour palette, independent of light/dark: every palette has both. */
  palette: ThemePaletteId
  setPalette: (palette: ThemePaletteId) => void
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null)

const STORAGE_KEY = 'shapepilot:appearance'
const PALETTE_KEY = 'shapepilot:palette'

// Light is the out-of-the-box default. `system` and `dark` are still honoured
// once the user picks them (here or in Settings); only the unset state changed.
const readStored = (): ThemePreference => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'light'
  } catch {
    return 'light'
  }
}

// Kept locally as well as on the server so the first paint is already in the
// chosen palette, before the settings request has had a chance to answer.
const readStoredPalette = (): ThemePaletteId => {
  try {
    const raw = localStorage.getItem(PALETTE_KEY)
    return isThemePaletteId(raw) ? raw : DEFAULT_THEME_PALETTE
  } catch {
    return DEFAULT_THEME_PALETTE
  }
}

const prefersDark = (): boolean => {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  } catch {
    return false
  }
}

export interface ThemeModeProviderProps {
  children: ReactNode
  /** Test seam so a suite can pin the mode without touching matchMedia. */
  initialPreference?: ThemePreference
  initialPalette?: ThemePaletteId
}

export function ThemeModeProvider(
  { children, initialPreference, initialPalette }: ThemeModeProviderProps,
) {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    () => initialPreference ?? readStored())
  const [palette, setPaletteState] = useState<ThemePaletteId>(
    () => initialPalette ?? readStoredPalette())
  const [systemDark, setSystemDark] = useState(prefersDark)

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!query) return
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, [])

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* private mode etc. */ }
  }, [])

  const setPalette = useCallback((next: ThemePaletteId) => {
    setPaletteState(next)
    try { localStorage.setItem(PALETTE_KEY, next) } catch { /* private mode etc. */ }
  }, [])

  const mode: ThemeMode = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
  const theme = useMemo(() => buildTheme(mode, palette), [mode, palette])
  const value = useMemo(
    () => ({ preference, mode, setPreference, palette, setPalette }),
    [preference, mode, setPreference, palette, setPalette])

  return (
    <ThemeModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  )
}

export function useThemeMode(): ThemeModeContextValue {
  const value = useContext(ThemeModeContext)
  if (!value) throw new Error('useThemeMode must be used inside ThemeModeProvider')
  return value
}
