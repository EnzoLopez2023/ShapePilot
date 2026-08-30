// SVG -> closed outlines in millimetres, y-up.
//
// Two conversions matter and both are easy to get wrong: SVG is y-down while
// everything downstream is y-up, and an SVG user unit is only a millimetre if
// the document says so. Shaper's own guidance is to save in real-world units,
// so a width/height carrying a unit is honoured and a bare viewBox falls back
// to the CSS 96 dpi default.
import type { Contour } from '../model/document.ts'
import type { Ring } from '../geometry/vec.ts'
import { quantizeRing, signedArea } from '../geometry/vec.ts'
import { nestRings } from '../geometry/nest.ts'
import type { ImportedOutlines } from './types.ts'
import { ImportError, MM_PER_INCH, MM_PER_PX_96DPI } from './types.ts'

/** Curve flattening resolution. 24 segments per path is three times finer than
 *  QUANTUM at any plausible cutting scale. */
const CURVE_DIVISIONS = 24

const UNIT_MM: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1_000,
  in: MM_PER_INCH,
  pt: MM_PER_INCH / 72,
  pc: MM_PER_INCH / 6,
  px: MM_PER_PX_96DPI,
  '': MM_PER_PX_96DPI,
}

/**
 * Millimetres per SVG user unit. Derived from the declared width against the
 * viewBox width, which is what actually sets the scale; a document with neither
 * is treated as 96 dpi pixels.
 */
export function unitScaleMm(svg: string): number {
  const width = /\bwidth\s*=\s*"([^"]+)"/.exec(svg)?.[1]?.trim()
  const viewBox = /\bviewBox\s*=\s*"([^"]+)"/.exec(svg)?.[1]?.trim()
  if (!width) return MM_PER_PX_96DPI

  const match = /^([0-9.+-eE]+)\s*([a-z%]*)$/.exec(width)
  if (!match) return MM_PER_PX_96DPI
  const value = Number(match[1])
  const unit = match[2].toLowerCase()
  if (!Number.isFinite(value) || value <= 0 || unit === '%') return MM_PER_PX_96DPI

  const widthMm = value * (UNIT_MM[unit] ?? MM_PER_PX_96DPI)
  if (!viewBox) return unit in UNIT_MM ? UNIT_MM[unit] : MM_PER_PX_96DPI

  const parts = viewBox.split(/[\s,]+/).map(Number)
  const viewWidth = parts[2]
  if (!Number.isFinite(viewWidth) || viewWidth <= 0) return MM_PER_PX_96DPI
  return widthMm / viewWidth
}

export async function importSvg(text: string): Promise<ImportedOutlines> {
  const { SVGLoader } = await import('three/addons/loaders/SVGLoader.js')
  const scale = unitScaleMm(text)
  const parsed = new SVGLoader().parse(text)

  // Every subpath is collected flat and nesting is recovered by containment.
  // SVGLoader can only infer holes from an explicit fill-rule, which plenty of
  // real files (including our own exporter's output) leave off.
  const rings: Ring[] = []
  for (const path of parsed.paths) {
    for (const shape of SVGLoader.createShapes(path)) {
      const outer = toRing(shape.getPoints(CURVE_DIVISIONS), scale)
      if (outer.length >= 3) rings.push(outer)
      for (const hole of shape.holes) {
        const ring = toRing(hole.getPoints(CURVE_DIVISIONS), scale)
        if (ring.length >= 3) rings.push(ring)
      }
    }
  }

  const regions = nestRings(rings).map(poly => poly as Contour[])
  if (!regions.length) {
    throw new ImportError('no closed shapes found -- strokes and text must be converted to paths')
  }
  return { kind: '2d', format: 'svg', regions }
}

/** SVG is y-down; negating y is the whole conversion, and it reverses winding,
 *  which normalizeMulti then corrects. */
function toRing(points: readonly { x: number; y: number }[], scale: number): Ring {
  const ring: Ring = points.map(p => [p.x * scale, -p.y * scale] as const)
  // three closes shapes by repeating the first point; our rings are open.
  if (ring.length > 1) {
    const [fx, fy] = ring[0]
    const [lx, ly] = ring[ring.length - 1]
    if (Math.abs(fx - lx) < 1e-9 && Math.abs(fy - ly) < 1e-9) ring.pop()
  }
  return dedupe(quantizeRing(ring))
}

function dedupe(ring: Ring): Ring {
  const out: Ring = []
  for (const p of ring) {
    const prev = out[out.length - 1]
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p)
  }
  // A ring that collapsed to a sliver has no area and would only break the
  // clipper downstream.
  return out.length >= 3 && Math.abs(signedArea(out)) > 1e-9 ? out : []
}
