// The colour palettes a person can dress the workbench in.
//
// Only the ids live here, because both sides need them and only one side needs
// the colours: the server has to refuse an id it does not know (a stored
// preference outlives a renamed palette) and the client has to draw it. The
// colours themselves are in src/theme/palettes.ts.

export const THEME_PALETTE_IDS = [
  'workbench',
  'maison',
  'overcast',
  'lavender',
  'grove',
  'cobalt',
  'aurora',
  'canyon',
  'honey',
  'noir',
  'dune',
  'graphite',
  'paris',
  'cafe',
  'executive',
  'botanical',
  'gallery',
] as const

export type ThemePaletteId = typeof THEME_PALETTE_IDS[number]

/** The original hand-tuned palette, and what an unset preference resolves to. */
export const DEFAULT_THEME_PALETTE: ThemePaletteId = 'workbench'

const KNOWN = new Set<string>(THEME_PALETTE_IDS)

export const isThemePaletteId = (value: unknown): value is ThemePaletteId =>
  typeof value === 'string' && KNOWN.has(value)
