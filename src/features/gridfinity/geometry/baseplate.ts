// The drawer baseplate. Fills a drawer with as many 42 mm Gridfinity cells as
// fit, pads the leftover with solid plate at the same height, and splits the
// whole into tiles that each fit the printer's bed.
//
// The plate is the "light" style: every pocket goes right through, so it
// prints fast, uses little filament and sits flat in the drawer.
//
// Coordinates match the bin: x across the drawer (width), y front-to-back
// (depth, front at y = 0), z up.
import type { Manifold, ManifoldToplevel } from 'manifold-3d'
import { loadManifold } from '../../../csg/manifold.ts'
import { toAppMesh } from '../../../csg/evaluate.ts'
import type { Mesh } from '../../../geometry/mesh.ts'
import {
  GRID_PITCH_MM, type GridfinityAlign, type GridfinityBaseplateParams,
} from '../../../../lib/contracts/gridfinity.ts'
import { finish, profile, type Outline } from './shapes.ts'
import { getPreset, profileToMulti } from '../../../model/trayProfile.ts'

type Pt = [number, number]

export const BASEPLATE_HEIGHT_MM = 4.65
const POCKET_RADIUS_MM = 4
/** Leaves a hairline ridge between pockets rather than a knife edge. */
const POCKET_TOP_INSET = 0.1
const PLATE_CORNER_RADIUS_MM = 2

/** One run of tiles along an axis. */
export interface TileSpan {
  /** Where the tile starts and ends on the plate, mm. */
  from: number
  to: number
  /** Which cells it carries, [first, end). */
  firstCell: number
  endCell: number
}

export interface BaseplateTile {
  /** 1-based column and row, front-left first. */
  col: number
  row: number
  x: number
  y: number
  widthMm: number
  depthMm: number
  cellsX: number
  cellsY: number
}

export interface BaseplatePlan {
  plateWidthMm: number
  plateDepthMm: number
  cellsX: number
  cellsY: number
  /** Where the grid's front-left corner sits on the plate. */
  gridX: number
  gridY: number
  columns: TileSpan[]
  rows: TileSpan[]
  tiles: BaseplateTile[]
  /**
   * The plate's shape when it is not a plain rounded rectangle -- a Systainer
   * insert. Rings in plate coordinates, the first the outside.
   */
  outline?: Pt[][]
  /** Set when the drawer cannot take a plate at all; nothing else is useful. */
  problem?: string
}

const offset = (align: GridfinityAlign, spare: number): number =>
  align === 'start' ? 0 : align === 'end' ? spare : spare / 2

/**
 * Split `cells` cells, with padding `before` and `after`, into the fewest
 * pieces no wider than `bed`, as evenly as the padding allows. Splits only on
 * cell boundaries so every pocket stays whole.
 */
export function splitAxis(cells: number, before: number, after: number, bed: number): TileSpan[] | null {
  const fit = (room: number) => Math.floor((room + 1e-6) / GRID_PITCH_MM)
  for (let count = 1; count <= cells; count++) {
    const caps = Array.from({ length: count }, (_, i) => {
      const pad = (i === 0 ? before : 0) + (i === count - 1 ? after : 0)
      return fit(bed - pad)
    })
    if (caps.some(c => c < 1)) continue
    if (caps.reduce((a, b) => a + b, 0) < cells) continue
    // Fill as evenly as possible, then hand what is left to whoever has room.
    const share = Math.floor(cells / count)
    const counts = caps.map(c => Math.min(c, share))
    let left = cells - counts.reduce((a, b) => a + b, 0)
    while (left > 0) {
      // Middle tiles first: they carry no padding, so the edge tiles stay smallest.
      const order = counts.map((_, i) => i)
        .sort((a, b) => counts[a] - counts[b] || Number(a === 0 || a === count - 1) - Number(b === 0 || b === count - 1))
      const next = order.find(i => counts[i] < caps[i])
      if (next === undefined) break
      counts[next] += 1
      left -= 1
    }
    if (left > 0) continue
    const spans: TileSpan[] = []
    let cell = 0
    let pos = 0
    counts.forEach((n, i) => {
      const width = n * GRID_PITCH_MM + (i === 0 ? before : 0) + (i === count - 1 ? after : 0)
      spans.push({ from: pos, to: pos + width, firstCell: cell, endCell: cell + n })
      pos += width
      cell += n
    })
    return spans
  }
  return null
}

/** Even-odd point-in-polygon over every ring. */
function inside(rings: Pt[][], x: number, y: number): boolean {
  let hit = false
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i]
      const [xj, yj] = r[j]
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
    }
  }
  return hit
}

/** Does a pocket's footprint, sampled round its edge, stay inside the outline? */
function cellFits(rings: Pt[][], x: number, y: number): boolean {
  const m = POCKET_TOP_INSET + 1.2
  const lo = 0, hi = GRID_PITCH_MM
  for (let s = 0; s <= hi; s += 2) {
    const t = Math.min(Math.max(s, m), hi - m)
    for (const [px, py] of [[t, lo + m], [t, hi - m], [lo + m, t], [hi - m, t]] as Pt[]) {
      if (!inside(rings, x + px, y + py)) return false
    }
  }
  return true
}

/** The plate's size and, for a Systainer, its fixed outline. */
function container(p: GridfinityBaseplateParams): {
  widthMm: number; depthMm: number; alignX: GridfinityAlign; alignY: GridfinityAlign
  outline?: Pt[][]
} {
  const c = p.container ?? 'drawer'
  if (c === 'drawer') {
    return {
      widthMm: Math.max(0, p.drawerWidthMm - p.clearanceMm),
      depthMm: Math.max(0, p.drawerDepthMm - p.clearanceMm),
      alignX: p.alignX,
      alignY: p.alignY,
    }
  }
  // The insert outline the tray designers cut to already fits the case, so it
  // takes no clearance; the grid sits centred so the padding is even.
  const profile = { kind: 'preset', id: c } as const
  const preset = getPreset(c)
  return {
    widthMm: preset.widthMm,
    depthMm: preset.heightMm,
    alignX: 'center',
    alignY: 'center',
    outline: profileToMulti(profile)[0].map(r => r.map(([x, y]) => [x, y] as Pt)),
  }
}

export function planBaseplate(p: GridfinityBaseplateParams): BaseplatePlan {
  const box = container(p)
  const plateWidthMm = box.widthMm
  const plateDepthMm = box.depthMm
  const cellsX = Math.floor((plateWidthMm + 1e-6) / GRID_PITCH_MM)
  const cellsY = Math.floor((plateDepthMm + 1e-6) / GRID_PITCH_MM)
  const gridX = offset(box.alignX, plateWidthMm - cellsX * GRID_PITCH_MM)
  const gridY = offset(box.alignY, plateDepthMm - cellsY * GRID_PITCH_MM)
  const empty: BaseplatePlan = {
    plateWidthMm, plateDepthMm, cellsX, cellsY, gridX, gridY, columns: [], rows: [], tiles: [],
    ...(box.outline ? { outline: box.outline } : {}),
  }
  if (cellsX < 1 || cellsY < 1) {
    return { ...empty, problem: `The drawer needs at least ${GRID_PITCH_MM} mm of room each way, after clearance.` }
  }
  if (box.outline) {
    for (let i = 0; i < cellsX; i++) for (let j = 0; j < cellsY; j++) {
      if (!cellFits(box.outline, gridX + i * GRID_PITCH_MM, gridY + j * GRID_PITCH_MM)) {
        return { ...empty, problem: 'A pocket runs into the outline\'s notches.' }
      }
    }
  }
  const columns = splitAxis(cellsX, gridX, plateWidthMm - gridX - cellsX * GRID_PITCH_MM, p.bedMm)
  const rows = splitAxis(cellsY, gridY, plateDepthMm - gridY - cellsY * GRID_PITCH_MM, p.bedMm)
  if (!columns || !rows) {
    return { ...empty, problem: 'The padding at one edge is wider than the bed. Centre the grid or reduce the clearance.' }
  }
  const tiles: BaseplateTile[] = []
  rows.forEach((r, ri) => columns.forEach((c, ci) => tiles.push({
    col: ci + 1, row: ri + 1,
    x: c.from, y: r.from, widthMm: c.to - c.from, depthMm: r.to - r.from,
    cellsX: c.endCell - c.firstCell, cellsY: r.endCell - r.firstCell,
  })))
  return { ...empty, columns, rows, tiles }
}

/** One pocket, inverse of a bin foot, open right through the plate. */
function pocket(wasm: ManifoldToplevel, x: number, y: number): Manifold {
  const cell: Outline = { x, y, w: GRID_PITCH_MM, d: GRID_PITCH_MM, r: POCKET_RADIUS_MM }
  const top = BASEPLATE_HEIGHT_MM
  const t = POCKET_TOP_INSET
  return profile(wasm, cell, [
    [t + 2.85, -1], [t + 2.85, 0], [t + 2.15, 0.7], [t + 2.15, 2.5], [t, top], [t, top + 1],
  ])
}

/**
 * One tile, built in plate coordinates and then moved to the origin so each
 * prints where the slicer expects it.
 */
function buildTile(
  wasm: ManifoldToplevel, plan: BaseplatePlan, tile: BaseplateTile, plateShape: Manifold,
): Manifold {
  const block = wasm.Manifold.cube([tile.widthMm, tile.depthMm, BASEPLATE_HEIGHT_MM])
    .translate([tile.x, tile.y, 0])
    .intersect(plateShape)
  const col = plan.columns[tile.col - 1]
  const row = plan.rows[tile.row - 1]
  const pockets: Manifold[] = []
  for (let i = col.firstCell; i < col.endCell; i++) {
    for (let j = row.firstCell; j < row.endCell; j++) {
      pockets.push(pocket(wasm, plan.gridX + i * GRID_PITCH_MM, plan.gridY + j * GRID_PITCH_MM))
    }
  }
  return block.subtract(wasm.Manifold.union(pockets)).translate([-tile.x, -tile.y, 0])
}

export interface BuiltTile {
  tile: BaseplateTile
  mesh: Mesh
}

export async function buildBaseplate(plan: BaseplatePlan): Promise<BuiltTile[]> {
  if (plan.problem) return []
  const wasm = await loadManifold()
  const r = PLATE_CORNER_RADIUS_MM
  const section = plan.outline
    ? new wasm.CrossSection(plan.outline, 'EvenOdd')
    : wasm.CrossSection
      .square([plan.plateWidthMm - 2 * r, plan.plateDepthMm - 2 * r])
      .translate([r, r])
      .offset(r, 'Round', 2, 32)
  const plateShape = section
    .extrude(BASEPLATE_HEIGHT_MM + 2)
    .translate([0, 0, -1])
  return plan.tiles.map(tile => ({
    tile,
    mesh: toAppMesh(finish(buildTile(wasm, plan, tile, plateShape), `Tile ${tile.col}-${tile.row}`)),
  }))
}
