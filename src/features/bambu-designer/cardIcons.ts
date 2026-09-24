// Line-drawn icons for the ID card: a keycap and an MX switch.
//
// Each is drawn once, as the SVG it previews as -- strokes, and for the switch
// the white faces that hide what is behind them -- in a 100-unit box with y
// down. `iconOutline` turns that same drawing into the solid a printer can
// stand on the card, painting it in the SVG's own order: a face erases the ink
// behind it, then its edges are inked. That is what keeps the switch's hidden
// lines hidden in plastic as well as on screen.
import type { MultiPolygon, Polygon, Ring, Vec2 } from '../../geometry/vec.ts'
import { difference, union } from '../../geometry/boolean.ts'

export type CardIconId = 'keycap' | 'switch'

export type IconOp =
  /** A face: erases whatever was drawn behind it. */
  | { kind: 'fill'; pts: Vec2[] }
  | { kind: 'stroke'; pts: Vec2[]; closed: boolean }

export interface CardIcon {
  id: CardIconId
  label: string
  /** Line weight in the 100-unit drawing box. */
  strokeWidth: number
  ops: IconOp[]
}

/** A quadratic Bézier from `a` to `b` pulled toward `c`, as a polyline. */
function quad(a: Vec2, c: Vec2, b: Vec2, steps = 10): Vec2[] {
  const out: Vec2[] = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, u = 1 - t
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]])
  }
  return out
}

/** The reference keycap: a sculpted cap seen from a little above, dish showing. */
function keycap(): CardIcon {
  const outline: Vec2[] = [
    [29, 12], [17, 25], ...quad([17, 25], [13.5, 29], [13.5, 34]),
    [12.5, 75], ...quad([12.5, 75], [12.5, 88.5], [23, 88.5]),
    [77, 88.5], ...quad([77, 88.5], [87.5, 88.5], [87.5, 75]),
    [86.5, 34], ...quad([86.5, 34], [86.5, 29], [83, 25]),
    [71, 12], ...quad([71, 12], [50, 16.5], [29, 12]).slice(0, -1),
  ]
  const s = (...pts: Vec2[]): IconOp => ({ kind: 'stroke', pts, closed: false })
  return {
    id: 'keycap',
    label: 'Keycap',
    strokeWidth: 4.6,
    ops: [
      { kind: 'stroke', pts: outline, closed: true },
      s([29, 12], [27, 49]), s([71, 12], [73, 49]),
      s([27, 49], ...quad([27, 49], [50, 57.5], [73, 49])),
      s([27, 49], [18, 83]), s([73, 49], [82, 83]),
      s([18, 83], [82, 83]),
    ],
  }
}

type P3 = readonly [number, number, number]

/** An MX switch in isometric view, built from its real proportions in mm. */
function mxSwitch(): CardIcon {
  const iso = ([x, y, z]: P3): Vec2 => [(x - y) * 0.866, (x + y) * 0.5 - z]
  const faces: P3[][] = []
  const details: P3[][] = []

  // A prism from z0 to z1, its top scaled by `taper`. Only the faces turned
  // toward the viewer (+x, +y and the top) are drawn, far ones first.
  const extrude = (poly: Vec2[], z0: number, z1: number, taper = 1) => {
    const top = poly.map(([x, y]) => [x * taper, y * taper] as Vec2)
    const sides: { pts: P3[]; depth: number }[] = []
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length]
      if ((b[1] - a[1]) - (b[0] - a[0]) <= 1e-9) return
      const [ta, tb] = [top[i], top[(i + 1) % poly.length]]
      sides.push({
        pts: [[a[0], a[1], z0], [b[0], b[1], z0], [tb[0], tb[1], z1], [ta[0], ta[1], z1]],
        depth: a[0] + b[0] + a[1] + b[1],
      })
    })
    sides.sort((p, q) => p.depth - q.depth).forEach(f => faces.push(f.pts))
    faces.push(top.map(([x, y]) => [x, y, z1] as P3))
  }
  const square = (h: number): Vec2[] => [[-h, -h], [h, -h], [h, h], [-h, h]]
  const cross = (l: number, w: number): Vec2[] => [
    [-w, -l], [w, -l], [w, -w], [l, -w], [l, w], [w, w],
    [w, l], [-w, l], [-w, w], [-l, w], [-l, -w], [-w, -w],
  ]
  // Truer to the switch would be a 1.2 mm flange; at card size its two edges
  // would print as one solid band, so it is drawn a little deeper.
  extrude(square(6.8), 0, 5.2)          // bottom housing
  extrude(square(7.8), 5.2, 7.2)        // the flange that sits on the plate
  extrude(square(7.2), 7.2, 12.6, 0.8)  // top housing, tapering
  extrude(square(3.1), 12.6, 13.4)      // stem boss
  extrude(cross(2.6, 0.95), 13.4, 17.6) // the cross stem

  const line = (...pts: P3[]) => details.push(pts)
  // Only what survives at card size: panel grooves on one face of the bottom
  // housing, the window on the other, the pins, and the clip slots above.
  line([-3.2, 6.8, 0], [-3.2, 6.8, 5.2]); line([3.2, 6.8, 0], [3.2, 6.8, 5.2])
  line([6.8, -2.6, 1.2], [6.8, 2.6, 1.2], [6.8, 2.6, 4], [6.8, -2.6, 4], [6.8, -2.6, 1.2])
  line([1, 6.8, 0], [1, 6.8, -3]); line([6.8, -4.4, 0], [6.8, -4.4, -3])
  const inset = (z: number) => 7.2 - (7.2 - 7.2 * 0.8) * (z - 7.2) / 5.4
  line([inset(7.2), -1.6, 7.2], [inset(11), 0, 11], [inset(7.2), 1.6, 7.2])
  line([-1.6, inset(7.2), 7.2], [0, inset(11), 11], [1.6, inset(7.2), 7.2])

  // Fit into the 100-unit box, leaving room below for the pins.
  const all = [...faces.flat(), ...details.flat()].map(iso)
  const xs = all.map(p => p[0]), ys = all.map(p => p[1])
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const k = 86 / Math.max(maxX - minX, maxY - minY)
  const place = (p: P3): Vec2 => {
    const [x, y] = iso(p)
    return [50 + (x - (minX + maxX) / 2) * k, 50 + (y - (minY + maxY) / 2) * k]
  }
  return {
    id: 'switch',
    label: 'MX switch',
    strokeWidth: 3.6,
    ops: [
      ...faces.flatMap((f): IconOp[] => {
        const pts = f.map(place)
        return [{ kind: 'fill', pts }, { kind: 'stroke', pts, closed: true }]
      }),
      ...details.map((d): IconOp => ({ kind: 'stroke', pts: d.map(place), closed: false })),
    ],
  }
}

export const CARD_ICONS: Record<CardIconId, CardIcon> = { keycap: keycap(), switch: mxSwitch() }

/** One stroke segment with round ends: a stadium, as a single ring. */
function capsule(a: Vec2, b: Vec2, r: number, segs = 10): Ring {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
  const ring: Vec2[] = []
  // Half a circle around each end, joined by the two long sides.
  for (let i = 0; i <= segs; i++) {
    const t = ang + Math.PI / 2 + (Math.PI * i) / segs
    ring.push([a[0] + r * Math.cos(t), a[1] + r * Math.sin(t)])
  }
  for (let i = 0; i <= segs; i++) {
    const t = ang - Math.PI / 2 + (Math.PI * i) / segs
    ring.push([b[0] + r * Math.cos(t), b[1] + r * Math.sin(t)])
  }
  return ring
}

/**
 * The icon as a printable outline, `sizeMm` across its drawing box, centred on
 * the origin with y up. The strokes keep their proportion to the drawing, so a
 * bigger card gets bolder lines rather than thinner ones.
 */
export function iconOutline(id: CardIconId, sizeMm: number): MultiPolygon {
  const icon = CARD_ICONS[id]
  const s = sizeMm / 100
  // Flip y here, before any boolean, so every ring keeps the winding the
  // clipper hands back rather than coming out inside-out.
  const mm = ([x, y]: Vec2): Vec2 => [(x - 50) * s, (50 - y) * s]
  const r = (icon.strokeWidth / 2) * s
  let ink: MultiPolygon = []
  for (const op of icon.ops) {
    const pts = op.pts.map(mm)
    if (op.kind === 'fill') {
      if (ink.length) ink = difference(ink, [[pts]])
      continue
    }
    const segments: Polygon[] = []
    const n = op.closed ? pts.length : pts.length - 1
    for (let i = 0; i < n; i++) segments.push([capsule(pts[i], pts[(i + 1) % pts.length], r)])
    ink = union(ink, segments)
  }
  return ink
}

/** The same drawing as SVG markup, for previews. `ink` and `paper` are CSS colours. */
export function iconSvg(id: CardIconId, ink: string, paper: string): string {
  const icon = CARD_ICONS[id]
  const pts = (p: Vec2[]) => p.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const body = icon.ops.map(op => (op.kind === 'fill'
    ? `<polygon points="${pts(op.pts)}" fill="${paper}" stroke="none"/>`
    : `<${op.closed ? 'polygon' : 'polyline'} points="${pts(op.pts)}" fill="none"/>`)).join('')
  return `<g stroke="${ink}" stroke-width="${icon.strokeWidth}" stroke-linecap="round" `
    + `stroke-linejoin="round">${body}</g>`
}
