// The whole solid as an ordered list of z-bands. Two rules turn this into a
// mesh, and both are closed-form -- no 3D boolean anywhere.
import type { MultiPolygon, Polygon } from '../../../geometry/vec.ts'
import { difference, punchDisjointFast, union, unionDisjointFast } from '../../../geometry/boolean.ts'
import { pocketRing } from './shapes.ts'
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

  return b.finish()
}

export const pocketPolygons = (pockets: Pocket[], design: TrayDesign): Polygon[] =>
  pockets.map(p => pocketRing(p, design.sizing))
