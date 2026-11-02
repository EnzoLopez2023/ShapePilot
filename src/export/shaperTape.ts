// Where to lay ShaperTape on a part that carries its own.
//
// On BenchPilot the workpiece sits on a bare board (or slides through for a
// pass-through), so the tape goes on the part itself. Strips run across the
// part, square to its length, so every stretch of it has tape as it slides.
// They are spaced no more than about 3 in apart, and each strip sits in a gap
// between the short cuts -- a strip routed through no longer scans.
//
// Positions are the strip's near edge, measured from one end of the part, and
// rounded to something a rule can mark: 1/8 in, or 1 mm.
import { longAxis, shortCutsAlong } from './passThrough.ts'
import type { CutDrawing } from './cutLayers.ts'

/** ShaperTape is 1/2 in wide. */
export const TAPE_WIDTH_MM = 12.7
/** No further apart than this, from one strip's near edge to the next's: about 3 in. */
export const TAPE_PITCH_MM = 76.2
/** The first and last strip sit this far in from the ends, clear of the outline cut. */
export const TAPE_END_MM = 12.7
/** A strip keeps at least this much clear of a cut beside it. */
const CLEAR_MM = 1

export interface TapeLayout {
  /** The model axis the strips are spaced along: the part's length. */
  axis: 'x' | 'y'
  /** Each strip's near edge, from the part's low end along the axis. */
  stripsMm: number[]
  lengthMm: number
  /** Strips that could not miss a cut, by index. */
  overCuts: number[]
}

/**
 * Strip positions along a part `lengthMm` long, clear of `blocked` intervals
 * where possible. Each sits as close to an even spacing as a clear, rounded
 * position allows.
 */
export function placeTapeStrips(
  lengthMm: number, blocked: [number, number][], unitMm: number,
  pitchMm = TAPE_PITCH_MM, tapeMm = TAPE_WIDTH_MM, endMm = TAPE_END_MM,
): { stripsMm: number[]; overCuts: number[] } {
  const first = endMm, last = lengthMm - endMm - tapeMm
  if (last < first) return { stripsMm: [Math.max(0, (lengthMm - tapeMm) / 2)], overCuts: [] }
  const count = Math.ceil((last - first) / pitchMm) + 1
  const clear = (p: number) => p >= 0 && p + tapeMm <= lengthMm
    && blocked.every(([a, b]) => p + tapeMm + CLEAR_MM <= a || p - CLEAR_MM >= b)
  const snap = (p: number) => Math.round(p / unitMm) * unitMm
  const stripsMm: number[] = []
  const overCuts: number[] = []
  for (let i = 0; i < count; i++) {
    const ideal = count === 1 ? first : first + ((last - first) * i) / (count - 1)
    // Search outward from the ideal spot, a rule's mark at a time, up to half a pitch.
    let found: number | null = null
    for (let k = 0; k * unitMm <= pitchMm / 2 && found === null; k++) {
      for (const p of k ? [snap(ideal) - k * unitMm, snap(ideal) + k * unitMm] : [snap(ideal)]) {
        if (clear(p)) { found = p; break }
      }
    }
    if (found === null) overCuts.push(i)
    stripsMm.push(found ?? snap(ideal))
  }
  return { stripsMm, overCuts }
}

/** The tape layout for a part, from its drawing; null for a part with no outline. */
export function tapeLayout(drawing: CutDrawing, unitMm: number): TapeLayout | null {
  const axis = longAxis(drawing)
  const outline = drawing.layers.find(l => l.cutType === 'exterior')?.polygons.flat() ?? []
  if (!axis || !outline.length) return null
  const vs = outline.flatMap(r => r.map(p => (axis === 'y' ? p[1] : p[0])))
  const start = Math.min(...vs), lengthMm = Math.max(...vs) - start
  // A cut running most of the length (a rabbet along an edge) is crossed whatever
  // happens; only the short ones are worth steering around.
  const blocked = shortCutsAlong(drawing, axis, lengthMm / 2)
    .map(([a, b]): [number, number] => [a - start, b - start])
  return { axis, lengthMm, ...placeTapeStrips(lengthMm, blocked, unitMm) }
}
