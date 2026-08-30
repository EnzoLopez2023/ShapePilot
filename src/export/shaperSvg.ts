// Shaper Origin SVG. The colour convention is what Shaper actually reads; the
// shaper:cutType attributes are additive and preferred when present. Generalised
// from the keycap-tray writer that matches systainer_tray_1_SHAPER.svg field for
// field -- the encoding below is unchanged, only the input is.
import type { MultiPolygon, Ring } from '../geometry/vec.ts'
import { signedArea } from '../geometry/vec.ts'
import type { CutType } from '../model/document.ts'
import type { CutDrawing, CutLayer } from './cutLayers.ts'

const SHAPER_NS = 'http://www.shapertools.com/namespaces/shaper'

export interface CutStyle {
  fill: string
  stroke: string
  strokeWidth: number
  /** Shaper's own vocabulary, which differs from ours for the two through cuts. */
  cutType: string
}

export const CUT_STYLE: Record<CutType, CutStyle> = {
  exterior: { fill: '#FFFFFF', stroke: '#000000', strokeWidth: 0.1, cutType: 'outside' },
  pocket: { fill: '#7F7F7F', stroke: 'none', strokeWidth: 0, cutType: 'pocket' },
  interior: { fill: '#000000', stroke: 'none', strokeWidth: 0, cutType: 'inside' },
  // An on-line cut centres the bit on the path, so it is a stroke with no fill;
  // the grey matches the pocket hue Shaper already reserves for material removal.
  online: { fill: 'none', stroke: '#7F7F7F', strokeWidth: 0.25, cutType: 'online' },
  guide: { fill: 'none', stroke: '#0068FF', strokeWidth: 0.25, cutType: 'guide' },
}

/** 4 decimals, trailing zeros stripped -- matches the reference files. */
const n = (v: number): string => {
  const s = v.toFixed(4)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/**
 * SVG is y-down, the model is y-up. Flipping reverses ring orientation, so
 * windings are restored afterwards -- otherwise fill-rule inverts and holes
 * render (and cut) solid.
 */
interface SvgBounds {
  minX: number
  maxY: number
  widthMm: number
  heightMm: number
}

function boundsOf(layers: readonly CutLayer[], guideRings: readonly Ring[]): SvgBounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const see = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  for (const layer of layers) {
    for (const polygon of layer.polygons) for (const ring of polygon) for (const [x, y] of ring) see(x, y)
  }
  for (const ring of guideRings) for (const [x, y] of ring) see(x, y)
  if (!Number.isFinite(minX)) return { minX: 0, maxY: 0, widthMm: 0, heightMm: 0 }
  return { minX, maxY, widthMm: maxX - minX, heightMm: maxY - minY }
}

function ringToPath(ring: Ring, bounds: SvgBounds, wantCCW: boolean): string {
  const flipped: Ring = ring.map(([x, y]) => [x - bounds.minX, bounds.maxY - y] as const)
  const oriented = (signedArea(flipped) > 0) === wantCCW ? flipped : [...flipped].reverse()
  const parts = oriented.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${n(x)},${n(y)}`)
  return `${parts.join(' ')} Z`
}

/** Holes ride as extra subpaths in one `d`, distinguished by opposite winding. */
function multiToPath(mp: MultiPolygon, bounds: SvgBounds): string {
  const subpaths: string[] = []
  for (const poly of mp) {
    poly.forEach((ring, i) => subpaths.push(ringToPath(ring, bounds, i === 0)))
  }
  return subpaths.join(' ')
}

const escapeText = (s: string): string => s.replace(/[<&>]/g, '')

function group(id: string, style: CutStyle, d: string, extra = ''): string {
  if (!d) return ''
  const stroke = style.stroke === 'none'
    ? 'stroke="none"'
    : `stroke="${style.stroke}" stroke-width="${style.strokeWidth}"`
  return `  <g id="${id}" shaper:cutType="${style.cutType}"${extra}>\n` +
    `    <path d="${d}" fill="${style.fill}" ${stroke}/>\n  </g>\n`
}

export function writeShaperSvg(drawing: CutDrawing): string {
  const guideRings = drawing.guideRings ?? []
  const bounds = boundsOf(drawing.layers, guideRings)
  const { widthMm, heightMm } = bounds

  let body = ''
  for (const layer of drawing.layers) {
    const style = CUT_STYLE[layer.cutType]
    // Only a pocket has a depth to declare; on every other cut type the
    // attribute would be meaningless and Shaper ignores it.
    const extra = layer.cutType === 'pocket' && layer.depthMm !== undefined
      ? ` shaper:cutDepth="${n(layer.depthMm)}mm"`
      : ''
    body += group(layer.id, style, multiToPath(layer.polygons, bounds), extra)
  }
  if (guideRings.length) {
    body += group('labels', CUT_STYLE.guide, guideRings.map(r => ringToPath(r, bounds, true)).join(' '))
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="${SHAPER_NS}" version="1.1"
     width="${n(widthMm)}mm" height="${n(heightMm)}mm" viewBox="0 0 ${n(widthMm)} ${n(heightMm)}">
  <title>${escapeText(drawing.name)}</title>
  <desc>${escapeText(drawing.description ?? '1 unit = 1 mm, 1:1 scale.')}</desc>
${body}</svg>
`
}
