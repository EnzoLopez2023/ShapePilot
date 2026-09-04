// Splitting a tray that is bigger than the build plate into printable pieces.
//
// This module is the planner: given a design and a plate, it works out the grid
// -- how many pieces, and exactly where the cuts fall. Cuts are nudged into the
// clear gaps between pocket rows and columns where one exists, so a piece never
// carries half a pocket. Turning the plan into meshes and jointed seams is a
// later step; this part is pure arithmetic and cheap enough to run on render.
import type { MultiPolygon, Polygon, Ring, Vec2 } from '../../../geometry/vec.ts'
import { multiBBox, ringBBox } from '../../../geometry/vec.ts'
import { intersection } from '../../../geometry/boolean.ts'
import { insertTJunctions } from '../../../geometry/tjunction.ts'
import { MeshBuilder } from '../../../geometry/mesh.ts'
import type { Mesh } from '../../../geometry/mesh.ts'
import type { TrayDesign } from '../model/types.ts'
import { profileToMulti } from '../model/presets.ts'
import { pocketRing } from './shapes.ts'
import { buildRegions, cornerSpacerRects } from './layers.ts'

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

// -- turning a plan into meshes ---------------------------------------------

// How far a finger reaches past the grid line, and the finger period along a
// seam. The two pieces on either side of a cut consume the SAME profile, so
// they interlock and register without hardware.
const JOINT_DEPTH_MM = 3
const TOOTH_PITCH_MM = 12
const SPACER_WELD_MM = 0.05

export interface TrayTile {
  row: number
  col: number
  /** "R1C1" .. row then column, 1-based. */
  label: string
  widthMm: number
  depthMm: number
  /** Watertight, its own origin at (0, 0). */
  mesh: Mesh
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
const isCut = (value: number, cuts: number[]) => cuts.some(c => near(c, value))

/**
 * The finger boundary for one interior cut, sampled over [lo, hi] along the
 * seam. Returns points as (alongSeam, crossOffset) where crossOffset is
 * `cut ± JOINT_DEPTH_MM`. Tooth boundaries sit on a fixed global grid so the
 * profile is identical for both neighbouring pieces.
 */
function fingerPoints(cut: number, lo: number, hi: number): [number, number][] {
  const sideAt = (k: number) => (k % 2 === 0 ? cut - JOINT_DEPTH_MM : cut + JOINT_DEPTH_MM)
  const kLo = Math.floor(lo / TOOTH_PITCH_MM)
  const pts: [number, number][] = [[lo, sideAt(kLo)]]
  for (let k = kLo + 1; k * TOOTH_PITCH_MM < hi - 1e-9; k++) {
    const b = k * TOOTH_PITCH_MM
    if (b <= lo + 1e-9) continue
    pts.push([b, sideAt(k - 1)], [b, sideAt(k)])
  }
  const kHi = pts.length ? Math.floor((pts[pts.length - 1][0]) / TOOTH_PITCH_MM) : kLo
  pts.push([hi, sideAt(kHi)])
  return pts
}

/** The clip outline for one cell: straight on tray-boundary sides, fingered on
 *  interior cuts. Walked CCW. */
function tileClipRing(
  cell: TilePlan['cells'][number], plan: TilePlan, bb: ReturnType<typeof multiBBox>,
): Ring {
  const { minX, minY, maxX, maxY } = cell
  const ring: Vec2[] = []
  // bottom: minX -> maxX at y = minY
  if (isCut(minY, plan.cutsY) && !near(minY, bb.minY)) {
    for (const [x, y] of fingerPoints(minY, minX, maxX)) ring.push([x, y])
  } else { ring.push([minX, minY], [maxX, minY]) }
  // right: minY -> maxY at x = maxX
  if (isCut(maxX, plan.cutsX) && !near(maxX, bb.maxX)) {
    for (const [y, x] of fingerPoints(maxX, minY, maxY)) ring.push([x, y])
  } else { ring.push([maxX, minY], [maxX, maxY]) }
  // top: maxX -> minX at y = maxY
  if (isCut(maxY, plan.cutsY) && !near(maxY, bb.maxY)) {
    for (const [x, y] of fingerPoints(maxY, minX, maxX).reverse()) ring.push([x, y])
  } else { ring.push([maxX, maxY], [minX, maxY]) }
  // left: maxY -> minY at x = minX
  if (isCut(minX, plan.cutsX) && !near(minX, bb.minX)) {
    for (const [y, x] of fingerPoints(minX, minY, maxY).reverse()) ring.push([x, y])
  } else { ring.push([minX, maxY], [minX, minY]) }
  return ring
}

/** Shift a mesh so its footprint's min corner is at the origin. */
function toOrigin(mesh: Mesh): Mesh {
  const [minX, minY] = mesh.bbox
  const p = mesh.positions.slice()
  for (let i = 0; i < p.length; i += 3) { p[i] -= minX; p[i + 1] -= minY }
  return {
    positions: p, indices: mesh.indices, triangleCount: mesh.triangleCount,
    bbox: [0, 0, mesh.bbox[2], mesh.bbox[3] - minX, mesh.bbox[4] - minY, mesh.bbox[5]],
  }
}

/**
 * Split an oversized tray into printable pieces, each watertight and at its own
 * origin. Interior seams interlock with finger joints. Empty when the tray fits
 * the plate whole.
 */
export function tileTray(design: TrayDesign, opts: TilingOptions): TrayTile[] {
  const plan = planTiles(design, opts)
  if (plan.cols * plan.rows <= 1) return []

  const F = design.floorThicknessMm
  const D = design.pocketDepthMm
  const { base, top, pocketFloors } = buildRegions(design)
  const bb = multiBBox(profileToMulti(design.profile))
  const cs = design.cornerSpacers
  const posts = cs && cs.heightMm > 0 && cs.sizeMm > 0 ? cornerSpacerRects(design, top) : []

  return plan.cells.map(cell => {
    const clip: MultiPolygon = [[tileClipRing(cell, plan, bb)]]
    const [cb, ct, cf] = insertTJunctions([
      intersection(base, clip), intersection(top, clip), intersection(pocketFloors, clip),
    ])

    const b = new MeshBuilder()
    b.addHorizontal(cb, 0, 'down')
    b.addHorizontal(cf, F, 'up')
    b.addHorizontal(ct, F + D, 'up')
    b.addWalls(cb, 0, F)
    b.addWalls(ct, F, F + D)

    if (cs) {
      const z0 = F + D - SPACER_WELD_MM
      const z1 = F + D + cs.heightMm
      for (const rect of posts) {
        const rb = ringBBox(rect[0])
        const cx = (rb.minX + rb.maxX) / 2, cy = (rb.minY + rb.maxY) / 2
        if (cx < cell.minX || cx > cell.maxX || cy < cell.minY || cy > cell.maxY) continue
        b.addHorizontal([rect], z0, 'down')
        b.addHorizontal([rect], z1, 'up')
        b.addWalls([rect], z0, z1)
      }
    }

    const mesh = toOrigin(b.finish())
    return {
      row: cell.row, col: cell.col, label: `R${cell.row + 1}C${cell.col + 1}`,
      widthMm: mesh.bbox[3], depthMm: mesh.bbox[4], mesh,
    }
  })
}
