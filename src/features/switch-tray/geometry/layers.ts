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
import { difference, punchDisjointFast, union, unionDisjointFast } from '../../../geometry/boolean.ts'
import { rectRing } from '../../../geometry/primitives.ts'
import { insertTJunctions } from '../../../geometry/tjunction.ts'
import type { Mesh } from '../../../geometry/mesh.ts'
import { MeshBuilder } from '../../../geometry/mesh.ts'
import { profileToMulti } from '../../../model/trayProfile.ts'
import { cellHoleMm, cellKeepoutMm, feetHeightMm } from '../model/defaults.ts'
import type { SwitchTrayDesign } from '../model/types.ts'
import type { FillPlan } from './fill.ts'
import { FOOT_WELD_MM, feetRects } from './feet.ts'

/** Segments per 90° corner on a cell. 0.5 mm radius, so 8 is already invisible. */
const CELL_CORNER_SEGMENTS = 8

/** How far the nameplate dips into the plate so a slicer welds the overlap. */
const NAMEPLATE_WELD_MM = 0.05

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
  /** Underside of the plate, and its top face. */
  plateBottomZ: number
  shelfTopZ: number
  plateTopZ: number
}

export function buildBands(design: SwitchTrayDesign, plan: FillPlan): PlateBands {
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

  // The three regions share the z = H+S interface and the outer silhouette, so
  // they have to agree vertex-for-vertex or the mesh leaks. See tjunction.ts.
  const [shelf, recess, ledges] = insertTJunctions([rawShelf, rawRecess, rawLedges])

  return {
    profile, shelf, recess, ledges,
    plateBottomZ: H,
    shelfTopZ: H + S,
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
  const bands = buildBands(design, plan)
  const b = new MeshBuilder()
  const hasRecess = bands.plateTopZ > bands.shelfTopZ

  // Horizontals at every interface, walls for every band.
  b.addHorizontal(bands.shelf, bands.plateBottomZ, 'down')
  if (hasRecess) {
    b.addHorizontal(bands.ledges, bands.shelfTopZ, 'up')
    b.addHorizontal(bands.recess, bands.plateTopZ, 'up')
    b.addWalls(bands.shelf, bands.plateBottomZ, bands.shelfTopZ)
    b.addWalls(bands.recess, bands.shelfTopZ, bands.plateTopZ)
  } else {
    b.addHorizontal(bands.shelf, bands.shelfTopZ, 'up')
    b.addWalls(bands.shelf, bands.plateBottomZ, bands.shelfTopZ)
  }

  if (!(opts?.omitSeparateParts && design.feet?.separate)) addFeet(b, design)
  if (!opts?.omitSeparateParts && opts?.nameplateOutlines?.length) {
    addNameplate(b, design, bands.plateTopZ, opts.nameplateOutlines)
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

function addNameplate(
  b: MeshBuilder, design: SwitchTrayDesign, topZ: number, outlines: MultiPolygon,
): void {
  const np = design.nameplate
  if (!np || !(np.heightMm > 0)) return
  const glyphs: MultiPolygon = outlines.map(poly =>
    poly.map(ring => translateRing(ring, np.x, np.y)))
  const z0 = topZ - NAMEPLATE_WELD_MM
  const z1 = topZ + np.heightMm
  b.addHorizontal(glyphs, z0, 'down')
  b.addHorizontal(glyphs, z1, 'up')
  b.addWalls(glyphs, z0, z1)
}

/** The nameplate alone, for a two-filament export. */
export function buildNameplateMesh(
  design: SwitchTrayDesign, plan: FillPlan, outlines: MultiPolygon | null,
): Mesh | null {
  if (!design.nameplate || !(design.nameplate.heightMm > 0) || !outlines?.length) return null
  const b = new MeshBuilder()
  addNameplate(b, design, buildBands(design, plan).plateTopZ, outlines)
  return b.finish()
}
