// Splitting a tray that is bigger than the build plate into printable pieces.
//
// This module is the planner: given a design and a plate, it works out the grid
// -- how many pieces, and exactly where the cuts fall. Cuts are nudged into the
// clear gaps between pocket rows and columns where one exists, so a piece never
// carries half a pocket. Turning the plan into meshes and jointed seams is a
// later step; this part is pure arithmetic and cheap enough to run on render.
import type { Polygon } from '../../../geometry/vec.ts'
import { multiBBox, ringBBox } from '../../../geometry/vec.ts'
import type { TrayDesign } from '../model/types.ts'
import { profileToMulti } from '../model/presets.ts'
import { pocketRing } from './shapes.ts'

export interface TilingOptions {
  plateWidthMm: number
  plateDepthMm: number
  /** Clear space to leave around each piece so a brim or skirt fits. */
  marginMm?: number
}

export interface TilePlan {
  cols: number
  rows: number
  /** Interior cut positions in tray coordinates, sorted. */
  cutsX: number[]
  cutsY: number[]
  /** Every piece's rectangle in tray coordinates, row-major from the origin corner. */
  cells: { row: number; col: number; minX: number; minY: number; maxX: number; maxY: number }[]
  /** True where a cut could not clear the pockets and will slice through one. */
  cutsThroughPockets: boolean
}

const DEFAULT_MARGIN_MM = 5

/** How many plate-sized pieces a tray needs on each axis, and the even cell size. */
function gridShape(spanMm: number, availMm: number): { count: number; cellMm: number } {
  const count = Math.max(1, Math.ceil(spanMm / availMm - 1e-6))
  return { count, cellMm: spanMm / count }
}

/**
 * The clear vertical bands of a tray: x-intervals that no pocket occupies. A cut
 * placed inside one of these leaves every pocket whole.
 */
function clearBandsX(pockets: Polygon[], lo: number, hi: number): [number, number][] {
  const spans = pockets
    .map(p => ringBBox(p[0]))
    .map(b => [b.minX, b.maxX] as [number, number])
    .filter(([a, b]) => b > lo && a < hi)
    .sort((a, b) => a[0] - b[0])
  const bands: [number, number][] = []
  let cursor = lo
  for (const [a, b] of spans) {
    if (a > cursor) bands.push([cursor, a])
    cursor = Math.max(cursor, b)
  }
  if (cursor < hi) bands.push([cursor, hi])
  return bands
}

const clearBandsY = (pockets: Polygon[], lo: number, hi: number): [number, number][] =>
  clearBandsX(pockets.map(p => [p[0].map(([x, y]) => [y, x] as [number, number])]), lo, hi)

/** Move an ideal cut to the middle of the nearest clear band, if one is in reach. */
function snapCut(ideal: number, bands: [number, number][], reachMm: number): number | null {
  let best: number | null = null
  let bestGap = reachMm
  for (const [a, b] of bands) {
    // A band narrower than ~2 mm is not a real corridor.
    if (b - a < 2) continue
    // Sit the cut as close to the ideal as the band allows, 1 mm off each wall.
    const target = Math.min(Math.max(ideal, a + 1), b - 1)
    const gap = Math.abs(target - ideal)
    if (gap <= bestGap) { best = target; bestGap = gap }
  }
  return best
}

export function planTiles(design: TrayDesign, opts: TilingOptions): TilePlan {
  const margin = opts.marginMm ?? DEFAULT_MARGIN_MM
  const availW = Math.max(1, opts.plateWidthMm - 2 * margin)
  const availD = Math.max(1, opts.plateDepthMm - 2 * margin)

  const bb = multiBBox(profileToMulti(design.profile))
  const spanX = bb.maxX - bb.minX
  const spanY = bb.maxY - bb.minY

  // Try both plate orientations; keep the one that needs fewer pieces.
  const upright = gridShape(spanX, availW).count * gridShape(spanY, availD).count
  const turned = gridShape(spanX, availD).count * gridShape(spanY, availW).count
  const [gx, gy] = turned < upright
    ? [gridShape(spanX, availD), gridShape(spanY, availW)]
    : [gridShape(spanX, availW), gridShape(spanY, availD)]

  const pockets = design.pockets.map(p => pocketRing(p, design.sizing))

  const cutsX: number[] = []
  for (let i = 1; i < gx.count; i++) {
    const ideal = bb.minX + i * gx.cellMm
    const snapped = snapCut(ideal, clearBandsX(pockets, bb.minX, bb.maxX), gx.cellMm * 0.45)
    cutsX.push(snapped ?? ideal)
  }
  const cutsY: number[] = []
  for (let i = 1; i < gy.count; i++) {
    const ideal = bb.minY + i * gy.cellMm
    const snapped = snapCut(ideal, clearBandsY(pockets, bb.minY, bb.maxY), gy.cellMm * 0.45)
    cutsY.push(snapped ?? ideal)
  }

  const xs = [bb.minX, ...cutsX, bb.maxX]
  const ys = [bb.minY, ...cutsY, bb.maxY]
  const cells: TilePlan['cells'] = []
  for (let r = 0; r < ys.length - 1; r++) {
    for (let c = 0; c < xs.length - 1; c++) {
      cells.push({ row: r, col: c, minX: xs[c], minY: ys[r], maxX: xs[c + 1], maxY: ys[r + 1] })
    }
  }

  // A cut clears the pockets when it sits strictly outside every pocket's x/y span.
  const spanHitsCut = (cut: number, lo: (b: ReturnType<typeof ringBBox>) => number,
    hi: (b: ReturnType<typeof ringBBox>) => number) =>
    pockets.some(p => { const b = ringBBox(p[0]); return cut > lo(b) + 1e-6 && cut < hi(b) - 1e-6 })
  const cutsThroughPockets =
    cutsX.some(x => spanHitsCut(x, b => b.minX, b => b.maxX)) ||
    cutsY.some(y => spanHitsCut(y, b => b.minY, b => b.maxY))

  return { cols: gx.count, rows: gy.count, cutsX, cutsY, cells, cutsThroughPockets }
}

/** Does this tray need splitting to print on the given plate? */
export function needsTiling(design: TrayDesign, opts: TilingOptions): boolean {
  const plan = planTiles(design, opts)
  return plan.cols * plan.rows > 1
}
