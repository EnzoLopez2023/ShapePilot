// "Does this footprint sit wholly on solid material?", answered thousands of
// times without a polygon boolean.
//
// A tray outline is rasterised once into a solid/void bitmap and reduced to a
// summed-area table. After that a containment test is four array reads, which
// is what makes searching a lattice origin across hundreds of offsets, or
// auto-packing a parts list, affordable at all.
//
// The raster is deliberately *conservative*: a pixel counts as solid only when
// its centre is inside, so a footprint can be rejected for coming within one
// raster cell of the outline. It will never claim a placement that does not
// fit, which is what makes it safe to trust at a zero margin.
//
// Extracted from the switch tray's fill planner, which still owns the
// lattice-specific part; the tool tray needs the same mask for placement
// validation and packing, and both must share one raster.
import type { MultiPolygon, Polygon } from './vec.ts'
import { multiBBox, ringBBox } from './vec.ts'

/** Raster resolution. The conservatism band is one of these, so keep it small. */
export const RASTER_MM = 0.15

export interface SolidMask {
  minX: number
  minY: number
  cols: number
  rows: number
  cellMm: number
  /** Summed-area table, `(cols + 1) * (rows + 1)`, row-major. */
  sat: Int32Array
}

/**
 * Scanline rasterisation of a multipolygon, even-odd, sampling pixel centres.
 * Even-odd is right for a profile whether or not its holes are wound the other
 * way, and the server refuses overlapping polygons, so the two agree.
 */
export function rasterise(region: MultiPolygon, blockers: Polygon[], cellMm: number): SolidMask {
  const bb = multiBBox(region)
  const cols = Math.max(1, Math.ceil((bb.maxX - bb.minX) / cellMm))
  const rows = Math.max(1, Math.ceil((bb.maxY - bb.minY) / cellMm))
  const solid = new Uint8Array(cols * rows)

  const edges: [number, number, number, number][] = []
  for (const poly of region) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i]
        const [bx, by] = ring[(i + 1) % ring.length]
        if (ay !== by) edges.push([ax, ay, bx, by])
      }
    }
  }

  const xs: number[] = []
  for (let j = 0; j < rows; j++) {
    const y = bb.minY + (j + 0.5) * cellMm
    xs.length = 0
    for (const [ax, ay, bx, by] of edges) {
      // Half-open in y, so a vertex shared by two edges is counted once.
      if ((ay > y) === (by > y)) continue
      xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax))
    }
    if (xs.length < 2) continue
    xs.sort((a, b) => a - b)
    const base = j * cols
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Pixel centres strictly inside the span.
      let i0 = Math.ceil((xs[k] - bb.minX) / cellMm - 0.5)
      let i1 = Math.floor((xs[k + 1] - bb.minX) / cellMm - 0.5)
      if (i0 < 0) i0 = 0
      if (i1 > cols - 1) i1 = cols - 1
      for (let i = i0; i <= i1; i++) solid[base + i] = 1
    }
  }

  // Anything already spoken for -- a post, a nameplate -- is void from here on,
  // so no cell can be planned on top of it.
  for (const blocker of blockers) {
    const b = ringBBox(blocker[0])
    const i0 = Math.max(0, Math.floor((b.minX - bb.minX) / cellMm))
    const i1 = Math.min(cols - 1, Math.ceil((b.maxX - bb.minX) / cellMm))
    const j0 = Math.max(0, Math.floor((b.minY - bb.minY) / cellMm))
    const j1 = Math.min(rows - 1, Math.ceil((b.maxY - bb.minY) / cellMm))
    for (let j = j0; j <= j1; j++) {
      const base = j * cols
      for (let i = i0; i <= i1; i++) solid[base + i] = 0
    }
  }

  // Summed-area table, one guard row and column so a query never branches.
  const w = cols + 1
  const sat = new Int32Array(w * (rows + 1))
  for (let j = 0; j < rows; j++) {
    let rowSum = 0
    const src = j * cols
    const dst = (j + 1) * w
    const above = j * w
    for (let i = 0; i < cols; i++) {
      rowSum += solid[src + i]
      sat[dst + i + 1] = sat[above + i + 1] + rowSum
    }
  }
  return { minX: bb.minX, minY: bb.minY, cols, rows, cellMm, sat }
}

/**
 * Is every pixel the rectangle touches solid? Four reads, whatever the size.
 *
 * The index range is the *overlapping* pixel set, so nothing straddling the
 * boundary is missed. The remaining conservatism is one pixel per side, because
 * a pixel is solid only when its centre is inside -- a rectangle can therefore
 * be rejected for coming within `RASTER_MM` of the outline, which is what makes
 * the planner safe to trust at a zero margin.
 */
export function allSolid(m: SolidMask, x0: number, y0: number, x1: number, y1: number): boolean {
  const i0 = Math.floor((x0 - m.minX) / m.cellMm)
  const j0 = Math.floor((y0 - m.minY) / m.cellMm)
  const i1 = Math.ceil((x1 - m.minX) / m.cellMm)
  const j1 = Math.ceil((y1 - m.minY) / m.cellMm)
  if (i0 < 0 || j0 < 0 || i1 > m.cols || j1 > m.rows) return false
  if (i1 <= i0 || j1 <= j0) return false
  const w = m.cols + 1
  const sum = m.sat[j1 * w + i1] - m.sat[j0 * w + i1] - m.sat[j1 * w + i0] + m.sat[j0 * w + i0]
  return sum === (i1 - i0) * (j1 - j0)
}


/** Rasterise a region, minus anything already spoken for, into a mask. */
export function buildSolidMask(
  region: MultiPolygon, blockers: Polygon[], cellMm = RASTER_MM,
): SolidMask {
  return rasterise(region, blockers, cellMm)
}
