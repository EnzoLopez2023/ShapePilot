// The whole solid as an ordered list of z-bands. Two rules turn this into a
// mesh, and both are closed-form -- no 3D boolean anywhere.
import type { MultiPolygon, Polygon } from '../../../geometry/vec.ts'
import { multiArea, multiBBox, translateRing } from '../../../geometry/vec.ts'
import { difference, punchDisjointFast, union, unionDisjointFast } from '../../../geometry/boolean.ts'
import { pocketRing, rectRing, locatingPostSlotCenters } from './shapes.ts'
import { circleRing } from '../../../geometry/primitives.ts'
import { insertTJunctions } from '../../../geometry/tjunction.ts'
import type { Mesh } from '../../../geometry/mesh.ts'
import { MeshBuilder } from '../../../geometry/mesh.ts'
import type { Pocket, TrayDesign } from '../model/types.ts'
import { profileToMulti } from '../model/presets.ts'

export interface Layer { z0: number; z1: number; region: MultiPolygon }

/** union() but skipping the clipper when nothing overlaps, which is the norm. */
export function unionPockets(polys: Polygon[]): MultiPolygon {
  if (!polys.length) return []
  return unionDisjointFast(polys) ?? union(...polys.map(p => [p]))
}

function punch(outer: MultiPolygon, holes: Polygon[]): MultiPolygon {
  if (!holes.length) return outer
  return punchDisjointFast(outer, holes) ?? difference(outer, unionPockets(holes))
}

export interface TrayRegions {
  profile: MultiPolygon
  /** Solid from z=0 to the floor: profile minus through-cuts. */
  base: MultiPolygon
  /** Solid from the floor to the rim: base minus pockets. */
  top: MultiPolygon
  /** Where pocket floors actually exist. Clipped, so edge-hanging pockets work. */
  pocketFloors: MultiPolygon
  layers: Layer[]
}

export function buildRegions(design: TrayDesign): TrayRegions {
  const F = design.floorThicknessMm
  const D = design.pocketDepthMm
  const profile = profileToMulti(design.profile)

  const blind: Polygon[] = []
  const through: Polygon[] = []
  for (const p of design.pockets) {
    (p.isThrough ? through : blind).push(pocketRing(p, design.sizing))
  }

  const rawBase = punch(profile, through)
  const rawTop = punch(rawBase, blind)
  // Derive the floors from `top` rather than from the pocket rings, so the floor
  // boundary is built out of `top`'s own vertices and welds against its walls.
  const rawFloors = blind.length ? difference(rawBase, rawTop) : []

  // Everything above shares the z=F interface (and the outer silhouette), so the
  // three regions must agree vertex-for-vertex or the mesh leaks. See tjunction.ts.
  const [base, top, pocketFloors] = insertTJunctions([rawBase, rawTop, rawFloors])

  return {
    profile, base, top, pocketFloors,
    layers: [{ z0: 0, z1: F, region: base }, { z0: F, z1: F + D, region: top }],
  }
}

// Gap from the tray's outer edge to a corner post, and the amount a post dips
// back into the rim so a slicer unions the two solids instead of seeing a
// zero-gap contact.
const SPACER_INSET_MM = 2
const SPACER_INSET_STEP_MM = 1
// How far a corner search gives up. The Systainer notched preset's own corner
// chamfer only needs ~6 mm; this leaves headroom for a bigger notch or a
// pocket sitting in the way, without searching so far the post stops meaning
// "this corner" at all.
const SPACER_INSET_MAX_MM = 40
const SPACER_WELD_MM = 0.05

/**
 * The corner posts that actually fit. Profile bounding-box corners are not
 * always solid material -- the Systainer notched preset chamfers all four, so
 * the nominal inset can land entirely in the notch -- so each corner searches
 * progressively deeper (both axes together, toward the tray centre) until it
 * finds a spot that sits wholly on the rim, or gives up at SPACER_INSET_MAX_MM.
 * A pocket placed right in a corner is handled the same way: the post just
 * lands a little further in than the bare minimum.
 */
export function cornerSpacerRects(design: TrayDesign, top?: MultiPolygon): Polygon[] {
  const cs = design.cornerSpacers
  if (!cs || cs.heightMm <= 0 || cs.sizeMm <= 0) return []
  const rim = top ?? buildRegions(design).top
  const bb = multiBBox(profileToMulti(design.profile))
  const s = cs.sizeMm

  const corners: [1 | -1, 1 | -1][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]]
  const originAt = (dir: [1 | -1, 1 | -1], inset: number): [number, number] => [
    dir[0] === 1 ? bb.minX + inset : bb.maxX - inset - s,
    dir[1] === 1 ? bb.minY + inset : bb.maxY - inset - s,
  ]

  const rects: Polygon[] = []
  for (const dir of corners) {
    for (let inset = SPACER_INSET_MM; inset <= SPACER_INSET_MAX_MM; inset += SPACER_INSET_STEP_MM) {
      const [x, y] = originAt(dir, inset)
      const rect: Polygon = [translateRing(rectRing(s, s), x, y)]
      if (multiArea(difference([rect], rim)) < 1e-6) { rects.push(rect); break }
    }
  }
  return rects
}

// How far a locating post's tube dips below the pocket floor, so the slicer
// welds the overlap instead of seeing a zero-gap contact -- the same trick as
// the corner posts, just against the floor instead of the rim.
const POST_WELD_MM = 0.05

/** The tube footprint for one locating post: an outer circle with the bore as
 *  a hole, in the outer-CCW / hole-CW winding every polygon-with-a-hole in
 *  this codebase uses. */
function postTubePolygon(cx: number, cy: number, outerR: number, innerR: number): Polygon {
  const outer = translateRing(circleRing(outerR, 32), cx, cy)
  const hole = translateRing(circleRing(innerR, 32), cx, cy).slice().reverse()
  return [outer, hole]
}

export function buildTrayMesh(design: TrayDesign): Mesh {
  const F = design.floorThicknessMm
  const D = design.pocketDepthMm
  const { base, top, pocketFloors } = buildRegions(design)
  const b = new MeshBuilder()

  // Rule A -- horizontal faces at each layer interface.
  b.addHorizontal(base, 0, 'down')
  b.addHorizontal(pocketFloors, F, 'up')
  b.addHorizontal(top, F + D, 'up')

  // Rule B -- side walls for each band.
  b.addWalls(base, 0, F)
  b.addWalls(top, F, F + D)

  // Corner posts: each an independent closed box that dips SPACER_WELD_MM into
  // the rim, so the mesh stays edge-paired and the slicer welds the overlap.
  const cs = design.cornerSpacers
  if (cs && cs.heightMm > 0 && cs.sizeMm > 0) {
    const z0 = F + D - SPACER_WELD_MM
    const z1 = F + D + cs.heightMm
    for (const rect of cornerSpacerRects(design, top)) {
      b.addHorizontal([rect], z0, 'down')
      b.addHorizontal([rect], z1, 'up')
      b.addWalls([rect], z0, z1)
    }
  }

  // Locating posts: an open-bottom tube per 1u slot, standing on the pocket
  // floor. A through-cut pocket has no floor to stand on, so it is skipped --
  // validate.ts flags that rather than silently dropping the posts.
  for (const p of design.pockets) {
    const lp = p.locatingPosts
    if (!lp || p.isThrough) continue
    if (!(lp.heightMm > 0 && lp.outerDiameterMm > 0 && lp.boreDiameterMm > 0)) continue
    if (lp.boreDiameterMm >= lp.outerDiameterMm) continue // no wall; validate.ts flags it
    const outerR = lp.outerDiameterMm / 2, innerR = lp.boreDiameterMm / 2
    const z0 = F - POST_WELD_MM
    const z1 = F + lp.heightMm
    for (const [cx, cy] of locatingPostSlotCenters(p, design.sizing)) {
      const tube = postTubePolygon(cx, cy, outerR, innerR)
      b.addHorizontal([tube], z0, 'down')
      b.addHorizontal([tube], z1, 'up')
      b.addWalls([tube], z0, z1)
    }
  }

  return b.finish()
}

export const pocketPolygons = (pockets: Pocket[], design: TrayDesign): Polygon[] =>
  pockets.map(p => pocketRing(p, design.sizing))
