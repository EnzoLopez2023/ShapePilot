// Gridfinity: the parameter shapes, defaults and limits shared by the designer
// and the server. Both bins and baseplates are generated from these alone, so
// they are all that is stored.

/** One grid unit, mm. Every bin and baseplate pocket is a multiple of this. */
export const GRID_PITCH_MM = 42
/** One height unit, mm. A "6u" bin is 42 mm to the top of its walls. */
export const HEIGHT_UNIT_MM = 7

export const ALIGNMENTS = ['start', 'center', 'end'] as const
export type GridfinityAlign = (typeof ALIGNMENTS)[number]

export interface GridfinityBinParams {
  gridX: number
  gridY: number
  heightUnits: number
  stackingLip: boolean
  /** The curved front floor that lets fingers scoop small parts out. */
  scoop: boolean
  /** The shelf across the back wall the label sits on. */
  labelTab: boolean
  /** Raised text on the tab. Empty for none. */
  labelText: string
  /** Which saved list the text was picked from, if any -- for the picker only. */
  labelListId?: string
  /** Cap height of the label; the text shrinks to fit the tab if it must. */
  textSizeMm: number
  magnets: boolean
}

export interface GridfinityBaseplateParams {
  drawerWidthMm: number
  drawerDepthMm: number
  /** Total play left between the plate and the drawer, per axis. */
  clearanceMm: number
  alignX: GridfinityAlign
  alignY: GridfinityAlign
  /** Largest square a tile may be; the X2D bed is 256. */
  bedMm: number
}

export const BIN_LIMITS = {
  minGrid: 1, maxGrid: 8,
  minHeightUnits: 2, maxHeightUnits: 20,
  labelMaxLength: 60,
  minTextMm: 3, maxTextMm: 14,
} as const

export const BASEPLATE_LIMITS = {
  minDrawerMm: GRID_PITCH_MM, maxDrawerMm: 2_000,
  maxClearanceMm: 20,
  minBedMm: 100, maxBedMm: 1_000,
} as const

export const LABEL_LIST_LIMITS = {
  nameMaxLength: 100,
  maxItems: 500,
  itemMaxLength: BIN_LIMITS.labelMaxLength,
  /** A pasted file larger than this is not a label list. */
  maxFileBytes: 64 * 1024,
} as const

export const DEFAULT_BIN: GridfinityBinParams = {
  gridX: 1,
  gridY: 2,
  heightUnits: 6,
  stackingLip: true,
  scoop: true,
  labelTab: true,
  labelText: '',
  textSizeMm: 7,
  magnets: false,
}

export const DEFAULT_BASEPLATE: GridfinityBaseplateParams = {
  drawerWidthMm: 457.2,
  drawerDepthMm: 406.4,
  clearanceMm: 1,
  alignX: 'center',
  alignY: 'start',
  bedMm: 256,
}

/**
 * A text file to label items: one per line, trimmed, blanks and repeats
 * dropped, each cut to what fits on a tab. Returns what was kept and how many
 * lines were too long so the caller can say so.
 */
export function parseLabelFile(text: string): { items: string[]; truncated: number; dropped: number } {
  const seen = new Set<string>()
  const items: string[] = []
  let truncated = 0
  let dropped = 0
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    let line = raw.replace(/\s+/g, ' ').trim()
    if (!line) continue
    if (line.length > LABEL_LIST_LIMITS.itemMaxLength) {
      line = line.slice(0, LABEL_LIST_LIMITS.itemMaxLength).trim()
      truncated += 1
    }
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    if (items.length >= LABEL_LIST_LIMITS.maxItems) { dropped += 1; continue }
    seen.add(key)
    items.push(line)
  }
  return { items, truncated, dropped }
}
