// Resizing a 3D object to a typed size. The panel shows the size the part
// actually comes out -- its world bounds -- but the document stores a scale
// per LOCAL axis, applied before rotation. Keeping proportions sidesteps the
// difference entirely: one factor on every axis scales the bounds by exactly
// that factor, however the part is turned.
import type { Transform, Triple } from '../../model/document.ts'

const RAD = Math.PI / 180

/** Manifold's rotate(x, y, z): about X, then Y, then Z -- the matrix Rz·Ry·Rx. */
function rotationMatrix([rx, ry, rz]: Triple): number[][] {
  const [cx, sx] = [Math.cos(rx * RAD), Math.sin(rx * RAD)]
  const [cy, sy] = [Math.cos(ry * RAD), Math.sin(ry * RAD)]
  const [cz, sz] = [Math.cos(rz * RAD), Math.sin(rz * RAD)]
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ]
}

/**
 * The local axis a world axis runs along, or null when the part is turned to
 * some angle that is not a quarter turn and no one local axis owns it.
 */
export function localAxisFor(rotationDeg: Triple, worldAxis: 0 | 1 | 2): 0 | 1 | 2 | null {
  const row = rotationMatrix(rotationDeg)[worldAxis]
  const j = row.reduce((best, v, k) => (Math.abs(v) > Math.abs(row[best]) ? k : best), 0)
  return Math.abs(row[j]) > 0.9999 ? (j as 0 | 1 | 2) : null
}

/**
 * The scale that brings the part's world extent along `worldAxis` to
 * `targetMm`. With `keepProportions`, or when the part is at an odd angle and
 * stretching one axis would shear its bounds unpredictably, every axis takes
 * the same factor.
 */
export function resizedScale(
  t: Transform, measuredMm: Triple, worldAxis: 0 | 1 | 2, targetMm: number, keepProportions: boolean,
): Triple | null {
  const current = measuredMm[worldAxis]
  if (!(targetMm > 0) || !(current > 0)) return null
  const factor = targetMm / current
  const local = keepProportions ? null : localAxisFor(t.rotationDeg, worldAxis)
  if (local === null) return [t.scale[0] * factor, t.scale[1] * factor, t.scale[2] * factor]
  const next = [...t.scale] as [number, number, number]
  next[local] *= factor
  return next
}

/** The server refuses a scale factor past this; see LIMITS in designDocument.ts. */
const MAX_SCALE = 10_000

/**
 * The scale after typing `percent` into one axis's Scale field, where 100% is
 * the part as it was drawn or imported. Unlike a typed size this is the part's
 * own axis, so it needs no rotation mapping. With `keepProportions` the other
 * two axes move by the same factor, which keeps a part that was already
 * stretched stretched rather than snapping it square.
 */
export function rescaledByPercent(
  t: Transform, localAxis: 0 | 1 | 2, percent: number, keepProportions: boolean,
): Triple | null {
  const target = percent / 100
  if (!(target > 0) || target > MAX_SCALE) return null
  if (!keepProportions) {
    const next = [...t.scale] as [number, number, number]
    next[localAxis] = target
    return next
  }
  const factor = target / t.scale[localAxis]
  const next = t.scale.map(v => v * factor) as [number, number, number]
  return next.every(v => v > 0 && v <= MAX_SCALE) ? next : null
}
