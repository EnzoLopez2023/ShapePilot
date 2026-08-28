// Shaper Origin SVG. The colour convention is what Shaper actually reads; the
// shaper:cutType attributes are additive and preferred when present. Matches
// systainer_tray_1_SHAPER.svg field for field.
import type { MultiPolygon, Ring } from '../geometry/vec.ts'
import { signedArea } from '../geometry/vec.ts'
import { buildRegions } from '../geometry/layers.ts'
import { pocketRing } from '../geometry/shapes.ts'
import type { TrayDesign } from '../model/types.ts'

const SHAPER_NS = 'http://www.shapertools.com/namespaces/shaper'

export const CUT_STYLE = {
  exterior: { fill: '#FFFFFF', stroke: '#000000', strokeWidth: 0.1, cutType: 'outside' },
  pocket: { fill: '#7F7F7F', stroke: 'none', strokeWidth: 0, cutType: 'pocket' },
  through: { fill: '#000000', stroke: 'none', strokeWidth: 0, cutType: 'inside' },
  guide: { fill: 'none', stroke: '#0068FF', strokeWidth: 0.25, cutType: 'guide' },
} as const

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

function boundsOf(profile: MultiPolygon): SvgBounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const polygon of profile) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }
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

export interface SvgOptions {
  /** Emit the guide-layer size labels. */
  labels?: boolean
  /** Glyph outlines per pocket id, already positioned in model space. */
  labelPaths?: Map<string, Ring[]>
}

export function writeShaperSvg(design: TrayDesign, opts: SvgOptions = {}): string {
  const { profile } = buildRegions(design)
  const bounds = boundsOf(profile)
  const { widthMm, heightMm } = bounds

  const blind = design.pockets.filter(p => !p.isThrough)
  const through = design.pockets.filter(p => p.isThrough)

  const group = (
    id: string,
    style: typeof CUT_STYLE[keyof typeof CUT_STYLE],
    d: string,
    extra = '',
  ): string => {
    if (!d) return ''
    const stroke = style.stroke === 'none'
      ? 'stroke="none"'
      : `stroke="${style.stroke}" stroke-width="${style.strokeWidth}"`
    return `  <g id="${id}" shaper:cutType="${style.cutType}"${extra}>\n` +
      `    <path d="${d}" fill="${style.fill}" ${stroke}/>\n  </g>\n`
  }

  const pocketPath = blind.map(p => multiToPath([pocketRing(p, design.sizing)], bounds)).join(' ')
  const throughPath = through.map(p => multiToPath([pocketRing(p, design.sizing)], bounds)).join(' ')

  let labelsGroup = ''
  if (opts.labels && opts.labelPaths?.size) {
    const d: string[] = []
    for (const rings of opts.labelPaths.values()) {
      for (const r of rings) d.push(ringToPath(r, bounds, true))
    }
    labelsGroup = group('labels', CUT_STYLE.guide, d.join(' '))
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="${SHAPER_NS}" version="1.1"
     width="${n(widthMm)}mm" height="${n(heightMm)}mm" viewBox="0 0 ${n(widthMm)} ${n(heightMm)}">
  <title>${design.name.replace(/[<&>]/g, '')}</title>
  <desc>Keycap tray. 1 unit = 1 mm, 1:1 scale. grey = pocket ${n(design.pocketDepthMm)} mm | black = through | white+outline = profile | blue = guide</desc>
${group('exterior-profile', CUT_STYLE.exterior, multiToPath(profile, bounds))}${
  group('pockets', CUT_STYLE.pocket, pocketPath, ` shaper:cutDepth="${n(design.pocketDepthMm)}mm"`)
}${group('finger-holes', CUT_STYLE.through, throughPath)}${labelsGroup}</svg>
`
}
