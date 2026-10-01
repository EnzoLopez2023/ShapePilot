// Turning a stack of z-bands into a closed mesh.
//
// Every solid in this repo is a 2D region extruded along one axis -- there is
// no 3D CSG anywhere and there should never be (docs/ARCHITECTURE.md). So a
// part is a list of bands, and the two rules below turn any such list into a
// watertight mesh. They were written for the keycap tray, copied into the rack,
// and copied again into the swatch card; this module is the one copy.
//
// Rule A: a horizontal face wherever the region CHANGES, built as the
// DIFFERENCE of the two bands that meet there -- never as a feature's own ring,
// so its boundary is made of its neighbours' vertices and welds against their
// walls. Rule B: walls per band. `insertTJunctions` over every region at once
// first, `repairTJunctions` inside `finish()` last.
//
// Do not "simplify" either of the repair passes. Each exists because a specific
// real layout produced a mesh that looked fine and leaked.
import { difference } from './boolean.ts'
import { insertTJunctions } from './tjunction.ts'
import type { Mesh } from './mesh.ts'
import { MeshBuilder } from './mesh.ts'
import type { MultiPolygon } from './vec.ts'
import { multiArea } from './vec.ts'

/** One slice of a part: the region that is solid between `z0` and `z1`. */
export interface Band { z0: number; z1: number; region: MultiPolygon }

export interface BandMesh {
  mesh: Mesh
  /** The input bands, shifted by `zOffset` and with T-junctions inserted. */
  bands: Band[]
}

/**
 * `zOffset` shifts the finished part along the extrusion axis. Regions are
 * often evaluated in a frame that runs negative -- behind a backplate, say --
 * and shifting once here is what lets every exported piece sit at z = 0.
 */
export function buildBands(raw: readonly Band[], zOffset = 0): BandMesh {
  const b = new MeshBuilder()
  if (!raw.length) return { mesh: b.finish(), bands: [] }

  const rawUp: MultiPolygon[] = [[]]
  const rawDown: MultiPolygon[] = [[]]
  for (let i = 1; i < raw.length; i++) {
    rawUp.push(difference(raw[i - 1]!.region, raw[i]!.region))
    rawDown.push(difference(raw[i]!.region, raw[i - 1]!.region))
  }

  const n = raw.length
  const flat = insertTJunctions([...raw.map(x => x.region), ...rawUp, ...rawDown])
  const bands = raw.map((x, i) => ({ z0: x.z0 + zOffset, z1: x.z1 + zOffset, region: flat[i]! }))
  const floorsUp = flat.slice(n, 2 * n)
  const ceilingsDown = flat.slice(2 * n, 3 * n)

  b.addHorizontal(bands[0]!.region, bands[0]!.z0, 'down')
  for (let i = 1; i < bands.length; i++) {
    b.addHorizontal(floorsUp[i] ?? [], bands[i]!.z0, 'up')
    b.addHorizontal(ceilingsDown[i] ?? [], bands[i]!.z0, 'down')
  }
  b.addHorizontal(bands[n - 1]!.region, bands[n - 1]!.z1, 'up')
  for (const band of bands) b.addWalls(band.region, band.z0, band.z1)

  return { mesh: b.finish(), bands }
}

/** The mesh alone, for the common case of a part that starts at z = 0. */
export const meshFromBands = (raw: readonly Band[], zOffset = 0): Mesh =>
  buildBands(raw, zOffset).mesh

/**
 * Band areas times band depths. Computed from the REGIONS, not the mesh, so
 * comparing it against the mesh's own divergence volume catches a band derived
 * from the wrong neighbour -- a mesh can be watertight and still be the wrong
 * solid.
 */
export function bandVolume(bands: readonly Band[]): number {
  let v = 0
  for (const band of bands) v += multiArea(band.region) * (band.z1 - band.z0)
  return v
}
