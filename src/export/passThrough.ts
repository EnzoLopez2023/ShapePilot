// Pass-through: a part longer than the BenchPilot reach, cut in segments.
//
// The method from Shaper's own BenchPilot session: ShaperTape runs the whole
// board and Origin scans it all, so it knows the whole workspace however the
// board is moved. The file stays one drawing of the whole part; only a cut
// longer than the reach is split, into pieces that overlap across each seam.
// Cut what is in reach, slide the board along its length, cut the rest.
//
// A split outline can no longer be a closed shape, and Origin only offsets
// closed shapes, so each piece becomes an open on-line cut already offset by
// the bit radius -- with the rounded corners an outside cut would have left.
// That is why the bit has to be known, and why it must be the one used.
//
// Only axis-aligned rectangles are split. Every cabinet panel and its long
// pockets are rectangles; anything else is left as it is.
import type { BenchPilotReach } from '../model/benchpilot.ts'
import { fitsReach } from '../model/benchpilot.ts'
import type { Ring, Vec2 } from '../geometry/vec.ts'
import type { CutDrawing, CutLayer } from './cutLayers.ts'

/** Each segment runs this far past a seam, so the halves overlap twice this. */
export const PASS_THROUGH_OVERLAP_MM = 3
/** 1/4 in, the usual Origin bit for cutting a panel out. */
export const DEFAULT_PASS_THROUGH_BIT_MM = 6.35

export interface PassThroughPlan {
  /** The model axis the part is split along: its long side. */
  axis: 'x' | 'y'
  /** Where the part starts and ends along that axis. */
  startMm: number
  endMm: number
  /** Seam positions along the axis, in model coordinates. */
  seamsMm: number[]
  /** Each segment's extent along the axis, overlaps included. */
  windows: [number, number][]
  /** True when the length runs along the reach's 18 in width. */
  alongReachWidth: boolean
  bitMm: number
  overlapMm: number
}

interface Rect { x0: number; y0: number; x1: number; y1: number }

/** The ring as a rectangle when it is one, axis-aligned. */
function asRect(ring: Ring): Rect | null {
  if (ring.length !== 4) return null
  const xs = [...new Set(ring.map(p => p[0]))]
  const ys = [...new Set(ring.map(p => p[1]))]
  if (xs.length !== 2 || ys.length !== 2) return null
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

const outlineRect = (drawing: CutDrawing): Rect | null => {
  const exterior = drawing.layers.filter(l => l.cutType === 'exterior')
  if (exterior.length !== 1 || exterior[0].polygons.length !== 1) return null
  const [poly] = exterior[0].polygons
  return poly.length === 1 ? asRect(poly[0]) : null
}

/**
 * How a part this size splits, or null when it fits whole or is too wide to
 * pass through either way. Shared by the export and the build guide.
 */
export function passThroughSegments(
  reach: BenchPilotReach, wMm: number, hMm: number, bitMm: number,
  overlapMm = PASS_THROUGH_OVERLAP_MM,
): { count: number; limitMm: number; alongReachWidth: boolean } | null {
  if (fitsReach(reach, wMm, hMm)) return null
  const length = Math.max(wMm, hMm)
  const across = Math.min(wMm, hMm) + bitMm
  // The width has to fit across the reach; the length then runs the other way.
  const alongReachWidth = across <= reach.heightMm
  if (!alongReachWidth && across > reach.widthMm) return null
  const limitMm = alongReachWidth ? reach.widthMm : reach.heightMm
  // The longest window: an end segment, which carries the bit radius at its end.
  const usable = limitMm - overlapMm - bitMm / 2
  if (usable <= 0) return null
  // Middle windows carry an overlap at both seams, so they are the tighter ones past two.
  for (let count = 2; count < 50; count++) {
    const span = length / count
    if (span + overlapMm + bitMm / 2 <= limitMm && (count < 3 || span + 2 * overlapMm <= limitMm)) {
      return { count, limitMm, alongReachWidth }
    }
  }
  return null
}

/** The seam closest to `ideal` whose overlap misses every short cut, if there is one in range. */
function placeSeam(ideal: number, lo: number, hi: number, overlap: number, blocked: [number, number][]): number {
  const clear = (s: number) => s >= lo && s <= hi
    && blocked.every(([a, b]) => s + overlap <= a || s - overlap >= b)
  const candidates = [ideal, ...blocked.flatMap(([a, b]) => [a - overlap, b + overlap])]
    .filter(clear)
    .sort((p, q) => Math.abs(p - ideal) - Math.abs(q - ideal))
  return candidates[0] ?? ideal
}

export function planPassThrough(
  drawing: CutDrawing, reach: BenchPilotReach, bitMm = DEFAULT_PASS_THROUGH_BIT_MM,
  overlapMm = PASS_THROUGH_OVERLAP_MM,
): PassThroughPlan | null {
  const rect = outlineRect(drawing)
  if (!rect) return null
  const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0
  const split = passThroughSegments(reach, w, h, bitMm, overlapMm)
  if (!split) return null
  const axis = h >= w ? 'y' : 'x'
  const [start, end] = axis === 'y' ? [rect.y0, rect.y1] : [rect.x0, rect.x1]
  const length = end - start
  const r = bitMm / 2

  // Short cuts -- the dados -- along the axis; a seam's overlap should miss them.
  const blocked: [number, number][] = []
  for (const layer of drawing.layers) {
    if (layer.cutType === 'exterior' || layer.cutType === 'guide') continue
    for (const ring of layer.polygons.flat()) {
      const vs = ring.map(p => (axis === 'y' ? p[1] : p[0]))
      const a = Math.min(...vs), b = Math.max(...vs)
      if (b - a < length / split.count) blocked.push([a, b])
    }
  }

  const seamsMm: number[] = []
  let prev = start - r
  for (let i = 1; i < split.count; i++) {
    const ideal = start + (length * i) / split.count
    // Stay inside this window's limit, and leave the rest enough room.
    const hi = prev + split.limitMm - overlapMm
    const lo = end + r - (split.count - i) * (split.limitMm - 2 * overlapMm) + overlapMm
    const seam = placeSeam(ideal, lo, hi, overlapMm, blocked)
    seamsMm.push(seam)
    prev = seam - overlapMm
  }
  const windows = [start, ...seamsMm].map((s, i): [number, number] => [
    i === 0 ? start : s - overlapMm,
    i === seamsMm.length ? end : seamsMm[i] + overlapMm,
  ])
  return {
    axis, startMm: start, endMm: end, seamsMm, windows,
    alongReachWidth: split.alongReachWidth, bitMm, overlapMm,
  }
}

const ARC_STEPS = 8

/** A quarter arc around (cx, cy), from angle a0 to a1 in degrees, first point excluded. */
const arc = (cx: number, cy: number, r: number, a0: number, a1: number): Vec2[] =>
  Array.from({ length: ARC_STEPS }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * (i + 1)) / ARC_STEPS) * Math.PI) / 180
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const
  })

/**
 * The outline pieces of one window, offset outward by the bit radius. Built in
 * (u, v) -- u along the split axis, v across it -- then mapped back.
 */
function outlinePieces(rect: Rect, plan: PassThroughPlan, i: number): Ring[] {
  const r = plan.bitMm / 2
  const [u0, u1] = [plan.startMm, plan.endMm]
  const [v0, v1] = plan.axis === 'y' ? [rect.x0, rect.x1] : [rect.y0, rect.y1]
  const [a, b] = plan.windows[i]
  const first = i === 0, last = i === plan.windows.length - 1
  const toXY = (pts: Vec2[]): Ring => pts.map(([u, v]): Vec2 => (plan.axis === 'y' ? [v, u] : [u, v]))
  if (first) {
    return [toXY([
      [b, v0 - r], [u0, v0 - r], ...arc(u0, v0, r, 270, 180),
      [u0 - r, v1], ...arc(u0, v1, r, 180, 90), [b, v1 + r],
    ])]
  }
  if (last) {
    return [toXY([
      [a, v0 - r], [u1, v0 - r], ...arc(u1, v0, r, 270, 360),
      [u1 + r, v1], ...arc(u1, v1, r, 0, 90), [a, v1 + r],
    ])]
  }
  return [toXY([[a, v0 - r], [b, v0 - r]]), toXY([[a, v1 + r], [b, v1 + r]])]
}

/** The rectangle cut to one window along the axis. */
const clip = (rc: Rect, axis: 'x' | 'y', [a, b]: [number, number]): Ring | null => {
  const r = axis === 'y'
    ? { ...rc, y0: Math.max(rc.y0, a), y1: Math.min(rc.y1, b) }
    : { ...rc, x0: Math.max(rc.x0, a), x1: Math.min(rc.x1, b) }
  if (r.x1 <= r.x0 || r.y1 <= r.y0) return null
  return [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]
}

const fmt = (v: number) => String(+v.toFixed(2))

export function splitForPassThrough(drawing: CutDrawing, plan: PassThroughPlan): CutDrawing {
  const panel = outlineRect(drawing)
  if (!panel) return drawing
  const { axis, windows } = plan
  const fitsAWindow = (rc: Rect) => {
    const [a, b] = axis === 'y' ? [rc.y0, rc.y1] : [rc.x0, rc.x1]
    return windows.some(([wa, wb]) => a >= wa && b <= wb)
  }

  const layers: CutLayer[] = []
  for (const layer of drawing.layers) {
    if (layer.cutType === 'exterior') {
      windows.forEach((_w, i) => layers.push({
        id: `outline-segment-${i + 1}`, cutType: 'online', polygons: [],
        openPaths: outlinePieces(panel, plan, i),
      }))
      continue
    }
    const keep = layer.polygons.filter(poly => {
      const rc = poly.length === 1 ? asRect(poly[0]) : null
      return !rc || fitsAWindow(rc)
    })
    const long = layer.polygons
      .map(poly => (poly.length === 1 ? asRect(poly[0]) : null))
      .filter((rc): rc is Rect => !!rc && !fitsAWindow(rc))
    if (keep.length || layer.openPaths?.length) layers.push({ ...layer, polygons: keep })
    if (!long.length) continue
    windows.forEach((w, i) => {
      const pieces = long.map(rc => clip(rc, axis, w)).filter((r): r is Ring => !!r)
      if (pieces.length) {
        layers.push({ ...layer, id: `${layer.id}-segment-${i + 1}`, polygons: pieces.map(r => [r]), openPaths: undefined })
      }
    })
  }

  const finished: Ring = [[panel.x0, panel.y0], [panel.x1, panel.y0], [panel.x1, panel.y1], [panel.x0, panel.y1]]
  return {
    ...drawing,
    layers,
    guideRings: [...(drawing.guideRings ?? []), finished],
    description:
      `${drawing.description ?? ''} || PASS-THROUGH in ${windows.length} segments along the length, ` +
      `seams at ${plan.seamsMm.map(s => `${fmt(s - plan.startMm)} mm`).join(', ')}, ` +
      `${fmt(plan.overlapMm * 2)} mm overlap. Tape and scan the whole board, cut what is in reach, ` +
      `slide it along its length, cut the rest. The outline is open on-line cuts already offset ` +
      `for a ${fmt(plan.bitMm)} mm bit: cut ON the line with that bit. The blue rectangle is the ` +
      `finished edge, reference only.`,
  }
}

/** The drawing as it should be exported for this reach: split when it has to be. */
export function forReach(
  drawing: CutDrawing, reach: BenchPilotReach | null, bitMm = DEFAULT_PASS_THROUGH_BIT_MM,
): CutDrawing {
  const plan = reach && planPassThrough(drawing, reach, bitMm)
  return plan ? splitForPassThrough(drawing, plan) : drawing
}
