// A rough filament weight, before the slicer gives the real one.
//
// A print is not solid: it is a skin of walls and top/bottom layers around a
// sparse infill. Weighing the solid volume overstates a chunky part several
// times over, so the estimate models the two separately -- a shell as deep as
// Bambu's default two 0.42 mm perimeters over the whole surface, and 15% of
// whatever is left inside. Supports, brims and purge are not counted. It is a
// guide for "will this spool do", not a slicer.
import type { Mesh } from '../../geometry/mesh.ts'
export { SPOOL_GRAMS } from '../../../lib/contracts/filamentStock.ts'

/** g/cm³, for the materials the AMS reports. Unknown falls back to PLA. */
export const DENSITY_G_PER_CM3: Readonly<Record<string, number>> = {
  PLA: 1.24,
  PETG: 1.27,
  ABS: 1.04,
  ASA: 1.07,
  TPU: 1.21,
  PC: 1.2,
  PA: 1.14,
  PVA: 1.23,
}

const SHELL_MM = 0.84
const INFILL = 0.15

/** Longest known material name first, so "PETG-CF" is PETG and not PET-anything. */
const MATERIALS = Object.keys(DENSITY_G_PER_CM3).sort((a, b) => b.length - a.length)

export function densityOf(material: string | null | undefined): number {
  const name = (material ?? '').trim().toUpperCase()
  const known = MATERIALS.find(m => name.startsWith(m))
  return DENSITY_G_PER_CM3[known ?? 'PLA']
}

/** Enclosed volume and surface area, mm³ and mm². */
export function measure(mesh: Mesh): { volume: number; area: number } {
  const { indices: ix, positions: p } = mesh
  let volume = 0
  let area = 0
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3
    const ax = p[a], ay = p[a + 1], az = p[a + 2]
    const bx = p[b], by = p[b + 1], bz = p[b + 2]
    const cx = p[c], cy = p[c + 1], cz = p[c + 2]
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    area += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2
  }
  return { volume: Math.abs(volume), area }
}

/** Estimated grams of filament to print one mesh. */
export function printedGrams(mesh: Mesh, density: number): number {
  const { volume, area } = measure(mesh)
  const shell = Math.min(volume, area * SHELL_MM)
  const extruded = shell + (volume - shell) * INFILL
  return (extruded / 1000) * density
}

/** Whole grams, and never "0 g" for something that prints. */
export const formatGrams = (grams: number): string =>
  grams > 0 && grams < 1 ? '< 1 g' : `${Math.round(grams)} g`
