// What goes on a baseplate: stacks of saved bins, each on a grid cell.
//
// A stack's footprint is its bottom bin's (turned a quarter if `rotated`).
// Height is what a stack actually stands to: every bin's walls add, because a
// bin's feet nest in the lip of the one below, and only the top bin's lip --
// and its lid, if it has one -- add on top. A stack over the container's clear
// height, a bin sitting on one with no lip to hold it, or a lid with a bin on
// it are all flagged rather than refused, so a plan can be sketched first and
// fixed after.
import {
  S76_BASE_DEPTH_MM, type GridfinityBaseplateParams, type GridfinityBinParams,
  type GridfinityPlacement,
} from '../../../../lib/contracts/gridfinity.ts'
import { binDimensions } from '../geometry/bin.ts'
import { LID_TOP_MM } from '../geometry/lid.ts'

/** A saved bin, as much as a layout needs of it. */
export interface LayoutBin {
  id: string
  name: string
  params: GridfinityBinParams
}

export interface ResolvedStack {
  index: number
  col: number
  row: number
  /** Footprint in cells, after any quarter turn. */
  cellsX: number
  cellsY: number
  /** Bottom first; a missing id (a deleted design) is left out. */
  bins: LayoutBin[]
  heightMm: number
  problems: string[]
}

/** The clear height stacks must fit under, or null when there is nothing to check against. */
export function heightLimit(p: GridfinityBaseplateParams): number | null {
  if (p.heightLimitMm) return p.heightLimitMm
  return p.container && p.container !== 'drawer' ? S76_BASE_DEPTH_MM : null
}

/** How tall a stack stands, bottom first. */
export function stackHeight(bins: readonly GridfinityBinParams[]): number {
  if (!bins.length) return 0
  const top = bins[bins.length - 1]
  const below = bins.slice(0, -1).reduce((mm, p) => mm + binDimensions(p).wallTopMm, 0)
  const lid = top.lid && top.stackingLip ? LID_TOP_MM : 0
  return below + binDimensions(top).heightMm + lid
}

const footprint = (bin: GridfinityBinParams, rotated?: boolean) =>
  rotated ? { cellsX: bin.gridY, cellsY: bin.gridX } : { cellsX: bin.gridX, cellsY: bin.gridY }

/** Every placement with its footprint, height and anything wrong with it. */
export function resolveLayout(
  p: GridfinityBaseplateParams, cells: { cellsX: number; cellsY: number },
  bins: ReadonlyMap<string, LayoutBin>,
): ResolvedStack[] {
  const limit = heightLimit(p)
  const placed = (p.layout ?? []).map((item, index): ResolvedStack => {
    const stack = item.stack.map(id => bins.get(id)).filter((b): b is LayoutBin => !!b)
    const base = stack[0]
    const size = base ? footprint(base.params, item.rotated) : { cellsX: 1, cellsY: 1 }
    const problems: string[] = []
    if (stack.length < item.stack.length) problems.push('A bin in this stack has been deleted.')
    if (item.col + size.cellsX > cells.cellsX || item.row + size.cellsY > cells.cellsY) {
      problems.push('Runs off the plate.')
    }
    stack.forEach((bin, k) => {
      if (k === stack.length - 1) return
      if (!bin.params.stackingLip) problems.push(`${bin.name} has no stacking lip to hold the bin on it.`)
      else if (bin.params.lid) problems.push(`${bin.name} has a lid, but another bin sits on it.`)
      const above = footprint(stack[k + 1].params, item.rotated)
      const here = footprint(bin.params, item.rotated)
      if (above.cellsX > here.cellsX || above.cellsY > here.cellsY) {
        problems.push(`${stack[k + 1].name} overhangs the bin under it.`)
      }
    })
    const heightMm = stackHeight(stack.map(b => b.params))
    if (limit !== null && heightMm > limit) {
      problems.push(`${heightMm.toFixed(1)} mm tall: ${(heightMm - limit).toFixed(1)} mm over the ${limit} mm clear height.`)
    }
    return { index, col: item.col, row: item.row, ...size, bins: stack, heightMm, problems }
  })
  // Overlaps, reported on the later of the two.
  for (let i = 0; i < placed.length; i++) {
    for (let j = 0; j < i; j++) {
      if (overlaps(placed[i], placed[j])) placed[i].problems.push('Overlaps another stack.')
    }
  }
  return placed
}

type Box = { col: number; row: number; cellsX: number; cellsY: number }
const overlaps = (a: Box, b: Box) =>
  a.col < b.col + b.cellsX && b.col < a.col + a.cellsX && a.row < b.row + b.cellsY && b.row < a.row + a.cellsY

/** Whether a bin of this footprint can go at (col, row) without running off or onto another stack. */
export function canPlace(
  stacks: readonly ResolvedStack[], cells: { cellsX: number; cellsY: number }, box: Box,
): boolean {
  if (box.col < 0 || box.row < 0) return false
  if (box.col + box.cellsX > cells.cellsX || box.row + box.cellsY > cells.cellsY) return false
  return !stacks.some(s => overlaps(s, box))
}

/** The stack covering a cell, if any. */
export const stackAt = (stacks: readonly ResolvedStack[], col: number, row: number): ResolvedStack | undefined =>
  stacks.find(s => overlaps(s, { col, row, cellsX: 1, cellsY: 1 }))

/** How many of each saved bin the layout uses, for exporting each once. */
export function binCounts(layout: readonly GridfinityPlacement[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of layout) for (const id of item.stack) counts.set(id, (counts.get(id) ?? 0) + 1)
  return counts
}
