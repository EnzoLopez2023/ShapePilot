// What the printer will struggle with, read off the triangles of the finished
// model.
//
// These are surface measurements, not a slicer: they say how much of the model
// hangs over nothing, how much of it the plate actually holds, and how thick it
// is on average. Nothing here is corrected automatically -- PRODUCT.md is
// explicit that manufacturability is reported, never silently fixed.
import type { Mesh } from '../../geometry/mesh.ts'
import type { Triple } from '../../model/document.ts'

/**
 * Steeper than this from horizontal and a downward face needs support. 45° is
 * the figure Bambu's own profiles use and the one every slicer defaults to.
 */
export const OVERHANG_DEGREES = 45

/** A face within this of the lowest point is resting on the plate, not hanging. */
const PLATE_TOLERANCE_MM = 0.05

/** Below this, an overhang is a chamfer nobody needs to hear about. */
const OVERHANG_AREA_MM2 = 50

export interface SurfaceReport {
  /** mm² of downward faces steeper than OVERHANG_DEGREES that miss the plate. */
  overhangArea: number
  /** The middle of the largest such face, for pointing at it. */
  overhangAt: Triple | null
  /** mm² of the model actually touching the build plate. */
  footprintArea: number
  /** mm³ and mm² of the whole surface, for the average-thickness figure. */
  volume: number
  area: number
}

/**
 * One pass over the triangles. Areas come from the cross product, so a mesh
 * with duplicated or degenerate triangles contributes what it actually holds.
 */
export function surfaceReport(mesh: Mesh): SurfaceReport {
  const { positions: p, indices: ix, bbox } = mesh
  const minZ = bbox[2]
  const limit = -Math.cos((OVERHANG_DEGREES * Math.PI) / 180)

  let overhangArea = 0
  let footprintArea = 0
  let volume = 0
  let area = 0
  let worstArea = 0
  let overhangAt: Triple | null = null

  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3
    const ax = p[a], ay = p[a + 1], az = p[a + 2]
    const bx = p[b], by = p[b + 1], bz = p[b + 2]
    const cx = p[c], cy = p[c + 1], cz = p[c + 2]

    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (length === 0) continue
    const faceArea = length / 2
    area += faceArea
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6

    const unitZ = nz / length
    if (unitZ > limit) continue

    const highest = Math.max(az, bz, cz)
    if (highest <= minZ + PLATE_TOLERANCE_MM) {
      // Flat on the plate: this is what holds the print down, not an overhang.
      if (unitZ < -0.99) footprintArea += faceArea
      continue
    }
    overhangArea += faceArea
    if (faceArea > worstArea) {
      worstArea = faceArea
      overhangAt = [(ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3]
    }
  }

  return {
    overhangArea: overhangArea >= OVERHANG_AREA_MM2 ? overhangArea : 0,
    overhangAt: overhangArea >= OVERHANG_AREA_MM2 ? overhangAt : null,
    footprintArea,
    volume: Math.abs(volume),
    area,
  }
}

/**
 * Average wall thickness: twice the volume over the surface area, which is
 * exactly the thickness of a slab and a fair indicator for anything plate-like.
 * It is an average and is reported as one -- a thin rib on a thick body does
 * not show up here, and claiming otherwise would need a distance field.
 */
export const averageThicknessMm = (report: SurfaceReport): number | null =>
  report.area > 0 ? (2 * report.volume) / report.area : null

/**
 * How top-heavy the print is: its height against the width its footprint
 * implies. A tall model on a small footprint is the one that gets knocked off
 * the plate, and a brim is the usual answer.
 */
export const tippiness = (heightMm: number, footprintArea: number): number | null =>
  footprintArea > 0 ? heightMm / Math.sqrt(footprintArea) : null

/** Past this, the model is tall enough over its footprint to be worth saying. */
export const TIPPY_RATIO = 4
