// A plain SVG of a 2D design: one <path> per filled region, 1 unit = 1 mm, 1:1
// scale. This is the ordinary-picture export -- no Shaper namespace, no cut
// types -- for artwork traced in the Playground. The Shaper writer in
// src/export/shaperSvg.ts stays untouched; the ring-to-path mechanics are the
// same idea but small enough to keep separate.
import type { MultiPolygon, Ring } from '../geometry/vec.ts'
import { signedArea } from '../geometry/vec.ts'

export interface PlainSvgRegion {
  polygons: MultiPolygon
  /** CSS hex; defaults to solid black. */
  fill?: string
}

/** 4 decimals, trailing zeros stripped -- matches src/export/shaperSvg.ts. */
const n = (v: number): string => {
  const s = v.toFixed(4)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

const escapeText = (s: string): string => s.replace(/[<&>]/g, '')

interface Bounds { minX: number; maxY: number; widthMm: number; heightMm: number }

function boundsOf(regions: readonly PlainSvgRegion[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const region of regions) {
    for (const polygon of region.polygons) {
      for (const ring of polygon) {
        for (const [x, y] of ring) {
          minX = Math.min(minX, x); minY = Math.min(minY, y)
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
        }
      }
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxY: 0, widthMm: 0, heightMm: 0 }
  return { minX, maxY, widthMm: maxX - minX, heightMm: maxY - minY }
}

/** SVG is y-down, the model is y-up. Flipping reverses ring orientation, so the
 *  winding is restored afterwards -- otherwise even-odd fill inverts and holes
 *  render solid. Outer rings come out clockwise (positive area after the flip),
 *  holes the other way. */
function ringToPath(ring: Ring, bounds: Bounds, wantOuter: boolean): string {
  const flipped: Ring = ring.map(([x, y]) => [x - bounds.minX, bounds.maxY - y] as const)
  const isOuter = signedArea(flipped) < 0
  const oriented = isOuter === wantOuter ? flipped : [...flipped].reverse()
  return oriented.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${n(x)},${n(y)}`).join(' ') + ' Z'
}

function regionToPath(region: PlainSvgRegion, bounds: Bounds): string {
  const subpaths: string[] = []
  for (const polygon of region.polygons) {
    polygon.forEach((ring, i) => subpaths.push(ringToPath(ring, bounds, i === 0)))
  }
  const fill = region.fill ?? '#000000'
  return `  <path d="${subpaths.join(' ')}" fill="${fill}" fill-rule="evenodd"/>`
}

export function writePlainSvg(regions: readonly PlainSvgRegion[], opts: { name: string }): string {
  const bounds = boundsOf(regions)
  const body = regions
    .filter(r => r.polygons.some(p => p.length))
    .map(r => regionToPath(r, bounds))
    .join('\n')
  const { widthMm, heightMm } = bounds
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1"
     width="${n(widthMm)}mm" height="${n(heightMm)}mm" viewBox="0 0 ${n(widthMm)} ${n(heightMm)}">
  <title>${escapeText(opts.name)}</title>
  <desc>1 unit = 1 mm, 1:1 scale.</desc>
${body}
</svg>
`
}
