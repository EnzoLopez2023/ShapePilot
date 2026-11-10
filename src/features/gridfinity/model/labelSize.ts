// What a label says, read for the parts that matter on a printed bin.
//
// Fastener labels carry the size -- "M3 x 8", "1-1/4\" Coarse", "#8 x 2\"" --
// and that is all the bin's tab has room to print legibly; the lid, which
// hides the contents, carries the whole label. The length also sizes the bin:
// a screw has to lie flat in it, head and all, with room for a fingertip.
import { BIN_LIMITS, GRID_PITCH_MM } from '../../../../lib/contracts/gridfinity.ts'
import { BIN_CLEARANCE_MM, WALL_MM } from '../geometry/bin.ts'

const INCH_MM = 25.4
/** Head and fingertip room on top of the shank length. */
const SLACK_MM = 6
/** "M5", "M2.5 x 12", "M3×8". */
const METRIC = /\bM(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?\b/i
/** 1", 1-1/4", 3/4", 2.5" -- a length in inches, wherever it sits in the label. */
const INCH_LENGTH = /(\d+(?:\.\d+)?(?:-\d+\/\d+)?|\d+\/\d+)\s*(?:"|''|in\b)/i
/** "#8", or "#8 x 1-1/4\"" -- a gauge with an optional inch length. */
const GAUGE = /#(\d+)(?:\s*[x×]\s*(\d+(?:\.\d+)?(?:-\d+\/\d+)?|\d+\/\d+)\s*(?:"|''|in\b))?/i

const fraction = (s: string): number => {
  const [whole, frac] = s.includes('/') && s.includes('-') ? s.split('-') : s.includes('/') ? ['0', s] : [s, '']
  const [n, d] = frac ? frac.split('/').map(Number) : [0, 1]
  return Number(whole) + n / d
}

interface SizeMatch {
  /** The size as the tab prints it: "M5x12", "M5", "#8x2\"", "1-1/4\"". */
  short: string
  /** Fastener length, mm, when the label gives one. */
  lengthMm: number | null
  /** Where the size sits in the label, to find what is left. */
  index: number
  length: number
}

function sizeOf(label: string): SizeMatch | null {
  const metric = METRIC.exec(label)
  if (metric) {
    return {
      short: metric[2] ? `M${metric[1]}x${metric[2]}` : `M${metric[1]}`,
      lengthMm: metric[2] ? Number(metric[2]) : null,
      index: metric.index, length: metric[0].length,
    }
  }
  const gauge = GAUGE.exec(label)
  if (gauge) {
    const inches = gauge[2] ? fraction(gauge[2]) : null
    return {
      short: gauge[2] ? `#${gauge[1]}x${gauge[2]}"` : `#${gauge[1]}`,
      lengthMm: inches && Number.isFinite(inches) ? Math.round(inches * INCH_MM * 100) / 100 : null,
      index: gauge.index, length: gauge[0].length,
    }
  }
  const inch = INCH_LENGTH.exec(label)
  if (inch) {
    const value = fraction(inch[1])
    if (!Number.isFinite(value) || value <= 0) return null
    return {
      short: `${inch[1]}"`,
      lengthMm: Math.round(value * INCH_MM * 100) / 100,
      index: inch.index, length: inch[0].length,
    }
  }
  return null
}

/** The fastener length in a label, mm, or null when it names none. */
export function labelLengthMm(label: string): number | null {
  return sizeOf(label)?.lengthMm ?? null
}

/** What the bin's tab prints: just the size when the label has one, else the label. */
export function shortLabel(label: string): string {
  return sizeOf(label)?.short ?? label.trim()
}

/**
 * The label split for a lid: the size on its own line, then what it is --
 * "M5 x 30 Button" -> ["M5x30", "Button"]. A label with no size splits at the
 * word boundary nearest its middle. One line when there is nothing to split.
 */
export function lidLines(label: string): string[] {
  const text = label.trim().replace(/\s+/g, ' ')
  const size = sizeOf(text)
  if (size) {
    const rest = (text.slice(0, size.index) + text.slice(size.index + size.length)).replace(/\s+/g, ' ').trim()
    return rest ? [size.short, rest] : [size.short]
  }
  const words = text.split(' ')
  if (words.length < 2) return [text]
  let best = 1
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length
    if (Math.abs(a - (text.length - a)) < Math.abs(words.slice(0, best).join(' ').length * 2 - text.length)) best = i
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')]
}

/**
 * Floor the label tab takes at the back. The tab is a shelf near the top whose
 * 45° underside meets the back wall; at floor level, where a screw lies, it
 * costs only the few mm a screw head's height reaches under that slope.
 */
const TAB_FLOOR_LOSS_MM = 8

const insideMm = (cells: number) => cells * GRID_PITCH_MM - BIN_CLEARANCE_MM - 2 * WALL_MM

/**
 * Whether a screw `lengthMm` long lies flat in a bin this many cells wide (x)
 * and deep (y). Across the width the floor is clear; front to back the label
 * tab takes a strip at the back, so that way it gets the depth less the tab.
 */
export const liesFlat = (gridX: number, gridY: number, lengthMm: number): boolean =>
  Math.max(insideMm(gridX), insideMm(gridY) - TAB_FLOOR_LOSS_MM) >= lengthMm + SLACK_MM

export interface BinSuggestion {
  gridX: number
  gridY: number
  lengthMm: number
}

/**
 * The smallest bin a labelled fastener lies flat in, or null when the label
 * gives no length. A long screw gets a bin one cell wide and longer front to
 * back, so the label tab -- always across the width -- stays on a short side.
 */
export function suggestBinSize(label: string): BinSuggestion | null {
  const lengthMm = labelLengthMm(label)
  if (lengthMm === null || lengthMm <= 0) return null
  let gridY = BIN_LIMITS.minGrid
  while (gridY < BIN_LIMITS.maxGrid && !liesFlat(1, gridY, lengthMm)) gridY++
  return { gridX: 1, gridY, lengthMm }
}
