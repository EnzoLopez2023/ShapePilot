// Opening a closed outline: remove one section of it and keep the rest as an
// open polyline, which is what an on-line cut follows.
type Pt = readonly [number, number]
type Ring = readonly Pt[]

interface Located { s: number; distSq: number }

const closedLength = (ring: Ring): { cum: number[]; total: number } => {
  const cum = [0]
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[(i + 1) % ring.length]
    cum.push(cum[i] + Math.hypot(x1 - x0, y1 - y0))
  }
  return { cum, total: cum[ring.length] }
}

/** Where along the perimeter the point nearest `p` lies, and how far off it is. */
function locate(ring: Ring, cum: number[], p: Pt): Located {
  let best: Located = { s: 0, distSq: Infinity }
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[(i + 1) % ring.length]
    const dx = x1 - x0, dy = y1 - y0
    const len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - x0) * dx + (p[1] - y0) * dy) / len2)) : 0
    const ex = x0 + t * dx - p[0], ey = y0 + t * dy - p[1]
    const d = ex * ex + ey * ey
    if (d < best.distSq) best = { s: cum[i] + t * Math.sqrt(len2), distSq: d }
  }
  return best
}

function pointAt(ring: Ring, cum: number[], total: number, s: number): Pt {
  const at = ((s % total) + total) % total
  let i = 0
  while (i < ring.length - 1 && cum[i + 1] <= at) i++
  const [x0, y0] = ring[i]
  const [x1, y1] = ring[(i + 1) % ring.length]
  const seg = cum[i + 1] - cum[i]
  const t = seg ? (at - cum[i]) / seg : 0
  return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]
}

/** The ring whose outline passes nearest `a`, among the closed ones. */
export function nearestRing(rings: readonly Ring[], skip: ReadonlySet<number>, a: Pt): number {
  let best = -1, bestD = Infinity
  rings.forEach((ring, i) => {
    if (skip.has(i) || ring.length < 3) return
    const { cum } = closedLength(ring)
    const d = locate(ring, cum, a).distSq
    if (d < bestD) { bestD = d; best = i }
  })
  return best
}

/**
 * Remove the shorter of the two arcs between the points nearest `a` and `b`,
 * and return what is left as an open polyline, or null when there is nothing
 * worth removing or keeping.
 */
export function openRingBetween(ring: Ring, a: Pt, b: Pt): Ring | null {
  if (ring.length < 3) return null
  const { cum, total } = closedLength(ring)
  if (!(total > 0)) return null
  const sa = locate(ring, cum, a).s
  const sb = locate(ring, cum, b).s
  const forward = (((sb - sa) % total) + total) % total
  // The removed arc runs forward from `from` to `to`; what is kept is the rest.
  const [from, to] = forward <= total - forward ? [sa, sb] : [sb, sa]
  const removed = (((to - from) % total) + total) % total
  if (removed < 1e-6 || total - removed < 1e-6) return null

  const end = to + (total - removed)
  const out: Pt[] = [pointAt(ring, cum, total, to)]
  for (let k = 0; k < ring.length * 2; k++) {
    const v = cum[k % ring.length] + Math.floor(k / ring.length) * total
    if (v > to + 1e-9 && v < end - 1e-9) out.push(ring[k % ring.length])
  }
  out.push(pointAt(ring, cum, total, from))
  return out.length >= 3 ? out : null
}
