// A bin sized from what its label says it holds. Fastener labels carry the
// length -- "M3 x 8", "1-1/4\" Coarse", "#8 x 2\"" -- and a screw has to lie
// flat across the bin, head and all, with room for a fingertip. That sets the
// width; a single cell of depth is plenty for a pile of one size.
import { BIN_LIMITS, GRID_PITCH_MM } from '../../../../lib/contracts/gridfinity.ts'
import { BIN_CLEARANCE_MM, WALL_MM } from '../geometry/bin.ts'

const INCH_MM = 25.4
/** Head and fingertip room on top of the shank length. */
const SLACK_MM = 6
const METRIC = /\bM(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\b/i
/** 1", 1-1/4", 3/4", 2.5" -- a length in inches, wherever it sits in the label. */
const INCHES = /(?:^|[\s x×])(\d+(?:\.\d+)?(?:-\d+\/\d+)?|\d+\/\d+)\s*(?:"|''|in\b)/i

const fraction = (s: string): number => {
  const [whole, frac] = s.includes('/') && s.includes('-') ? s.split('-') : s.includes('/') ? ['0', s] : [s, '']
  const [n, d] = frac ? frac.split('/').map(Number) : [0, 1]
  return Number(whole) + n / d
}

/** The fastener length in a label, mm, or null when it names none. */
export function labelLengthMm(label: string): number | null {
  const metric = METRIC.exec(label)
  if (metric) return Number(metric[2])
  const inches = INCHES.exec(label)
  if (inches) {
    const value = fraction(inches[1])
    return Number.isFinite(value) && value > 0 ? Math.round(value * INCH_MM * 100) / 100 : null
  }
  return null
}

const insideMm = (cells: number) => cells * GRID_PITCH_MM - BIN_CLEARANCE_MM - 2 * WALL_MM

/** Whether a screw `lengthMm` long lies flat across a bin this many cells wide or deep. */
export const liesFlat = (gridX: number, gridY: number, lengthMm: number): boolean =>
  insideMm(Math.max(gridX, gridY)) >= lengthMm + SLACK_MM

export interface BinSuggestion {
  gridX: number
  gridY: number
  lengthMm: number
}

/** The narrowest bin a labelled fastener lies flat in, or null when the label gives no length. */
export function suggestBinSize(label: string): BinSuggestion | null {
  const lengthMm = labelLengthMm(label)
  if (lengthMm === null || lengthMm <= 0) return null
  let gridX = BIN_LIMITS.minGrid
  while (gridX < BIN_LIMITS.maxGrid && !liesFlat(gridX, 1, lengthMm)) gridX++
  return { gridX, gridY: 1, lengthMm }
}
