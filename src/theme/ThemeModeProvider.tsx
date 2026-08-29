import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { buildTheme } from './theme.ts'
import type { ThemeMode } from './theme.ts'

export type ThemePreference = 'light' | 'dark' | 'system'

interface ThemeModeContextValue {
  preference: ThemePreference
  mode: ThemeMode
  setPreference: (preference: ThemePreference) => void
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null)

const STORAGE_KEY = 'shapepilot:appearance'

const readStored = (): ThemePreference => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
  } catch {
    return 'system'
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
}

export function ThemeModeProvider({ children, initialPreference }: ThemeModeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    () => initialPreference ?? readStored())
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

  const mode: ThemeMode = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
  const theme = useMemo(() => buildTheme(mode), [mode])
  const value = useMemo(
    () => ({ preference, mode, setPreference }), [preference, mode, setPreference])

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
