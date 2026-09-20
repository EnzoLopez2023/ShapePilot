// The filament label sheet: what goes on a swatch card's sticker.
//
// The card is 69.4 x 36.4 mm with a 50 x 30 mm label pocket (see
// scripts/build-filament-swatch.ts); this is what gets printed on the label
// that sits in it. The columns come out in the order they read on the card, so
// binding them in the label app's template is top to bottom with no guessing.
//
// Everything except speed and temperature comes from FILAMENT_CATALOG, the
// same catalogue the page ticks against -- a label can never disagree with the
// inventory it was printed from.
import type { FilamentColor } from '../../../../lib/contracts/bambuFilaments.ts'
import { filamentLineById } from '../../../../lib/contracts/bambuFilaments.ts'

/**
 * Speed and nozzle temperature per line.
 *
 * NOT in the catalogue, which is a capture of colours and codes and says
 * nothing about how to print them. These are the figures Bambu Studio's stock
 * profile for each line uses. They are the one thing on the label worth
 * checking against your own slicer: a wrong colour name is obvious on the
 * shelf, a wrong temperature is not.
 */
export const PRINT_SETTINGS: Readonly<Record<string, { speed: string; temp: string }>> = {
  'bambu-lab/pla/basic': { speed: '200 mm/s', temp: '220 °C' },
  'bambu-lab/pla/matte': { speed: '200 mm/s', temp: '220 °C' },
  'bambu-lab/pla/basic-gradient': { speed: '200 mm/s', temp: '220 °C' },
  'bambu-lab/pla/wood': { speed: '200 mm/s', temp: '220 °C' },
  'bambu-lab/petg/basic': { speed: '200 mm/s', temp: '255 °C' },
  'bambu-lab/petg/hf': { speed: '200 mm/s', temp: '255 °C' },
  'bambu-lab/abs/basic': { speed: '200 mm/s', temp: '260 °C' },
}

/**
 * What the QR carries.
 *
 * `profile` points at the page the catalogue was captured from, which is the
 * only per-filament URL that exists today -- /filaments has no per-colour route
 * to link to. `key` encodes the inventory key as plain text instead, which is
 * what a scanner built into this page would want to read, and what to switch to
 * the day that route exists.
 */
export type QrMode = 'profile' | 'key' | 'none'

const PROFILE_BASE = 'https://3dfilamentprofiles.com/filaments'

export const qrFor = (color: FilamentColor, mode: QrMode): string => {
  if (mode === 'none') return ''
  if (mode === 'key') return color.key
  return `${PROFILE_BASE}/${color.line}`
}

/** The label's fields, in the order they read on the card. */
export const LABEL_COLUMNS = [
  'brand', 'line', 'colour', 'speed', 'temp', 'code', 'qr', 'hex', 'key',
] as const

export function labelRow(color: FilamentColor, mode: QrMode): string[] {
  const line = filamentLineById(color.line)
  const settings = PRINT_SETTINGS[color.line]
  return [
    line?.brandLabel ?? '',
    line?.label ?? '',
    color.name,
    settings?.speed ?? '',
    settings?.temp ?? '',
    color.code ?? '',
    qrFor(color, mode),
    // A gradient lists several; the first is the one the swatch reads as.
    color.hexes[0] ?? '',
    color.key,
  ]
}

/**
 * The header row plus one row per colour, sorted by line then colour so the
 * printed run comes off the label printer grouped the way the spools sit on
 * the shelf.
 */
export function labelSheet(
  colors: readonly FilamentColor[], mode: QrMode = 'profile',
): string[][] {
  const sorted = [...colors].sort(
    (a, b) => a.line.localeCompare(b.line) || a.name.localeCompare(b.name))
  return [[...LABEL_COLUMNS], ...sorted.map(color => labelRow(color, mode))]
}

/** Lines with no speed/temperature -- a label that cannot say how to print it. */
export const linesWithoutSettings = (colors: readonly FilamentColor[]): string[] =>
  [...new Set(colors.map(color => color.line))].filter(line => !PRINT_SETTINGS[line])
