// App-owned theme.
//
// A workbench, not a showcase: flat surfaces, one hairline border weight, a
// single accent reserved for the active tool and primary action, and type that
// stays legible next to a technical drawing. No translucency, no blur, no
// gradient fills, no decorative shadows.
//
// Contrast targets: body text >= 7:1 on its surface, secondary text >= 4.5:1,
// borders >= 3:1 against the surface they separate, and a 2px focus ring that
// is visible in both modes.
import { createTheme } from '@mui/material/styles'
import type { Theme } from '@mui/material/styles'

export type ThemeMode = 'light' | 'dark'

const light = {
  canvas: '#F2F1EE',
  surface: '#FFFFFF',
  surfaceSunken: '#E9E7E2',
  border: '#C4C0B8',
  borderStrong: '#8D887E',
  text: '#1B1A18',
  textMuted: '#565149',
  accent: '#1F5C8B',
  accentText: '#FFFFFF',
  danger: '#9B2C2C',
  warning: '#8A5A00',
  success: '#1F6B45',
}

const dark = {
  canvas: '#16171A',
  surface: '#1E2024',
  surfaceSunken: '#121316',
  border: '#3A3E45',
  borderStrong: '#5E646E',
  text: '#EDEDEC',
  textMuted: '#A9AEB6',
  accent: '#79B6E4',
  accentText: '#10161C',
  danger: '#F09393',
  warning: '#E3B457',
  success: '#7FCBA1',
}

export const palettes = { light, dark } as const

/** One radius, one border weight, one motion duration. Repetition is the point. */
export const RADIUS = 6
export const BORDER = 1

export function buildTheme(mode: ThemeMode): Theme {
  const c = palettes[mode]

  return createTheme({
    cssVariables: false,
    palette: {
      mode,
      background: { default: c.canvas, paper: c.surface },
      text: { primary: c.text, secondary: c.textMuted },
      primary: { main: c.accent, contrastText: c.accentText },
      error: { main: c.danger },
      warning: { main: c.warning },
      success: { main: c.success },
      divider: c.border,
    },
    shape: { borderRadius: RADIUS },
    typography: {
      fontFamily:
        '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      fontSize: 14,
      h1: { fontSize: '1.5rem', fontWeight: 600, letterSpacing: '-0.01em' },
      h2: { fontSize: '1.125rem', fontWeight: 600, letterSpacing: '-0.005em' },
      h3: { fontSize: '0.9375rem', fontWeight: 600 },
      body1: { fontSize: '0.875rem', lineHeight: 1.55 },
      body2: { fontSize: '0.8125rem', lineHeight: 1.5 },
      button: { textTransform: 'none', fontWeight: 550 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          ':root': { colorScheme: mode },
          body: { backgroundColor: c.canvas },
          // Honour the OS setting globally rather than per component.
          '@media (prefers-reduced-motion: reduce)': {
            '*, *::before, *::after': {
              animationDuration: '0.01ms !important',
              animationIterationCount: '1 !important',
              transitionDuration: '0.01ms !important',
              scrollBehavior: 'auto !important',
            },
          },
          // One focus treatment everywhere, never removed.
          ':focus-visible': {
            outline: `2px solid ${c.accent}`,
            outlineOffset: '2px',
          },
          '::selection': { background: c.accent, color: c.accentText },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: `${BORDER}px solid ${c.border}`,
          },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0, color: 'default' },
        styleOverrides: {
          root: {
            backgroundColor: c.surface,
            borderBottom: `${BORDER}px solid ${c.border}`,
            borderRadius: 0,
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: RADIUS, minHeight: 32 },
          outlined: { borderColor: c.borderStrong },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            borderColor: c.border,
            paddingBlock: 4,
            '&.Mui-selected': {
              backgroundColor: mode === 'dark' ? '#2A3138' : '#DCE7F0',
              color: c.text,
            },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: RADIUS, backgroundColor: c.surface },
          notchedOutline: { borderColor: c.border },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: RADIUS },
          outlined: { borderColor: c.border },
        },
      },
      MuiTooltip: {
        // `describeChild` keeps the tooltip as a description rather than
        // replacing the control's accessible name. Without it MUI sets the
        // title as `aria-label`, so a button reading "Show plate" would be
        // announced as its help text and fail WCAG 2.5.3 (label in name).
        defaultProps: { enterDelay: 400, describeChild: true },
        styleOverrides: {
          tooltip: {
            backgroundColor: mode === 'dark' ? '#33383F' : '#2C2A26',
            fontSize: '0.75rem',
            borderRadius: RADIUS,
            maxWidth: 320,
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: { borderRadius: RADIUS, border: `${BORDER}px solid currentColor` },
        },
      },
      MuiDialog: {
        styleOverrides: { paper: { borderRadius: RADIUS } },
      },
      MuiListItemButton: {
        styleOverrides: { root: { borderRadius: RADIUS } },
      },
      MuiLink: {
        defaultProps: { underline: 'always' },
      },
    },
  })
}
