// Inward miter offset of a simple polygon ring, used only to draw the visual
// wall-thickness buffer against the tray's actual outline -- a notched or
// custom profile isn't a rectangle, so insetting its bounding box (the old
// behaviour) drew a buffer that cut straight through notches instead of
// following them. The real minWall check in validate.ts already walks the
// boundary directly and is unaffected by this file.
import type { Ring, Vec2 } from './vec.ts'
import { signedArea } from './vec.ts'

const normalize = (dx: number, dy: number): Vec2 => {
  const len = Math.hypot(dx, dy)
  return len < 1e-12 ? [0, 0] : [dx / len, dy / len]
}

/** Intersection of two infinite lines, each given as a point plus direction. */
const lineIntersect = (p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null => {
  const denom = d1[0] * d2[1] - d1[1] * d2[0]
  if (Math.abs(denom) < 1e-9) return null
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / denom
  return [p1[0] + d1[0] * t, p1[1] + d1[1] * t]
}

/**
 * Offsets `ring` inward by `dist` mm via per-edge translation and mitered
 * corner intersections. Not a general offsetting algorithm -- a concave notch
 * narrower than ~2x dist can produce a locally invalid miter -- so this is a
 * best-effort visual overlay, not a substitute for the boundary-distance
 * check that actually gates fabrication. Returns null when the offset leaves
 * nothing sensible to draw (ring too small, or dist too large).
 */
export function offsetRingInward(ring: Ring, dist: number): Ring | null {
  const n = ring.length
  if (n < 3 || dist <= 0) return null

  const originalArea = signedArea(ring)
  if (Math.abs(originalArea) < 1e-9) return null
  const sign = originalArea > 0 ? 1 : -1

  const edges = ring.map((a, i) => {
    const b = ring[(i + 1) % n]
    const dir = normalize(b[0] - a[0], b[1] - a[1])
    // Left normal points into a CCW ring's interior (flipped for CW).
    const nx = -dir[1] * sign, ny = dir[0] * sign
    const offsetA: Vec2 = [a[0] + nx * dist, a[1] + ny * dist]
    return { dir, offsetA }
  })

  const out: Ring = []
  for (let i = 0; i < n; i++) {
    const prev = edges[(i - 1 + n) % n]
    const cur = edges[i]
    const p = lineIntersect(prev.offsetA, prev.dir, cur.offsetA, cur.dir)
    out.push(p ?? cur.offsetA)
  }

  const area = signedArea(out)
  if (!Number.isFinite(area) || Math.sign(area) !== sign) return null
  return out
}
