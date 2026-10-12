// Outlines for the Shaper Designer templates, built as a belt wrapped around a
// chain of circles: corners are circles the path turns left around, a detour
// round a handle is a circle it turns right around, and the straight runs are
// the tangents between them. That keeps every curve an exact arc meeting its
// neighbours tangentially, which a hand-placed polyline would not.
import type { Ring, Vec2 } from '../../../geometry/vec.ts'
import { signedArea } from '../../../geometry/vec.ts'

export const IN = 25.4

/** Inches to the nearest 1/16, written as a woodworker would: 10-3/4 in. */
export function fmtIn(mm: number): string {
  const sixteenths = Math.round((mm / IN) * 16)
  const whole = Math.floor(sixteenths / 16)
  let num = sixteenths % 16, den = 16
  while (num && num % 2 === 0) { num /= 2; den /= 2 }
  const frac = num ? `${num}/${den}` : ''
  return `${whole && frac ? `${whole}-${frac}` : whole ? whole : frac || '0'} in`
}

// -- The belt ----------------------------------------------------------------

/** turn +1: the path goes anticlockwise round it (a convex corner).
 *  turn -1: clockwise (the groove bending in around a handle). */
export interface Pulley { c: Vec2; r: number; turn: 1 | -1 }

const CHORD_MM = 0.2

/** Where the tangent leaves pulley a for pulley b: the unit normal `n` such
 *  that both touch points are C - turn*r*n. */
function tangentNormal(a: Pulley, b: Pulley): Vec2 {
  const dx = b.c[0] - a.c[0], dy = b.c[1] - a.c[1]
  const d = Math.hypot(dx, dy)
  const k = (b.turn * b.r - a.turn * a.r) / d
  if (k > 1 + 1e-9 || k < -1 - 1e-9) throw new Error('pulleys overlap; no tangent between them')
  const alpha = Math.atan2(dy, dx) + Math.acos(Math.max(-1, Math.min(1, k)))
  return [Math.cos(alpha), Math.sin(alpha)]
}

/** A closed, anticlockwise ring around the pulleys, taken in order. */
export function belt(pulleys: readonly Pulley[]): Ring {
  const count = pulleys.length
  const normals = pulleys.map((p, i) => tangentNormal(p, pulleys[(i + 1) % count]!))
  const out: Vec2[] = []
  for (let i = 0; i < count; i++) {
    const p = pulleys[i]!
    const nIn = normals[(i - 1 + count) % count]!
    const nOut = normals[i]!
    // Touch point angle is the angle of -turn*n about the centre.
    const a0 = Math.atan2(-p.turn * nIn[1], -p.turn * nIn[0])
    const a1 = Math.atan2(-p.turn * nOut[1], -p.turn * nOut[0])
    let sweep = p.turn * (a1 - a0)
    sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    if (sweep > 2 * Math.PI - 1e-6) sweep = 0
    const steps = Math.max(1, Math.ceil((sweep * p.r) / CHORD_MM))
    for (let s = 0; s <= steps; s++) {
      const a = a0 + p.turn * sweep * (s / steps)
      out.push([p.c[0] + p.r * Math.cos(a), p.c[1] + p.r * Math.sin(a)])
    }
  }
  // Tangent runs between pulleys are the implicit straight edges; drop the
  // duplicate points a zero-length tangent leaves behind.
  const ring = out.filter((v, i) => {
    const prev = out[(i - 1 + out.length) % out.length]!
    return Math.hypot(v[0] - prev[0], v[1] - prev[1]) > 1e-6
  })
  if (signedArea(ring) <= 0) throw new Error('belt came out clockwise; pulley order is wrong')
  // A pulley placed past its neighbour's tangent point folds the belt over
  // itself rather than failing, so look for that explicitly.
  if (selfIntersects(ring)) throw new Error('belt crosses itself; a fillet or keep-out is too big')
  return ring
}

function selfIntersects(ring: Ring): boolean {
  const n = ring.length
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  for (let i = 0; i < n; i++) {
    const a = ring[i]!, b = ring[(i + 1) % n]!
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      const c = ring[j]!, d = ring[(j + 1) % n]!
      if (Math.max(c[0], d[0]) < Math.min(a[0], b[0]) || Math.min(c[0], d[0]) > Math.max(a[0], b[0])) continue
      if (Math.max(c[1], d[1]) < Math.min(a[1], b[1]) || Math.min(c[1], d[1]) > Math.max(a[1], b[1])) continue
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true
    }
  }
  return false
}

/** An anticlockwise circle, sampled like the belt's arcs. */
export function circle(c: Vec2, r: number): Ring {
  const steps = Math.max(12, Math.ceil((2 * Math.PI * r) / CHORD_MM))
  return Array.from({ length: steps }, (_, i): Vec2 => {
    const a = (2 * Math.PI * i) / steps
    return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]
  })
}

/** A slot: two semicircular ends joined by straight sides. */
export const stadium = (a: Vec2, b: Vec2, r: number): Ring =>
  belt([{ c: a, r, turn: 1 }, { c: b, r, turn: 1 }])

/** A rounded rectangle, bottom-left corner at x0,y0. */
export const roundedRect = (x0: number, y0: number, x1: number, y1: number, r: number): Ring =>
  belt(corners(x0, y0, x1, y1, r))

/** Four convex corners of a rounded rectangle, anticlockwise from bottom-left. */
export const corners = (x0: number, y0: number, x1: number, y1: number, r: number): Pulley[] => [
  { c: [x0 + r, y0 + r], r, turn: 1 },
  { c: [x1 - r, y0 + r], r, turn: 1 },
  { c: [x1 - r, y1 - r], r, turn: 1 },
  { c: [x0 + r, y1 - r], r, turn: 1 },
]

/**
 * The fillet that carries a straight groove run (the line `axis = at`) into a
 * clockwise detour round `keep`: a circle of radius `rf` touching the line from
 * the island side and the keep-out circle from outside. `side` picks which of
 * the two solutions along the line -- the one before or after the keep-out.
 */
export function fillet(keep: Pulley, rf: number, axis: 'x' | 'y', at: number, inward: 1 | -1, side: 1 | -1): Pulley {
  const reach = keep.r + rf
  const across = at + inward * rf
  const offset = axis === 'x' ? across - keep.c[0] : across - keep.c[1]
  const along = Math.sqrt(reach * reach - offset * offset)
  if (!Number.isFinite(along)) throw new Error('fillet cannot reach the keep-out circle')
  const c: Vec2 = axis === 'x'
    ? [across, keep.c[1] + side * along]
    : [keep.c[0] + side * along, across]
  return { c, r: rf, turn: 1 }
}
