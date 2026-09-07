// The plate as an ordered list of z-bands, meshed by the same two rules the
// keycap tray uses: a horizontal face at every band interface, a wall for every
// band. There is no 3D CSG here either -- every feature is a 2D polygon
// extruded straight up.
//
//   z = 0        .. H + weld    feet, as independent closed boxes
//   z = H        .. H + S       shelf band  = profile - body holes
//   z = H + S    .. H + S + R   recess band = shelf   - housing recesses
//
// A `clip` or `plain` plate has R = 0 and only the first two exist.
import type { MultiPolygon, Polygon } from '../../../geometry/vec.ts'
import { translateRing } from '../../../geometry/vec.ts'
import {
  difference, intersection, punchDisjointFast, union, unionDisjointFast,
} from '../../../geometry/boolean.ts'
import { rectRing } from '../../../geometry/primitives.ts'
import { insertTJunctions } from '../../../geometry/tjunction.ts'
import type { Mesh } from '../../../geometry/mesh.ts'
import { MeshBuilder } from '../../../geometry/mesh.ts'
import { profileToMulti } from '../../../model/trayProfile.ts'
import { cellHoleMm, cellKeepoutMm, feetHeightMm } from '../model/defaults.ts'
import type { NameplateStyle, SwitchTrayDesign } from '../model/types.ts'
import type { FillPlan } from './fill.ts'
import { FOOT_WELD_MM, feetRects } from './feet.ts'

/** Segments per 90° corner on a cell. 0.5 mm radius, so 8 is already invisible. */
const CELL_CORNER_SEGMENTS = 8

/** How far a *raised* nameplate dips into the plate so a slicer welds the
 *  overlap. An inlay shares an exact boundary instead -- an overlap there would
 *  be two extruders claiming the same space. */
const NAMEPLATE_WELD_MM = 0.05

/** Default cut for an inlay or inset: three layers at 0.2 mm. */
export const DEFAULT_NAMEPLATE_DEPTH_MM = 0.6

export const nameplateStyleOf = (design: SwitchTrayDesign): NameplateStyle =>
  design.nameplate?.style ?? 'raised'

/** The glyph run in tray coordinates. Outlines arrive centred on their own bounds. */
export function placeGlyphs(
  design: SwitchTrayDesign, outlines: MultiPolygon | null | undefined,
): MultiPolygon {
  const np = design.nameplate
  if (!np || !outlines?.length) return []
  return outlines.map(poly => poly.map(ring => translateRing(ring, np.x, np.y)))
}

/**
 * The rectangle the name occupies, for the fill to treat as spoken for.
 *
 * The run has to sit on solid plate, and at a working pitch the web between two
 * switch recesses is barely a millimetre -- so the name cannot thread through
 * the field and has to displace cells instead. Reserving the box is what makes
 * that happen deliberately rather than by the two overlapping.
 */
export function nameplateBox(
  design: SwitchTrayDesign,
  outlines: MultiPolygon | null | undefined,
  marginMm = 1,
): Polygon[] {
  const glyphs = placeGlyphs(design, outlines)
  if (!glyphs.length) return []
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const poly of glyphs) for (const ring of poly) for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  if (!Number.isFinite(minX)) return []
  const w = maxX - minX + 2 * marginMm
  const h = maxY - minY + 2 * marginMm
  return [[translateRing(rectRing(w, h), minX - marginMm, minY - marginMm)]]
}

/** How deep an inlay or inset cuts. Zero for a raised boss, which adds instead. */
export const nameplateDepthMm = (design: SwitchTrayDesign): number => {
  const np = design.nameplate
  if (!np || nameplateStyleOf(design) === 'raised') return 0
  return Math.max(0, np.depthMm ?? DEFAULT_NAMEPLATE_DEPTH_MM)
}

const unionAll = (polys: Polygon[]): MultiPolygon => {
  if (!polys.length) return []
  return unionDisjointFast(polys) ?? union(...polys.map(p => [p]))
}

const punch = (outer: MultiPolygon, holes: Polygon[]): MultiPolygon => {
  if (!holes.length) return outer
  return punchDisjointFast(outer, holes) ?? difference(outer, unionAll(holes))
}

/** One square cell, centred on `(cx, cy)`. */
export function cellRing(cx: number, cy: number, sizeMm: number, radiusMm: number): Polygon {
  const r = Math.max(0, Math.min(radiusMm, sizeMm / 2))
  return [translateRing(
    rectRing(sizeMm, sizeMm, r, CELL_CORNER_SEGMENTS), cx - sizeMm / 2, cy - sizeMm / 2)]
}

export interface PlateBands {
  profile: MultiPolygon
  /** `z = H .. H+S`, the band the body holes go through. */
  shelf: MultiPolygon
  /** `z = H+S .. H+S+R`. Equal to `shelf` when there is no recess. */
  recess: MultiPolygon
  /** Where a recess actually has a ledge under it, at `z = H+S`. */
  ledges: MultiPolygon
  /**
   * The plate's topmost `depthMm` with the name cut out of it, and the floor
   * that cut leaves behind. Empty for a raised nameplate or none at all.
   */
  engraved: MultiPolygon
  nameplateFloors: MultiPolygon
  /** The glyph volume itself, clipped to solid plate -- what an inlay fills. */
  nameplateSolid: MultiPolygon
  /** Underside of the plate, and its top face. */
  plateBottomZ: number
  shelfTopZ: number
  /** Where the name's cut begins. Equal to `plateTopZ` when there is no cut. */
  engraveFloorZ: number
  plateTopZ: number
}

export function buildBands(
  design: SwitchTrayDesign, plan: FillPlan, glyphs: MultiPolygon = [],
): PlateBands {
  const { shelfMm: S, recessMm: R, cornerRadiusMm } = design.plate
  const H = feetHeightMm(design.feet)
  const profile = profileToMulti(design.profile)

  const holeMm = cellHoleMm(design.plate, design.switch)
  const keepoutMm = cellKeepoutMm(design.plate, design.switch)

  const holes = plan.cells.map(c => cellRing(c.cx, c.cy, holeMm, cornerRadiusMm))
  const rawShelf = punch(profile, holes)

  let rawRecess = rawShelf
  let rawLedges: MultiPolygon = []
  if (R > 0 && keepoutMm > holeMm) {
    const recesses = plan.cells.map(c => cellRing(c.cx, c.cy, keepoutMm, cornerRadiusMm))
    rawRecess = punch(rawShelf, recesses)
    rawLedges = difference(rawShelf, rawRecess)
  }

  // The name is cut into the plate's top face, which makes it a shallow blind
  // pocket like any other -- so it is built the same way: the band above the
  // cut is the top region minus the glyphs, and the floor it leaves is the
  // difference between the two.
  // The depth only counts when there is something to cut with it. A tray whose
  // nameplate is configured but whose glyphs have not been traced yet -- the
  // font is loaded asynchronously, so this is every first paint -- must build
  // as a plate with no cut at all, not as one with a 0.6 mm band that nothing
  // fills.
  const wantedDepth = nameplateDepthMm(design)
  const cutting = wantedDepth > 0 && glyphs.length > 0
  const depth = cutting ? wantedDepth : 0
  const rawEngraved = cutting ? difference(rawRecess, glyphs) : []
  const rawNameplateFloors = cutting ? difference(rawRecess, rawEngraved) : []

  // The regions share the z = H+S interface and the outer silhouette, so they
  // have to agree vertex-for-vertex or the mesh leaks. See tjunction.ts.
  const [shelf, recess, ledges, engraved, nameplateFloors] = insertTJunctions(
    [rawShelf, rawRecess, rawLedges, rawEngraved, rawNameplateFloors])

  return {
    profile, shelf, recess, ledges, engraved, nameplateFloors,
    // Clipped to the plate: a glyph hanging over a switch hole or off the edge
    // would otherwise become a floating fragment of the second body. Computed
    // whatever the style, because a raised boss with nothing under it is just
    // as wrong as an inlay with nothing to fill.
    nameplateSolid: glyphs.length ? intersection(rawRecess, glyphs) : [],
    plateBottomZ: H,
    shelfTopZ: H + S,
    engraveFloorZ: H + S + R - depth,
    plateTopZ: H + S + R,
  }
}

export interface SwitchTrayMeshOptions {
  /**
   * Glyph outlines for the nameplate, centred on their own bounds (from
   * `traceTextPolys`). Resolved by the caller because tracing needs an async
   * font load and this stays synchronous.
   */
  nameplateOutlines?: MultiPolygon
  /**
   * Leave out anything flagged for a second filament -- the nameplate, and the
   * feet when `feet.separate` is set. This is the *export body*; the 3D preview
   * always welds everything into one mesh.
   */
  omitSeparateParts?: boolean
}

export function buildSwitchTrayMesh(
  design: SwitchTrayDesign, plan: FillPlan, opts?: SwitchTrayMeshOptions,
): Mesh {
  const style = nameplateStyleOf(design)
  const glyphs = placeGlyphs(design, opts?.nameplateOutlines)
  const bands = buildBands(design, plan, glyphs)
  const b = new MeshBuilder()
  const hasRecess = bands.plateTopZ > bands.shelfTopZ
  const cut = bands.engraved.length > 0

  // Horizontals at every interface, walls for every band.
  b.addHorizontal(bands.shelf, bands.plateBottomZ, 'down')
  if (hasRecess) {
    b.addHorizontal(bands.ledges, bands.shelfTopZ, 'up')
    b.addWalls(bands.shelf, bands.plateBottomZ, bands.shelfTopZ)
    b.addWalls(bands.recess, bands.shelfTopZ, bands.engraveFloorZ)
  } else {
    b.addWalls(bands.shelf, bands.plateBottomZ, bands.engraveFloorZ)
  }

  if (cut) {
    // The name's cut: a floor where the glyphs are, and the band above it
    // carrying the top face.
    b.addHorizontal(bands.nameplateFloors, bands.engraveFloorZ, 'up')
    b.addHorizontal(bands.engraved, bands.plateTopZ, 'up')
    b.addWalls(bands.engraved, bands.engraveFloorZ, bands.plateTopZ)
  } else {
    b.addHorizontal(bands.recess, bands.plateTopZ, 'up')
  }

  if (!(opts?.omitSeparateParts && design.feet?.separate)) addFeet(b, design)
  // Only a raised nameplate is added to the plate. An inlay or an inset is
  // already accounted for -- it was taken out of it above.
  if (style === 'raised' && !opts?.omitSeparateParts && glyphs.length) {
    addRaisedNameplate(b, design, bands.plateTopZ, glyphs)
  }

  return b.finish()
}

/**
 * The posts, each an independent closed box standing on z = 0 and dipping
 * `FOOT_WELD_MM` up into the plate so a slicer welds the overlap rather than
 * seeing a zero-gap contact. Shared by the welded preview and the separate-body
 * export, exactly as the keycap tray's corner spacers are.
 */
function addFeet(b: MeshBuilder, design: SwitchTrayDesign): void {
  const feet = design.feet
  const height = feetHeightMm(feet)
  if (!feet || !(height > 0) || !(feet.sizeMm > 0)) return
  const z1 = height + FOOT_WELD_MM
  for (const rect of feetRects(design.profile, feet)) {
    b.addHorizontal([rect], 0, 'down')
    b.addHorizontal([rect], z1, 'up')
    b.addWalls([rect], 0, z1)
  }
}

/** The posts alone, for a two-filament export. Null unless `separate` is set. */
export function buildFeetMesh(design: SwitchTrayDesign): Mesh | null {
  if (!design.feet?.separate || !(feetHeightMm(design.feet) > 0)) return null
  const b = new MeshBuilder()
  addFeet(b, design)
  return b.finish()
}

function addRaisedNameplate(
  b: MeshBuilder, design: SwitchTrayDesign, topZ: number, glyphs: MultiPolygon,
): void {
  const np = design.nameplate
  if (!np || !(np.heightMm > 0)) return
  const z0 = topZ - NAMEPLATE_WELD_MM
  const z1 = topZ + np.heightMm
  b.addHorizontal(glyphs, z0, 'down')
  b.addHorizontal(glyphs, z1, 'up')
  b.addWalls(glyphs, z0, z1)
}

/** The nameplate alone, for a two-filament export. */
/**
 * The name as its own body, for a two-filament print. Null when there is
 * nothing to hand a second extruder.
 *
 * A `raised` boss stands on the plate and welds into it. An `inlay` instead
 * fills exactly the volume `buildBands` removed -- an exact shared boundary,
 * not an overlap, because here the two bodies are two extruders and a shared
 * space is a fight rather than a weld. An `inset` has no body at all: the point
 * of it is the empty groove.
 */
export function buildNameplateMesh(
  design: SwitchTrayDesign, plan: FillPlan, outlines: MultiPolygon | null,
): Mesh | null {
  const np = design.nameplate
  if (!np || !outlines?.length) return null
  const style = nameplateStyleOf(design)
  if (style === 'inset') return null

  const glyphs = placeGlyphs(design, outlines)
  if (!glyphs.length) return null
  const b = new MeshBuilder()

  if (style === 'raised') {
    if (!(np.heightMm > 0)) return null
    addRaisedNameplate(b, design, buildBands(design, plan, glyphs).plateTopZ, glyphs)
    return b.finish()
  }

  const bands = buildBands(design, plan, glyphs)
  if (!bands.nameplateSolid.length) return null
  b.addHorizontal(bands.nameplateSolid, bands.engraveFloorZ, 'down')
  b.addHorizontal(bands.nameplateSolid, bands.plateTopZ, 'up')
  b.addWalls(bands.nameplateSolid, bands.engraveFloorZ, bands.plateTopZ)
  return b.finish()
}
