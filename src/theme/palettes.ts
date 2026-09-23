// Every palette the workbench can wear, in both modes.
//
// Workbench is the original, hand-tuned set and is spelled out token by token.
// Every other palette is five colours -- a deep base, a mid-tone, a soft tone,
// a paper tone and an accent -- and its light and dark tokens are *derived*
// from them. Derivation is what keeps this list cheap to grow, and it is also
// where the contrast targets in theme.ts are enforced: a seed colour that would
// miss its target is walked toward the palette's own ink (or paper) until it
// clears, so no palette can ship unreadable text however its seeds are chosen.
// palettes.test.ts holds every palette, in both modes, to those targets.
import { DEFAULT_THEME_PALETTE, THEME_PALETTE_IDS } from '../../lib/contracts/themePalettes.ts'
import type { ThemePaletteId } from '../../lib/contracts/themePalettes.ts'

export { DEFAULT_THEME_PALETTE, THEME_PALETTE_IDS }
export type { ThemePaletteId }

export type ThemeMode = 'light' | 'dark'

export interface PaletteTokens {
  canvas: string
  surface: string
  surfaceSunken: string
  border: string
  borderStrong: string
  text: string
  textMuted: string
  accent: string
  accentText: string
  danger: string
  warning: string
  success: string
  /** Fill behind a selected toggle. */
  selected: string
  /** Tooltip ground; its text is always white. */
  tooltip: string
}

export interface PaletteSeed {
  base: string
  mid: string
  soft: string
  paper: string
  accent: string
  /** An accent for dark mode when lightening `accent` would muddy it. */
  accentDark?: string
}

export interface PaletteDefinition {
  id: ThemePaletteId
  name: string
  /** One line on the mood, shown under the name in Settings. */
  blurb: string
  /** The five colours shown on the palette's card, darkest first. */
  swatches: readonly string[]
  light: PaletteTokens
  dark: PaletteTokens
}

// ---- colour arithmetic -----------------------------------------------------

type Rgb = [number, number, number]

const parse = (hex: string): Rgb => {
  const h = hex.replace('#', '')
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as Rgb
}

const format = ([r, g, b]: Rgb): string =>
  `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`

/** `a` moved `t` of the way toward `b`, in sRGB. */
export const mix = (a: string, b: string, t: number): string => {
  const x = parse(a)
  const y = parse(b)
  return format([0, 1, 2].map(i => x[i] + (y[i] - x[i]) * t) as Rgb)
}

const channel = (v: number) => {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export const luminance = (hex: string): number => {
  const [r, g, b] = parse(hex).map(channel)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 contrast ratio. */
export const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * `fg`, walked toward `toward` in small steps until it reaches `target`
 * contrast against every one of `grounds`. The seed's hue survives as long as
 * possible; only if `toward` itself cannot clear does it fall back to pure
 * black or white.
 */
export const ensureContrast = (
  fg: string, grounds: readonly string[], target: number, toward: string,
): string => {
  const clears = (c: string) => grounds.every(g => contrast(c, g) >= target)
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const candidate = mix(fg, toward, Math.min(t, 1))
    if (clears(candidate)) return candidate
  }
  const lightGround = grounds.every(g => luminance(g) > 0.18)
  return lightGround ? '#000000' : '#FFFFFF'
}

/** The darker of the two, walked down until its luminance is at most `max`. */
const darkenTo = (hex: string, max: number): string => {
  let out = hex
  for (let t = 0; luminance(out) > max && t <= 1; t += 0.05) out = mix(hex, '#000000', t)
  return out
}

/** Whichever of the candidates reads best on `ground`. */
const bestOn = (ground: string, ...candidates: string[]) =>
  candidates.reduce((a, b) => (contrast(b, ground) > contrast(a, ground) ? b : a))

// ---- derivation ------------------------------------------------------------

/** Semantic colours stay put across palettes: red has to mean red. */
const SEMANTIC = {
  light: { danger: '#9B2C2C', warning: '#8A5A00', success: '#1F6B45' },
  dark: { danger: '#F09393', warning: '#E3B457', success: '#7FCBA1' },
} as const

export function deriveLight(seed: PaletteSeed): PaletteTokens {
  const surface = mix(seed.paper, '#FFFFFF', 0.55)
  const canvas = mix(seed.paper, seed.soft, 0.3)
  const surfaceSunken = mix(seed.paper, seed.soft, 0.55)
  const grounds = [surface, canvas, surfaceSunken]
  const ink = ensureContrast(seed.base, grounds, 7, '#000000')
  const accent = ensureContrast(seed.accent, [surface, canvas], 4.5, ink)
  return {
    canvas,
    surface,
    surfaceSunken,
    border: ensureContrast(mix(surface, seed.mid, 0.45), [surface], 1.6, ink),
    borderStrong: ensureContrast(mix(surface, seed.mid, 0.9), [surface], 3, ink),
    text: ink,
    textMuted: ensureContrast(mix(ink, seed.mid, 0.55), grounds, 4.5, ink),
    accent,
    accentText: bestOn(accent, '#FFFFFF', ink),
    ...guard(SEMANTIC.light, grounds, '#000000'),
    selected: mix(surface, accent, 0.16),
    tooltip: darkenTo(ink, 0.03),
  }
}

export function deriveDark(seed: PaletteSeed): PaletteTokens {
  const canvas = darkenTo(seed.base, 0.012)
  const surface = mix(canvas, seed.mid, 0.1)
  const surfaceSunken = mix(canvas, '#000000', 0.3)
  const grounds = [surface, canvas, surfaceSunken]
  const ink = ensureContrast(seed.paper, grounds, 7, '#FFFFFF')
  const accent = ensureContrast(seed.accentDark ?? seed.accent, [surface, canvas], 4.5, ink)
  return {
    canvas,
    surface,
    surfaceSunken,
    border: ensureContrast(mix(surface, seed.mid, 0.3), [surface], 1.6, ink),
    borderStrong: ensureContrast(mix(surface, seed.mid, 0.6), [surface], 3, ink),
    text: ink,
    textMuted: ensureContrast(mix(ink, seed.mid, 0.45), grounds, 4.5, ink),
    accent,
    accentText: bestOn(accent, canvas, '#FFFFFF'),
    ...guard(SEMANTIC.dark, grounds, '#FFFFFF'),
    selected: mix(surface, accent, 0.2),
    tooltip: mix(surface, seed.paper, 0.14),
  }
}

/** Semantic colours, nudged only if a palette's ground would swallow them. */
const guard = <T extends Record<string, string>>(
  colours: T, grounds: readonly string[], toward: string,
): T => Object.fromEntries(
  Object.entries(colours).map(([k, v]) => [k, ensureContrast(v, grounds, 4.5, toward)]),
) as T

// ---- the palettes ----------------------------------------------------------

const WORKBENCH: PaletteDefinition = {
  id: 'workbench',
  name: 'Workbench',
  blurb: 'The original: drafting paper and engineering blue',
  swatches: ['#1B1A18', '#8D887E', '#E9E7E2', '#FFFFFF', '#1F5C8B'],
  light: {
    canvas: '#F2F1EE',
    surface: '#FFFFFF',
    surfaceSunken: '#E9E7E2',
    border: '#C4C0B8',
    borderStrong: '#8D887E',
    text: '#1B1A18',
    textMuted: '#565149',
    accent: '#1F5C8B',
    accentText: '#FFFFFF',
    ...SEMANTIC.light,
    selected: '#DCE7F0',
    tooltip: '#2C2A26',
  },
  dark: {
    canvas: '#16171A',
    surface: '#1E2024',
    surfaceSunken: '#121316',
    border: '#3A3E45',
    borderStrong: '#5E646E',
    text: '#EDEDEC',
    textMuted: '#A9AEB6',
    accent: '#79B6E4',
    accentText: '#10161C',
    ...SEMANTIC.dark,
    selected: '#2A3138',
    tooltip: '#33383F',
  },
}

const SEEDED: ReadonlyArray<{
  id: ThemePaletteId, name: string, blurb: string, seed: PaletteSeed
}> = [
  {
    id: 'maison', name: 'Maison', blurb: 'Espresso, taupe and a muted gold',
    seed: { base: '#1C1714', mid: '#8B7765', soft: '#D8C8B4', paper: '#F5EFE6', accent: '#B99A5B' },
  },
  {
    id: 'overcast', name: 'Overcast', blurb: 'Cocoa and mocha under a clear sky',
    seed: {
      base: '#4A3028', mid: '#967060', soft: '#A9D8FF', paper: '#F3FAFF', accent: '#426B8F',
      accentDark: '#A9D8FF',
    },
  },
  {
    id: 'lavender', name: 'Lavender', blurb: 'Lilac mist with a mauve accent',
    seed: {
      base: '#2A1E1A', mid: '#8B7D75', soft: '#D8C8FF', paper: '#F0E9FF', accent: '#A47CA5',
      accentDark: '#D8C8FF',
    },
  },
  {
    id: 'grove', name: 'Grove', blurb: 'Olive, moss and peach cream',
    seed: { base: '#3D4A2F', mid: '#6A4C3B', soft: '#FFD8BF', paper: '#FFF4E9', accent: '#7C8A5B' },
  },
  {
    id: 'cobalt', name: 'Cobalt', blurb: 'Deep navy and a confident cobalt',
    seed: { base: '#111C44', mid: '#B7AD9E', soft: '#D8E3FF', paper: '#F8F1E4', accent: '#2457FF' },
  },
  {
    id: 'aurora', name: 'Aurora', blurb: 'Carbon black and signal green',
    seed: { base: '#111418', mid: '#707981', soft: '#B7F3D0', paper: '#E7FFF2', accent: '#25C77A' },
  },
  {
    id: 'canyon', name: 'Canyon', blurb: 'Cherry, clay and blush cream',
    seed: { base: '#3A241F', mid: '#C98B6A', soft: '#F6D9CD', paper: '#FFF6F2', accent: '#D34A32' },
  },
  {
    id: 'honey', name: 'Honey', blurb: 'Ink black, butter and burnt honey',
    seed: { base: '#171717', mid: '#A89F94', soft: '#F6DFA6', paper: '#FFF4D8', accent: '#C9822B' },
  },
  {
    id: 'noir', name: 'Noir', blurb: 'Pure black, charcoal and champagne',
    seed: { base: '#0E0E0E', mid: '#9A948B', soft: '#D8C49A', paper: '#FFF8EA', accent: '#A8894A',
      accentDark: '#D8C49A' },
  },
  {
    id: 'dune', name: 'Dune', blurb: 'Walnut, desert sand and terracotta',
    seed: { base: '#3A2A22', mid: '#8C8A68', soft: '#D9BFA3', paper: '#F3E7D8', accent: '#B86F52' },
  },
  {
    id: 'graphite', name: 'Graphite', blurb: 'Carbon, cool silver and electric blue',
    seed: { base: '#101317', mid: '#6B7480', soft: '#AAB2BD', paper: '#F4F7FA', accent: '#3B82F6' },
  },
  {
    id: 'paris', name: 'Paris', blurb: 'Greige, linen and dusty rose',
    seed: { base: '#211F1D', mid: '#A39A90', soft: '#E8DFD3', paper: '#F7F4EF', accent: '#B68A82' },
  },
  {
    id: 'cafe', name: 'Café', blurb: 'Coffee bean, oat milk and cinnamon',
    seed: { base: '#2D211B', mid: '#7B5A48', soft: '#E7D7C2', paper: '#F8F1E8', accent: '#B9784D' },
  },
  {
    id: 'executive', name: 'Executive', blurb: 'Midnight navy, slate and copper',
    seed: { base: '#18202F', mid: '#68748A', soft: '#DCE1E6', paper: '#FAF7F2', accent: '#B8734F' },
  },
  {
    id: 'botanical', name: 'Botanical', blurb: 'Deep olive, sage and bone white',
    seed: { base: '#2F3A2E', mid: '#8E9A86', soft: '#BBC7A4', paper: '#ECE7DC', accent: '#5D4538',
      accentDark: '#BBC7A4' },
  },
  {
    id: 'gallery', name: 'Gallery', blurb: 'Charcoal ink, plaster and burnt umber',
    seed: { base: '#242424', mid: '#8D8A84', soft: '#C3A78E', paper: '#F3F0EA', accent: '#7A4F3A' },
  },
]

export const PALETTES: readonly PaletteDefinition[] = [
  WORKBENCH,
  ...SEEDED.map(({ id, name, blurb, seed }) => ({
    id,
    name,
    blurb,
    swatches: [seed.base, seed.mid, seed.soft, seed.paper, seed.accent],
    light: deriveLight(seed),
    dark: deriveDark(seed),
  })),
]

const BY_ID = new Map(PALETTES.map(p => [p.id, p]))

export const paletteById = (id: ThemePaletteId): PaletteDefinition =>
  BY_ID.get(id) ?? WORKBENCH

export const tokensFor = (id: ThemePaletteId, mode: ThemeMode): PaletteTokens =>
  paletteById(id)[mode]
