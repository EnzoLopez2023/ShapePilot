// Clamping squares: a stepped right-angle frame that is clamped into the
// inside corner of a glue-up to hold the two panels at 90° while it sets.
//
// The two straight outer edges are the working faces. The square is a grid
// of cells stepped down from the corner, like a staircase, and every cell but
// the corner one is open. A clamp jaw reaches through an opening, or over a
// step, and always lands on a face parallel to a working edge, so it pinches
// straight across and never skids the way it would off a sloped face. The
// corner cell stays solid, for stiffness and so the notch cut from its corner
// -- clearance for the bead of squeeze-out along the joint -- weakens nothing.
//
// Like the alignment jigs it is one ordinary path object, printed flat.
import type { Contour, PathObject, Triple } from '../../model/document.ts'
import { IDENTITY_TRANSFORM, newId } from '../../model/scene.ts'

export interface ClampSquareSpec {
  /** Length of each working face. */
  legMm: number
  /** Cells along each working face; the staircase has this many steps. */
  steps: number
  /** How tall the working faces stand, which is the print height. */
  heightMm: number
  /** Width of the frame's bars. */
  barMm: number
  /** Square notch cut from the right-angle corner. */
  reliefMm: number
  /** How many to lay out, in rows across the plate. */
  count: number
}

export const DEFAULT_CLAMP_SQUARE_SPEC: ClampSquareSpec = {
  legMm: 120,
  steps: 3,
  heightMm: 20,
  barMm: 8,
  reliefMm: 6,
  count: 4,
}

/** The narrowest opening a clamp jaw still fits through. */
export const MIN_WINDOW_MM = 20
export const MAX_COUNT = 8
export const MIN_STEPS = 2
export const MAX_STEPS = 5
/** Between neighbouring squares. */
const SPACING_MM = 5

/** The smallest opening: a cell on the staircase edge, with outer bars on two sides. */
const smallestWindow = (s: ClampSquareSpec) => s.legMm / s.steps - 2 * s.barMm

/** Why a spec cannot be made, or null when it can. */
export function clampSquareProblem(s: ClampSquareSpec): string | null {
  const positive: [number, string][] = [
    [s.legMm, 'Leg length'], [s.heightMm, 'Height'], [s.barMm, 'Bar width'],
  ]
  for (const [value, label] of positive) {
    if (!Number.isFinite(value) || value <= 0) return `${label} must be above zero.`
  }
  if (!Number.isInteger(s.steps) || s.steps < MIN_STEPS || s.steps > MAX_STEPS) {
    return `Steps must be between ${MIN_STEPS} and ${MAX_STEPS}.`
  }
  if (!Number.isFinite(s.reliefMm) || s.reliefMm < 0) return 'Corner relief cannot be negative.'
  if (s.reliefMm >= s.legMm / s.steps - s.barMm) return 'Corner relief must stay inside the solid corner cell.'
  if (!Number.isInteger(s.count) || s.count < 1 || s.count > MAX_COUNT) {
    return `Make between 1 and ${MAX_COUNT} at a time.`
  }
  if (smallestWindow(s) < MIN_WINDOW_MM) {
    const minLeg = s.steps * (MIN_WINDOW_MM + 2 * s.barMm)
    return `With ${s.steps} steps, legs must be at least ${Math.ceil(minLeg)} mm for a clamp to reach through.`
  }
  return null
}

/** The outline with the corner at the origin: outer ring CCW, openings CW. */
function rings(s: ClampSquareSpec): Contour[] {
  const { legMm: L, steps: n, barMm: w, reliefMm: r } = s
  const p = L / n
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i + j < n

  const outer: [number, number][] = r > 0 ? [[r, 0]] : [[0, 0]]
  for (let k = 0; k < n; k++) outer.push([(n - k) * p, k * p], [(n - k) * p, (k + 1) * p])
  outer.push([0, L], ...(r > 0 ? [[0, r], [r, r]] as [number, number][] : []))

  // A bar shared with a neighbouring cell is split between the two; one on
  // the outline belongs to this cell alone.
  const edge = (shared: boolean) => (shared ? w / 2 : w)
  const openings: Contour[] = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; i + j < n; j++) {
      if (i === 0 && j === 0) continue
      const x0 = i * p + edge(inside(i - 1, j))
      const x1 = (i + 1) * p - edge(inside(i + 1, j))
      const y0 = j * p + edge(inside(i, j - 1))
      const y1 = (j + 1) * p - edge(inside(i, j + 1))
      openings.push([[x0, y0], [x0, y1], [x1, y1], [x1, y0]])
    }
  }
  return [outer, ...openings]
}

export const clampSquareName = (s: ClampSquareSpec): string => `Clamping square ${Math.round(s.legMm)} mm`

/** How many squares fit across a plate this wide, at least one. */
export const clampSquareColumns = (s: ClampSquareSpec, plateWidthMm: number): number =>
  Math.max(1, Math.min(s.count, Math.floor((plateWidthMm + SPACING_MM) / (s.legMm + SPACING_MM))))

/**
 * `count` squares in rows of `columns`, the first with its corner at `at` and
 * later rows behind it in y.
 */
export function createClampSquares(
  s: ClampSquareSpec, at: Triple = [0, 0, 0], columns = s.count,
): PathObject[] {
  const problem = clampSquareProblem(s)
  if (problem) throw new Error(problem)
  const outline = rings(s)
  const pitch = s.legMm + SPACING_MM
  return Array.from({ length: s.count }, (_, i) => ({
    id: newId(),
    name: s.count > 1 ? `${clampSquareName(s)} ${i + 1}` : clampSquareName(s),
    type: 'path',
    rings: outline,
    thicknessMm: s.heightMm,
    transform: {
      ...IDENTITY_TRANSFORM,
      position: [at[0] + (i % columns) * pitch, at[1] + Math.floor(i / columns) * pitch, at[2]],
    },
    mode: 'solid',
    visible: true,
    locked: false,
  }))
}

/** Outside size of the whole layout on the plate, x by y. */
export function clampSquaresFootprint(s: ClampSquareSpec, columns = s.count): [number, number] {
  const cols = Math.min(columns, s.count)
  const rows = Math.ceil(s.count / cols)
  return [cols * s.legMm + (cols - 1) * SPACING_MM, rows * s.legMm + (rows - 1) * SPACING_MM]
}
