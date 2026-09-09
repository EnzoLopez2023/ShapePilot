// Filling a tray with switch cells.
//
// Every cell is the same square, so the layout is a lattice and the only real
// question is which lattice. Answering it means asking "does this square sit
// wholly on solid material?" tens of thousands of times, once per candidate per
// candidate origin -- far too many polygon booleans.
//
// So the outline is rasterised once into a solid/void bitmap and reduced to a
// summed-area table. After that a containment test is four array reads, and
// searching the grid origin for the arrangement that fits the most cells costs
// nothing. The raster is deliberately *conservative*: a cell is only accepted
// when the material around it is solid out to one raster cell beyond its
// keep-out, so the planner never claims a cell that does not fit.
import type { MultiPolygon, Polygon, Vec2 } from '../../../geometry/vec.ts'
import { translateRing } from '../../../geometry/vec.ts'
import { rectRing } from '../../../geometry/primitives.ts'
import { profileToMulti } from '../../../model/trayProfile.ts'
import { cellKeepoutMm } from '../model/defaults.ts'
import type { SwitchTrayDesign } from '../model/types.ts'

// The mask itself lives in `src/geometry/solidMask.ts`, shared with the tool
// tray. Re-exported here because `SolidMask` and `RASTER_MM` are part of this
// module's own published surface and callers should not have to know both.
import { allSolid, buildSolidMask, RASTER_MM } from '../../../geometry/solidMask.ts'
import type { SolidMask } from '../../../geometry/solidMask.ts'

export { buildSolidMask, RASTER_MM }
export type { SolidMask }

export interface FillCell {
  /** Lattice indices, normalised so the first occupied column and row are 0. */
  col: number
  row: number
  /** Centre of the cell, tray coordinates. */
  cx: number
  cy: number
}

export interface FillPlan {
  cells: FillCell[]
  /** Cells the lattice found, before `skippedCells` was applied. */
  fitted: number
  /** How many of those the user knocked out. */
  skipped: number
  /** Pitch actually used -- larger than asked for when spreading is on. */
  pitchXMm: number
  pitchYMm: number
  columns: number
  rows: number
}

export interface FillRequest {
  region: MultiPolygon
  /** Footprints already spoken for: posts, a nameplate. */
  blockers: Polygon[]
  /** The square a cell owns outright. */
  keepoutMm: number
  /** Clear material demanded between that square and the outline. */
  marginMm: number
  pitchXMm: number
  pitchYMm: number
  stagger: 'none' | 'brick'
  origin: 'centred' | 'maximised'
  spreadEvenly: boolean
  skippedCells?: readonly string[]
}

export const cellKey = (col: number, row: number): string => `${col},${row}`

/** How many origins to try per axis when maximising. */
const ORIGIN_STEPS = 24

interface Lattice { cells: Vec2[]; cols: number; rows: number }

/** Every cell of one candidate lattice that sits wholly on solid material. */
function latticeAt(
  m: SolidMask, req: FillRequest, pitchX: number, pitchY: number, ox: number, oy: number,
): Lattice {
  const half = req.keepoutMm / 2 + req.marginMm
  const spanX = m.cols * m.cellMm
  const spanY = m.rows * m.cellMm
  const brick = req.stagger === 'brick' ? pitchX / 2 : 0

  const cells: Vec2[] = []
  const colsSeen = new Set<number>()
  const rowsSeen = new Set<number>()
  const nRows = Math.floor(spanY / pitchY) + 2
  const nCols = Math.floor(spanX / pitchX) + 2

  for (let r = 0; r < nRows; r++) {
    const cy = m.minY + oy + r * pitchY
    const shift = brick && r % 2 ? brick : 0
    for (let c = 0; c < nCols; c++) {
      const cx = m.minX + ox + shift + c * pitchX
      if (!allSolid(m, cx - half, cy - half, cx + half, cy + half)) continue
      cells.push([cx, cy])
      colsSeen.add(c)
      rowsSeen.add(r)
    }
  }
  return { cells, cols: colsSeen.size, rows: rowsSeen.size }
}

/** The best lattice at a fixed pitch: centred, or searched for the most cells. */
function bestLattice(
  m: SolidMask, req: FillRequest, pitchX: number, pitchY: number,
): { lattice: Lattice; ox: number; oy: number } {
  const spanX = m.cols * m.cellMm
  const spanY = m.rows * m.cellMm

  if (req.origin === 'centred') {
    // Centre the lattice on the outline's own middle, whatever that costs.
    const nx = Math.max(1, Math.floor(spanX / pitchX) + 1)
    const ny = Math.max(1, Math.floor(spanY / pitchY) + 1)
    const ox = (spanX - (nx - 1) * pitchX) / 2
    const oy = (spanY - (ny - 1) * pitchY) / 2
    return { lattice: latticeAt(m, req, pitchX, pitchY, ox, oy), ox, oy }
  }

  let best: Lattice | null = null
  let bestOx = 0, bestOy = 0, bestScore = -Infinity
  for (let a = 0; a < ORIGIN_STEPS; a++) {
    const ox = (a / ORIGIN_STEPS) * pitchX
    for (let b = 0; b < ORIGIN_STEPS; b++) {
      const oy = (b / ORIGIN_STEPS) * pitchY
      const lattice = latticeAt(m, req, pitchX, pitchY, ox, oy)
      if (!lattice.cells.length) continue
      // Count first; among equals prefer the arrangement sitting most centrally,
      // so a tie does not land the whole field against one edge.
      let sx = 0, sy = 0
      for (const [x, y] of lattice.cells) { sx += x; sy += y }
      const offCentre =
        Math.abs(sx / lattice.cells.length - (m.minX + spanX / 2))
        + Math.abs(sy / lattice.cells.length - (m.minY + spanY / 2))
      const score = lattice.cells.length * 1e6 - offCentre
      if (score > bestScore) { bestScore = score; best = lattice; bestOx = ox; bestOy = oy }
    }
  }
  return {
    lattice: best ?? { cells: [], cols: 0, rows: 0 },
    ox: bestOx,
    oy: bestOy,
  }
}

/**
 * Grow one pitch as far as it will go without losing a cell. The requested
 * pitch is a *minimum*; a tray whose width leaves 12 mm spare is nicer to use
 * with that 12 mm shared out between the columns than left along one edge.
 */
function spread(
  m: SolidMask, req: FillRequest, pitchX: number, pitchY: number, axis: 'x' | 'y', target: number,
): number {
  const start = axis === 'x' ? pitchX : pitchY
  let lo = start
  let hi = start * 2
  const countAt = (p: number): number =>
    (axis === 'x'
      ? bestLattice(m, req, p, pitchY)
      : bestLattice(m, req, pitchX, p)).lattice.cells.length
  if (countAt(hi) >= target) return hi
  // 8 halvings takes the interval to under 0.5% of the pitch -- well inside the
  // 0.05 mm the panel shows.
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2
    if (countAt(mid) >= target) lo = mid
    else hi = mid
  }
  return Math.round(lo * 20) / 20
}

/**
 * Plan a tray's worth of cells. Pure and synchronous; the caller memoises it on
 * the design revision, and every count in the UI comes from the result.
 */
export function planFill(req: FillRequest, mask?: SolidMask): FillPlan {
  const m = mask ?? buildSolidMask(req.region, req.blockers)
  const first = bestLattice(m, req, req.pitchXMm, req.pitchYMm)
  const target = first.lattice.cells.length

  let pitchX = req.pitchXMm
  let pitchY = req.pitchYMm
  let lattice = first.lattice
  if (req.spreadEvenly && target > 0) {
    pitchX = spread(m, req, pitchX, pitchY, 'x', target)
    pitchY = spread(m, req, pitchX, pitchY, 'y', target)
    const grown = bestLattice(m, req, pitchX, pitchY)
    // Only take the spread arrangement if it really kept every cell.
    if (grown.lattice.cells.length >= target) lattice = grown.lattice
    else { pitchX = req.pitchXMm; pitchY = req.pitchYMm }
  }

  // Normalise indices off the occupied span, so a skip stays meaningful as
  // long as the arrangement does.
  const minCx = Math.min(...lattice.cells.map(([x]) => x), Infinity)
  const minCy = Math.min(...lattice.cells.map(([, y]) => y), Infinity)
  const skipped = new Set(req.skippedCells ?? [])
  const cells: FillCell[] = []
  let dropped = 0
  for (const [cx, cy] of lattice.cells) {
    const col = Math.round((cx - minCx) / pitchX)
    const row = Math.round((cy - minCy) / pitchY)
    if (skipped.has(cellKey(col, row))) { dropped++; continue }
    cells.push({ col, row, cx, cy })
  }
  cells.sort((a, b) => (a.row - b.row) || (a.col - b.col))

  return {
    cells,
    fitted: lattice.cells.length,
    skipped: dropped,
    pitchXMm: pitchX,
    pitchYMm: pitchY,
    columns: lattice.cols,
    rows: lattice.rows,
  }
}

/**
 * The fill request a design implies. One place, because the page, the mesher,
 * the post seating and the tests all have to ask the same question of the same
 * lattice -- and did so from four hand-copied literals before this existed.
 */
export function fillRequestFor(
  design: SwitchTrayDesign, blockers: readonly Polygon[],
): FillRequest {
  return {
    region: profileToMulti(design.profile),
    blockers: [...blockers],
    keepoutMm: cellKeepoutMm(design.plate, design.switch),
    marginMm: design.fill.marginMm,
    pitchXMm: design.fill.pitchXMm,
    pitchYMm: design.fill.pitchYMm,
    stagger: design.fill.stagger,
    origin: design.fill.origin,
    spreadEvenly: design.fill.spreadEvenly,
    skippedCells: design.skippedCells,
  }
}

/**
 * Each planned cell as the square it actually claims, for anything that has to
 * keep off them. The keep-out, not the hole: a switch's body needs the whole
 * recess, and a post touching the recess wall is a post in the way.
 */
export const cellRects = (plan: FillPlan, keepoutMm: number): Polygon[] =>
  plan.cells.map(c => [translateRing(
    rectRing(keepoutMm, keepoutMm), c.cx - keepoutMm / 2, c.cy - keepoutMm / 2,
  )])
