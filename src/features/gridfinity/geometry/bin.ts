// The Gridfinity storage bin. Modelled on the classic open bin: one foot per
// grid cell, solid floor, thin walls, a stacking lip, a finger scoop along the
// front and a label shelf across the back.
//
// Coordinates: x across the bin (gridX), y front-to-back (gridY, the front at
// y = 0), z up from the underside of the feet. Every dimension is the
// Gridfinity spec's, so bins drop into any standard baseplate.
import type { Manifold, ManifoldToplevel, Vec3 } from 'manifold-3d'
import type { Font } from 'opentype.js'
import { loadManifold } from '../../../csg/manifold.ts'
import { toAppMesh } from '../../../csg/evaluate.ts'
import type { Mesh } from '../../../geometry/mesh.ts'
import { DEFAULT_FONT_ID, loadFont, traceTextPolys } from '../../../text/fonts.ts'
import {
  GRID_PITCH_MM, HEIGHT_UNIT_MM, type GridfinityBinParams,
} from '../../../../lib/contracts/gridfinity.ts'
import { band, finish, profile, ring, type Outline } from './shapes.ts'

/** Bins are 0.5 mm under the grid so neighbours never bind. */
export const BIN_CLEARANCE_MM = 0.5
export const OUTER_RADIUS_MM = 3.75
export const WALL_MM = 1.2
/** Underside of the feet to the top of the solid floor. */
export const FLOOR_TOP_MM = 6
/** Underside of the feet to where the body proper starts. */
export const FOOT_HEIGHT_MM = 4.75
export const LIP_HEIGHT_MM = 4.4
/** Insets of the lip's inner face, from the outer wall. */
const LIP_INSET_BOTTOM = 2.6
const LIP_INSET_MID = 0.7
const LIP_INSET_TOP = 0.4
export const TEXT_RAISE_MM = 0.6
export const LABEL_TAB_DEPTH_MM = 13
const TAB_LIP_MM = 1.2
const MAGNET_DIAMETER_MM = 6.5
const MAGNET_DEPTH_MM = 2.4
const MAGNET_OFFSET_MM = 13
/** Thin walls splitting a bin into compartments. */
export const DIVIDER_MM = 1.2
/**
 * How far below the lip's top the thumb notch goes, when a lid is on: deep
 * enough for a fingernail under the lid's plate edge, which overhangs the plug.
 */
/** How far inside the outer skin the scoop, tab and dividers stop. */
const EXTRAS_INSET_MM = 0.3
export const THUMB_NOTCH_DEPTH_MM = 2
export const THUMB_NOTCH_WIDTH_MM = 16

export interface BinDimensions {
  widthMm: number
  depthMm: number
  /** Top of the walls, 7 mm per height unit. */
  wallTopMm: number
  /** Overall height, lip included. */
  heightMm: number
  /** The top of the label tab, where the text stands. */
  tabTopMm: number
  tabDepthMm: number
  scoopRadiusMm: number
}

export function binDimensions(p: GridfinityBinParams): BinDimensions {
  const widthMm = GRID_PITCH_MM * p.gridX - BIN_CLEARANCE_MM
  const depthMm = GRID_PITCH_MM * p.gridY - BIN_CLEARANCE_MM
  const wallTopMm = HEIGHT_UNIT_MM * p.heightUnits
  const heightMm = wallTopMm + (p.stackingLip ? LIP_HEIGHT_MM : 0)
  // Below where the lip starts to overhang, and low enough that a bin stacked
  // on this one never lands its feet on the text.
  const tabTopMm = wallTopMm - (p.stackingLip ? LIP_INSET_BOTTOM - WALL_MM : 0.8)
  const innerDepth = depthMm - 2 * WALL_MM
  const tabDepthMm = Math.min(LABEL_TAB_DEPTH_MM, innerDepth * 0.45)
  const cavity = tabTopMm - FLOOR_TOP_MM
  const scoopRadiusMm = Math.max(0, Math.min(20, cavity - 4, innerDepth * 0.4))
  return { widthMm, depthMm, wallTopMm, heightMm, tabTopMm, tabDepthMm, scoopRadiusMm }
}

/** Per-cell foot: 45° chamfer, short vertical, 45° chamfer out to the body. */
function foot(wasm: ManifoldToplevel, cx: number, cy: number): Manifold {
  const cell: Outline = { x: cx - 20.75, y: cy - 20.75, w: 41.5, d: 41.5, r: OUTER_RADIUS_MM }
  return profile(wasm, cell, [
    [2.95, 0], [2.15, 0.8], [2.15, 2.6], [0, FOOT_HEIGHT_MM], [0, FOOT_HEIGHT_MM + 0.25],
  ])
}

function cellCentres(p: GridfinityBinParams): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < p.gridX; i++) {
    for (let j = 0; j < p.gridY; j++) {
      out.push([20.75 + GRID_PITCH_MM * i, 20.75 + GRID_PITCH_MM * j])
    }
  }
  return out
}

/** The air inside the bin: walls, lip support chamfer, then the lip itself. */
function cavity(wasm: ManifoldToplevel, body: Outline, p: GridfinityBinParams, d: BinDimensions): Manifold {
  const top = d.heightMm + 1
  if (!p.stackingLip) return band(wasm, body, [WALL_MM, FLOOR_TOP_MM], [WALL_MM, top])
  const H = d.wallTopMm
  const supportBottom = H - (LIP_INSET_BOTTOM - WALL_MM)
  return wasm.Manifold.union([
    band(wasm, body, [WALL_MM, FLOOR_TOP_MM], [WALL_MM, supportBottom]),
    band(wasm, body, [WALL_MM, supportBottom], [LIP_INSET_BOTTOM, H]),
    band(wasm, body, [LIP_INSET_BOTTOM, H], [LIP_INSET_MID, H + 1.9]),
    band(wasm, body, [LIP_INSET_MID, H + 1.9], [LIP_INSET_MID, H + 3.7]),
    band(wasm, body, [LIP_INSET_MID, H + 3.7], [LIP_INSET_TOP, H + 4.0]),
    band(wasm, body, [LIP_INSET_TOP, H + 4.0], [LIP_INSET_TOP, top]),
  ])
}

/** Solid that fills the floor-to-front-wall corner with a concave quarter round. */
function scoop(wasm: ManifoldToplevel, d: BinDimensions): Manifold | null {
  const R = d.scoopRadiusMm
  if (R < 2) return null
  const y0 = WALL_MM - 0.01
  const z0 = FLOOR_TOP_MM - 0.01
  const box = wasm.Manifold.cube([d.widthMm, R + 0.01, R + 0.01]).translate([0, y0, z0])
  const cylinder = wasm.Manifold.cylinder(d.widthMm + 2, R, R, 96)
    .rotate([0, 90, 0])
    .translate([-1, WALL_MM + R, FLOOR_TOP_MM + R])
  return box.subtract(cylinder)
}

/** The shelf across the back wall: flat top, 45° underside down to the wall. */
function labelTab(wasm: ManifoldToplevel, d: BinDimensions): Manifold {
  const back = d.depthMm - WALL_MM + 0.5
  const front = d.depthMm - WALL_MM - d.tabDepthMm
  const top = d.tabTopMm
  const lipBottom = top - TAB_LIP_MM
  const wallFoot = Math.max(FLOOR_TOP_MM, lipBottom - (back - front))
  const pts: Vec3[] = []
  for (const x of [0, d.widthMm]) {
    pts.push([x, back, top], [x, front, top], [x, front, lipBottom], [x, back, wallFoot])
  }
  return wasm.Manifold.hull(pts)
}

/**
 * Raised text, centred on the tab, reading from the front of the bin. Scaled
 * down -- never up -- until it fits the tab with a margin all round.
 */
function labelText(
  wasm: ManifoldToplevel, font: Font, p: GridfinityBinParams, d: BinDimensions, separate: boolean,
): Manifold | null {
  const text = p.labelText.trim()
  if (!text) return null
  const polys = traceTextPolys(font, text, p.textSizeMm)
  if (!polys.length) return null
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const poly of polys) for (const r of poly) for (const [x, y] of r) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  const room = labelRoom(d)
  const scale = Math.min(1, room.widthMm / (maxX - minX), room.depthMm / (maxY - minY))
  const sections = polys.map(poly => new wasm.CrossSection(
    poly.map(r => r.map(([x, y]) => [x * scale, y * scale] as [number, number])), 'EvenOdd'))
  const outline = wasm.CrossSection.union(sections)
  const cx = d.widthMm / 2
  const cy = d.depthMm - WALL_MM - d.tabDepthMm / 2
  // Merged, it sinks a hair into the tab so the union welds. Separate, it sits
  // exactly on the tab: two parts that touch, which is what a slicer wants.
  const sink = separate ? 0 : 0.05
  return outline.extrude(TEXT_RAISE_MM + sink).translate([cx, cy, d.tabTopMm - sink])
}

/** How much of the tab top the text may use. */
export const labelRoom = (d: BinDimensions): { widthMm: number; depthMm: number } => ({
  widthMm: Math.max(1, d.widthMm - 2 * WALL_MM - 4),
  depthMm: Math.max(1, d.tabDepthMm - 2.5),
})

/**
 * Divider walls, as positions along each axis, in the bin's frame. They split
 * the inside evenly, run wall to wall, and stop below where a lid's barbs or a
 * stacked bin's feet reach.
 */
export function dividerLayout(p: GridfinityBinParams, d: BinDimensions): {
  xs: number[]; ys: number[]; topMm: number
} {
  const split = (n: number | undefined, size: number) => {
    const count = Math.max(1, Math.min(n ?? 1, 6))
    const inner = size - 2 * WALL_MM
    return Array.from({ length: count - 1 }, (_, i) => WALL_MM + (inner * (i + 1)) / count)
  }
  return {
    xs: split(p.compartmentsX, d.widthMm),
    ys: split(p.compartmentsY, d.depthMm),
    topMm: d.tabTopMm - 0.6,
  }
}

function dividers(wasm: ManifoldToplevel, p: GridfinityBinParams, d: BinDimensions): Manifold | null {
  const { xs, ys, topMm } = dividerLayout(p, d)
  const height = topMm - FLOOR_TOP_MM + 0.01
  if (height <= 1 || (!xs.length && !ys.length)) return null
  const z = FLOOR_TOP_MM - 0.01
  const walls = [
    ...xs.map(x => wasm.Manifold.cube([DIVIDER_MM, d.depthMm, height]).translate([x - DIVIDER_MM / 2, 0, z])),
    ...ys.map(y => wasm.Manifold.cube([d.widthMm, DIVIDER_MM, height]).translate([0, y - DIVIDER_MM / 2, z])),
  ]
  return wasm.Manifold.union(walls)
}

/** The cut at the front of the lip that lets a fingernail under a lid. */
function thumbNotch(wasm: ManifoldToplevel, d: BinDimensions): Manifold {
  return wasm.Manifold.cube([THUMB_NOTCH_WIDTH_MM, 4, THUMB_NOTCH_DEPTH_MM + 1])
    .translate([(d.widthMm - THUMB_NOTCH_WIDTH_MM) / 2, -1, d.heightMm - THUMB_NOTCH_DEPTH_MM])
}

function magnetHoles(wasm: ManifoldToplevel, p: GridfinityBinParams): Manifold {
  const holes: Manifold[] = []
  for (const [cx, cy] of cellCentres(p)) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      holes.push(wasm.Manifold.cylinder(MAGNET_DEPTH_MM + 0.01, MAGNET_DIAMETER_MM / 2, -1, 48)
        .translate([cx + sx * MAGNET_OFFSET_MM, cy + sy * MAGNET_OFFSET_MM, -0.01]))
    }
  }
  return wasm.Manifold.union(holes)
}

export interface BinParts {
  /** The bin, without the label when that is a separate body. */
  body: Mesh
  /** The raised label as its own body, for a second filament. */
  label: Mesh | null
}

/**
 * The bin as the bodies it prints in. One body unless `labelSeparate` is set
 * and there is text, in which case the label comes out on its own, sitting on
 * the tab in the same frame so the two stay aligned in the slicer.
 *
 * `withFont` is for tests, which read the font from disk rather than fetch it.
 */
export async function buildBinParts(p: GridfinityBinParams, withFont?: Font): Promise<BinParts> {
  const wasm = await loadManifold()
  const wantsText = p.labelTab && p.labelText.trim() !== ''
  const font = wantsText ? withFont ?? await loadFont(DEFAULT_FONT_ID) : null
  const separate = !!p.labelSeparate
  const d = binDimensions(p)
  const body: Outline = { x: 0, y: 0, w: d.widthMm, d: d.depthMm, r: OUTER_RADIUS_MM }

  const shell = wasm.Manifold.union([
    ...cellCentres(p).map(([cx, cy]) => foot(wasm, cx, cy)),
    wasm.Manifold.hull([...ring(body, 0, FOOT_HEIGHT_MM), ...ring(body, 0, d.heightMm)]),
  ])
  let solid = shell.subtract(cavity(wasm, body, p, d))

  const extras: Manifold[] = []
  if (p.scoop) {
    const s = scoop(wasm, d)
    if (s) extras.push(s)
  }
  if (p.labelTab) extras.push(labelTab(wasm, d))
  const walls = dividers(wasm, p, d)
  if (walls) extras.push(walls)
  if (extras.length) {
    // Trimmed just inside the outer skin, never to it: an extra cut flush with
    // the outer wall leaves zero-area slivers and pinched vertices along the
    // seam, and Bambu Studio flags those as "reversed faces". 0.3 mm in still
    // overlaps the 1.2 mm wall by 0.9 mm, so the union welds.
    const inside = wasm.Manifold.hull([
      ...ring(body, EXTRAS_INSET_MM, FOOT_HEIGHT_MM), ...ring(body, EXTRAS_INSET_MM, d.heightMm),
    ])
    solid = solid.add(wasm.Manifold.union(extras).intersect(inside))
  }
  const text = font ? labelText(wasm, font, p, d, separate) : null
  if (text && !separate) solid = solid.add(text)
  if (p.magnets) solid = solid.subtract(magnetHoles(wasm, p))
  if (p.lid && p.stackingLip) solid = solid.subtract(thumbNotch(wasm, d))

  return {
    body: toAppMesh(finish(solid, 'The bin')),
    label: text && separate ? toAppMesh(finish(text, 'The label')) : null,
  }
}

/** The bin as one mesh -- the label merged in whatever `labelSeparate` says. */
export async function buildBin(p: GridfinityBinParams, withFont?: Font): Promise<Mesh> {
  return (await buildBinParts({ ...p, labelSeparate: false }, withFont)).body
}
