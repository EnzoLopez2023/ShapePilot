// App-owned theme. iOS-mode by intent.
//
// There is no Ionic in this stack, so `mode: 'ios'` is expressed here instead:
// this MUI theme is the single bootstrap that forces the whole app into the
// native-iOS idiom — one squircle radius (14px), Apple-style timing, and a
// frosted-glass treatment reserved for app chrome (the sidebar and the mobile
// bar). Working surfaces that sit over a technical drawing stay opaque so the
// drawing underneath stays readable; the glass tokens below are consumed only
// by the shell.
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

/** One squircle radius, one border weight. iOS uses ~14px on cards and rows. */
export const RADIUS = 14
export const BORDER = 1

/** Apple-style easing for chrome transitions (menus, drawer, hover fades). */
export const EASE_IOS = 'cubic-bezier(0.32, 0.72, 0, 1)'

/**
 * Frosted-glass tokens for app chrome only (sidebar, mobile bar). `backdrop`
 * needs the paired `-webkit-` value at the call site for Safari.
 */
export const GLASS = {
  light: {
    fill: 'rgba(255, 255, 255, 0.4)',
    fillHover: 'rgba(255, 255, 255, 0.15)',
    fillActive: 'rgba(255, 255, 255, 0.55)',
    border: 'rgba(255, 255, 255, 0.35)',
    backdrop: 'blur(20px) saturate(180%)',
  },
  dark: {
    fill: 'rgba(28, 28, 30, 0.55)',
    fillHover: 'rgba(255, 255, 255, 0.08)',
    fillActive: 'rgba(255, 255, 255, 0.14)',
    border: 'rgba(255, 255, 255, 0.12)',
    backdrop: 'blur(20px) saturate(180%)',
  },
} as const

/**
 * Card lift. Every `Paper` (and the sidebar) carries this so surfaces read as
 * floating above the canvas rather than inlaid into it. Two layers: a soft
 * ambient pool and a tighter contact shadow.
 */
export const SHADOW = {
  light:
    '0 12px 32px -14px rgba(23, 23, 40, 0.28), 0 4px 10px -6px rgba(23, 23, 40, 0.16)',
  dark: '0 12px 32px -14px rgba(0, 0, 0, 0.72), 0 4px 10px -6px rgba(0, 0, 0, 0.55)',
} as const

export function buildTheme(mode: ThemeMode): Theme {
  const c = palettes[mode]
  const shadow = SHADOW[mode]

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
          // A faint wash so the frosted sidebar has depth to refract. The base
          // colour is unchanged; the gradients are near-invisible on content.
          body: {
            backgroundColor: c.canvas,
            backgroundImage:
              mode === 'dark'
                ? 'radial-gradient(1200px 800px at 100% 0%, rgba(121,182,228,0.10), transparent 60%), radial-gradient(1000px 700px at 0% 100%, rgba(121,182,228,0.06), transparent 55%)'
                : 'radial-gradient(1200px 800px at 100% 0%, rgba(31,92,139,0.10), transparent 60%), radial-gradient(1000px 700px at 0% 100%, rgba(31,92,139,0.05), transparent 55%)',
            backgroundAttachment: 'fixed',
          },
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
        // `elevation` is left at 0 so MUI's own shadow scale stays out of it;
        // the lift is a single deliberate `boxShadow` from the SHADOW token,
        // applied to every Paper (panels, dialogs, menus) so surfaces float.
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: `${BORDER}px solid ${c.border}`,
            boxShadow: shadow,
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
