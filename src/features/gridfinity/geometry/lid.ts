// A lid for a Gridfinity bin with a stacking lip, that clicks in.
//
// The lid's underside is the same 45° profile as a bin's feet, run round the
// whole bin outline instead of per cell, so it seats in the lip exactly as a
// stacked bin does: its lower chamfer rests on the lip's chamfer and the plate
// lands on the lip's top. The plug is hollow, and the plate above it is all
// that shows.
//
// The lip itself is a funnel -- widest at the top -- so nothing in it can hold
// a lid down. What can is the 45° ledge *under* it, where the lip's support
// chamfer meets the bin wall: the air there widens again going down. So on
// each side wall a springy finger, cut free of the plug by two slots, hangs
// below the plug and carries a small barb. Pushing the lid in, the support
// chamfer squeezes the barbs in by `CATCH_MM`; once past it they spring back
// out underneath, and the lid has to be pulled hard enough to bend them in
// again to come off. Fingers sit on the side walls only, clear of the label
// tab and its text at the back.
//
// Coordinates are the bin's (see bin.ts), with the lid seated, so the preview
// can draw both in one frame. `printLid` turns it over, plate on the bed.
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d'
import { loadManifold } from '../../../csg/manifold.ts'
import { toAppMesh } from '../../../csg/evaluate.ts'
import type { Mesh } from '../../../geometry/mesh.ts'
import type { Font } from 'opentype.js'
import { DEFAULT_FONT_ID, loadFont, traceTextPolys } from '../../../text/fonts.ts'
import {
  GRID_PITCH_MM, HEIGHT_UNIT_MM, type GridfinityBinParams,
} from '../../../../lib/contracts/gridfinity.ts'
import { FOOT_HEIGHT_MM, LIP_HEIGHT_MM, OUTER_RADIUS_MM, WALL_MM, binDimensions } from './bin.ts'
import { finish, profile, ring, type Outline } from './shapes.ts'

/** The plate on top, mm. */
export const LID_TOP_MM = 2
/** How far a seated lid sits below where a foot's profile would start. */
const SEAT_DROP_MM = FOOT_HEIGHT_MM - LIP_HEIGHT_MM
/** Wall of the hollow plug, measured across. */
const PLUG_WALL_MM = 1.2
/** Inset of the lip's narrowest point, at the wall top: what a barb must pass. */
const LIP_THROAT_INSET = 2.6
/** How far each barb reaches past the throat -- the bend that makes the click. */
export const CATCH_MM = 0.3
/** Play between a seated barb and the ledge, so the lid seats on the lip, not the barbs. */
const CATCH_PLAY_MM = 0.15
const FINGER_WIDTH_MM = 8
const SLOT_MM = 0.8
/** Below the wall top: how far the barbs reach down into the bin. */
const FINGER_REACH_MM = 1.8
/** The barb's lead-in, from vertical: shallow so it pushes in without force. */
const LEAD_IN_DEG = 30

/** How deep the label is cut into the lid's top. Three 0.2 mm layers: it prints first, face down. */
export const LID_TEXT_DEPTH_MM = 0.6
/** Clear border round the lid's label. */
const LID_TEXT_MARGIN_MM = 5

/** Gap between the plug and the lip on every face, so the plate is what the lid rests on. */
const PLUG_CLEARANCE_MM = 0.1
/**
 * The plug, as (inset, height above its underside): a bin foot's profile, but
 * stopping at the lip's vertical rim (inset 0.4) instead of running out to the
 * wall, which would ride up on the rim. Everything sits PLUG_CLEARANCE_MM in.
 */
const PLUG_STATIONS: readonly (readonly [number, number])[] = (
  [[2.95, 0], [2.15, 0.8], [2.15, 2.6], [0.4, 4.35], [0.4, FOOT_HEIGHT_MM]] as const
).map(([inset, z]) => [inset + PLUG_CLEARANCE_MM, z] as const)

export interface LidDimensions {
  /** The plug's underside, in the bin's frame. */
  plugBottomMm: number
  /** The plate's underside: the lip's top. */
  plateBottomMm: number
  /** The top of the lid -- the bin's new overall height. */
  topMm: number
  /** Where each catch finger sits along the side walls, by its centre's y. */
  fingerYs: number[]
}

export function lidDimensions(p: GridfinityBinParams): LidDimensions {
  const d = binDimensions(p)
  const plugBottomMm = d.wallTopMm - SEAT_DROP_MM
  const plateBottomMm = plugBottomMm + FOOT_HEIGHT_MM
  // One finger per cell along each side, kept off the label tab -- its text
  // stands closer under the plug than a barb clears. A finger that would reach
  // the tab slides forward instead, and is dropped only if that takes it into
  // the cell in front's finger or the front corner.
  const half = FINGER_WIDTH_MM / 2 + SLOT_MM
  const last = p.labelTab ? d.depthMm - WALL_MM - d.tabDepthMm - 2 - half : Infinity
  const fingerYs: number[] = []
  for (let j = 0; j < p.gridY; j++) {
    const y = Math.min(GRID_PITCH_MM / 2 - 0.25 + GRID_PITCH_MM * j, last)
    const previous = fingerYs.at(-1) ?? -Infinity
    if (y - half >= OUTER_RADIUS_MM + 4 && y - previous >= 2 * half + 4) fingerYs.push(y)
  }
  return { plugBottomMm, plateBottomMm, topMm: plateBottomMm + LID_TOP_MM, fingerYs }
}

/** A polygon in (x, z), extruded along y from y0 to y1. */
function prismY(wasm: ManifoldToplevel, pts: [number, number][], y0: number, y1: number): Manifold {
  const section: CrossSection = new wasm.CrossSection([pts], 'Positive')
  // Extrusion runs along z; turn it so the polygon's second axis is z and the
  // extrusion runs along +y.
  return section.extrude(y1 - y0).rotate([90, 0, 0]).translate([0, y1, 0])
}

/**
 * One catch on the x = 0 side, in (inset, z): the strip below the plug and its
 * barb. Mirrored for the other side.
 */
function catchOutline(H: number, plugBottom: number): [number, number][] {
  const fingerFace = PLUG_STATIONS[0][0]
  const inner = fingerFace + PLUG_WALL_MM
  const tip = LIP_THROAT_INSET - CATCH_MM
  // The barb's top runs parallel to the ledge (45°), CATCH_PLAY_MM below it,
  // until it meets the plug's own outer chamfer.
  const tipTop = H - (LIP_THROAT_INSET + CATCH_PLAY_MM - tip)
  const tipBottom = tipTop - 0.1
  const meet = (fingerFace + plugBottom - tip + tipTop) / 2
  const leadIn = (fingerFace - tip) / Math.tan((LEAD_IN_DEG * Math.PI) / 180)
  const bottom = H - FINGER_REACH_MM
  return [
    [tip, tipBottom],
    [fingerFace, tipBottom - leadIn],
    [fingerFace, bottom],
    [inner, bottom],
    // Up the hollow's face to the plug's underside, then into the plug wall so
    // the finger welds to it.
    [inner, plugBottom],
    [inner - 0.75, plugBottom + 0.5],
    [tip + (meet - tipTop), meet],
    [tip, tipTop],
  ]
}

/** The lid, seated on the bin it was made for. */
export function lidSolid(wasm: ManifoldToplevel, p: GridfinityBinParams): Manifold {
  const d = binDimensions(p)
  const L = lidDimensions(p)
  const H = HEIGHT_UNIT_MM * p.heightUnits
  const body: Outline = { x: 0, y: 0, w: d.widthMm, d: d.depthMm, r: OUTER_RADIUS_MM }
  const z0 = L.plugBottomMm

  // The plate is square-edged out to the wall, so its underside rests on the
  // lip's top; the plug hangs below it.
  const outer = wasm.Manifold.union([
    profile(wasm, body, PLUG_STATIONS.map(([inset, z]) => [inset, z0 + z] as const)),
    wasm.Manifold.hull([...ring(body, 0, L.plateBottomMm), ...ring(body, 0, L.topMm)]),
  ])
  const hollow = profile(wasm, body, [
    [PLUG_STATIONS[0][0] + PLUG_WALL_MM, z0 - 1],
    ...PLUG_STATIONS.map(([inset, z]) => [inset + PLUG_WALL_MM, z0 + z] as const),
  ])
  let lid = outer.subtract(hollow)

  const catches: Manifold[] = []
  const slots: Manifold[] = []
  const outline = catchOutline(H, z0)
  const slotDepth = PLUG_STATIONS[0][0] + PLUG_WALL_MM + 0.5
  for (const y of L.fingerYs) {
    const y0 = y - FINGER_WIDTH_MM / 2
    const y1 = y + FINGER_WIDTH_MM / 2
    const left = prismY(wasm, outline, y0, y1)
    catches.push(left, left.mirror([1, 0, 0]).translate([d.widthMm, 0, 0]))
    for (const [a, b] of [[y0 - SLOT_MM, y0], [y1, y1 + SLOT_MM]]) {
      const slot = wasm.Manifold.cube([slotDepth + 1, b - a, L.plateBottomMm - (z0 - 3)])
        .translate([-1, a, z0 - 3])
      slots.push(slot, slot.mirror([1, 0, 0]).translate([d.widthMm, 0, 0]))
    }
  }
  if (slots.length) lid = lid.subtract(wasm.Manifold.union(slots))
  if (catches.length) lid = lid.add(wasm.Manifold.union(catches))
  return finish(lid, 'The lid')
}

/** Whether this bin's lid carries text. */
export const lidHasText = (p: GridfinityBinParams): boolean =>
  !!p.lid && !!p.lidLabel && p.stackingLip && p.labelText.trim() !== ''

/**
 * The label as a solid filling the cut in the lid's top: subtract it from the
 * lid to engrave, or print it on its own as an inlay in a second colour. Same
 * text and size as the tab, grown to use the lid but shrunk to fit it.
 */
export function lidTextSolid(wasm: ManifoldToplevel, font: Font, p: GridfinityBinParams): Manifold | null {
  const text = p.labelText.trim()
  if (!text) return null
  const polys = traceTextPolys(font, text, p.textSizeMm)
  if (!polys.length) return null
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const poly of polys) for (const ring of poly) for (const [x, y] of ring) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  const d = binDimensions(p)
  const { topMm } = lidDimensions(p)
  // Keep clear of the thumb notch's lip at the front and the plug edge round the rest.
  const roomW = d.widthMm - 2 * LID_TEXT_MARGIN_MM
  const roomD = d.depthMm - 2 * LID_TEXT_MARGIN_MM
  if (roomW <= 2 || roomD <= 2) return null
  const scale = Math.min(roomW / (maxX - minX), roomD / (maxY - minY), 2)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const sections = polys.map(poly => new wasm.CrossSection(
    poly.map(r => r.map(([x, y]) => [(x - cx) * scale, (y - cy) * scale] as [number, number])), 'EvenOdd'))
  return wasm.CrossSection.union(sections)
    .extrude(LID_TEXT_DEPTH_MM)
    .translate([d.widthMm / 2, d.depthMm / 2, topMm - LID_TEXT_DEPTH_MM])
}

/** The lid turned over to print: plate flat on the bed, fingers up, same footprint. */
export function printLid(lid: Manifold, p: GridfinityBinParams): Manifold {
  const d = binDimensions(p)
  const { topMm } = lidDimensions(p)
  return lid.rotate([180, 0, 0]).translate([0, d.depthMm, topMm])
}

export interface LidParts {
  /** Seated on the bin, in the bin's frame: for the preview. */
  seated: Mesh
  /** Turned over on the bed, for export. */
  print: Mesh
  /**
   * The label as an inlay filling its cut, when the bin's text prints in a
   * second colour: seated and turned over, in step with the lid.
   */
  label: { seated: Mesh; print: Mesh } | null
}

/**
 * The lid for bin `p`, or null when the bin has no lip to take one.
 * `withFont` is for tests, which read the font from disk.
 */
export async function buildLid(p: GridfinityBinParams, withFont?: Font): Promise<LidParts | null> {
  if (!p.lid || !p.stackingLip) return null
  const wasm = await loadManifold()
  let lid = lidSolid(wasm, p)
  const font = lidHasText(p) ? withFont ?? await loadFont(DEFAULT_FONT_ID) : null
  const text = font ? lidTextSolid(wasm, font, p) : null
  if (text) lid = finish(lid.subtract(text), 'The lid')
  const inlay = text && p.labelSeparate ? finish(text, 'The lid label') : null
  return {
    seated: toAppMesh(lid),
    print: toAppMesh(finish(printLid(lid, p), 'The lid')),
    label: inlay ? { seated: toAppMesh(inlay), print: toAppMesh(printLid(inlay, p)) } : null,
  }
}
