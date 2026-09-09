// The per-pocket reflect/rotate transform, shared by every designer that places
// a footprint rather than generating a lattice.
//
// Lived in the keycap tray until a second placed-pocket designer needed it. The
// parameter is deliberately as narrow as the function actually reads -- three
// optional fields -- rather than the keycap tray's `PocketLike`, which requires
// `units` and would have had a tool tray passing `units: 0` to satisfy a type
// that has nothing to do with it. `PocketLike` still satisfies this
// structurally, so nothing at the keycap end changed.
import type { Ring } from './vec.ts'
import { normalizeAngleDeg, quantizeRing, reflectRingInBox, rotateRing } from './vec.ts'

export interface PocketTransform {
  /** Real rotation about the un-rotated footprint centre, degrees, [0, 360). */
  rotationDeg?: number
  /** Reflect the geometry across its own vertical centreline, in place. */
  mirrorX?: boolean
  /** Reflect the geometry across its own horizontal centreline, in place. */
  flipY?: boolean
}

/**
 * Applied to a base ring built at the origin with an un-rotated footprint of
 * `w0 x h0`: reflect inside that box, then rotate about its centre. Order
 * matters -- reflecting first keeps mirror/flip meaningful in the pocket's own
 * frame regardless of angle. Callers still translate by (x, y).
 *
 * `w0 x h0` is an explicit argument rather than derived, which is what lets a
 * multi-step pocket rotate as one rigid body: every step passes the *pocket's*
 * box, not its own, so a tiered pocket's steps stay in register.
 */
export function applyPocketTransform(
  local: Ring, w0: number, h0: number, p: PocketTransform,
): Ring {
  const deg = normalizeAngleDeg(p.rotationDeg ?? 0)
  if (!p.mirrorX && !p.flipY && !deg) return local
  let ring = local
  if (p.mirrorX || p.flipY) ring = reflectRingInBox(ring, w0, h0, !!p.mirrorX, !!p.flipY)
  if (deg) ring = rotateRing(ring, deg, w0 / 2, h0 / 2)
  // Snap transcendental rotation coordinates onto the QUANTUM grid the boolean
  // and T-junction passes assume; the plain (un-transformed) path is untouched.
  return quantizeRing(ring)
}
