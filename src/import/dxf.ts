// DXF -> closed outlines in millimetres, y-up.
//
// DXF is already CAD-up, so unlike SVG there is no flip. What it does have is
// disconnected LINE and ARC entities that only form a shape once chained, which
// is how most CAD packages export an outline.
import DxfParser from 'dxf-parser'
import type {
  IArcEntity, ICircleEntity, IEntity, ILineEntity, ILwpolylineEntity,
  IPolylineEntity,
} from 'dxf-parser'
import type { Contour } from '../model/document.ts'
import type { Ring, Vec2 } from '../geometry/vec.ts'
import { QUANTUM, quantizeRing, signedArea } from '../geometry/vec.ts'
import { nestRings } from '../geometry/nest.ts'
import type { ImportedOutlines } from './types.ts'
import { ImportError, MM_PER_INCH } from './types.ts'

/** $INSUNITS values we can honour; anything else is assumed to be millimetres. */
const INSUNITS_MM: Record<number, number> = {
  1: MM_PER_INCH,   // inches
  2: MM_PER_INCH * 12,
  4: 1,             // millimetres
  5: 10,            // centimetres
  6: 1_000,         // metres
}

const ARC_SEGMENTS_PER_TURN = 64

const arcRing = (cx: number, cy: number, r: number, from: number, to: number): Vec2[] => {
  let sweep = to - from
  while (sweep <= 0) sweep += 2 * Math.PI
  const steps = Math.max(2, Math.ceil((sweep / (2 * Math.PI)) * ARC_SEGMENTS_PER_TURN))
  const pts: Vec2[] = []
  for (let i = 0; i <= steps; i++) {
    const a = from + (sweep * i) / steps
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return pts
}

const deg = (d: number): number => (d * Math.PI) / 180

/** Polylines and circles are closed on their own; lines and arcs are fragments. */
interface Fragments { closed: Ring[]; open: Ring[] }

function collect(entities: readonly IEntity[], scale: number): Fragments {
  const closed: Ring[] = []
  const open: Ring[] = []
  const s = (p: { x: number; y: number }): Vec2 => [p.x * scale, p.y * scale]

  for (const e of entities) {
    switch (e.type) {
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const poly = e as ILwpolylineEntity | IPolylineEntity
        const ring = (poly.vertices ?? []).map(s)
        if (ring.length < 2) break
        // `shape` is the closed flag (group code 70 bit 1).
        ;(poly.shape ? closed : open).push(ring)
        break
      }
      case 'LINE': {
        const line = e as ILineEntity
        if (line.vertices?.length >= 2) open.push(line.vertices.map(s))
        break
      }
      case 'CIRCLE': {
        const c = e as ICircleEntity
        closed.push(arcRing(c.center.x * scale, c.center.y * scale, c.radius * scale, 0, 2 * Math.PI).slice(0, -1))
        break
      }
      case 'ARC': {
        const a = e as IArcEntity
        open.push(arcRing(
          a.center.x * scale, a.center.y * scale, a.radius * scale,
          deg(a.startAngle), deg(a.endAngle),
        ))
        break
      }
      default:
        // TEXT, DIMENSION, INSERT and the rest carry no cuttable outline.
        break
    }
  }
  return { closed, open }
}

const key = (p: Vec2): string => `${Math.round(p[0] / QUANTUM)}|${Math.round(p[1] / QUANTUM)}`

/**
 * Chain open fragments end-to-end into closed rings. Endpoints are matched on
 * the QUANTUM grid, which is the same tolerance the clipper and the mesher use,
 * so a CAD file that is closed to within a rounding error still closes here.
 */
function chain(fragments: readonly Ring[]): Ring[] {
  const remaining = fragments.map(f => [...f])
  const rings: Ring[] = []

  while (remaining.length) {
    const current = remaining.pop()!
    let extended = true
    while (extended) {
      extended = false
      const tail = current[current.length - 1]
      const head = current[0]
      if (key(tail) === key(head) && current.length > 2) break

      for (let i = remaining.length - 1; i >= 0; i--) {
        const other = remaining[i]
        const oHead = other[0], oTail = other[other.length - 1]
        if (key(tail) === key(oHead)) current.push(...other.slice(1))
        else if (key(tail) === key(oTail)) current.push(...[...other].reverse().slice(1))
        else if (key(head) === key(oTail)) current.unshift(...other.slice(0, -1))
        else if (key(head) === key(oHead)) current.unshift(...[...other].reverse().slice(0, -1))
        else continue
        remaining.splice(i, 1)
        extended = true
        break
      }
    }
    // Only genuinely closed chains are cuttable regions; a dangling run is
    // geometry the file never closed, and silently closing it would invent a cut.
    if (current.length > 2 && key(current[0]) === key(current[current.length - 1])) {
      rings.push(current.slice(0, -1))
    }
  }
  return rings
}

export async function importDxf(text: string): Promise<ImportedOutlines> {
  const parsed = new DxfParser().parseSync(text)
  if (!parsed?.entities?.length) throw new ImportError('the DXF file contains no entities')

  const insunits = (parsed.header?.['$INSUNITS'] as number | undefined) ?? 4
  const scale = INSUNITS_MM[insunits] ?? 1

  const { closed, open } = collect(parsed.entities, scale)
  const rings = [...closed, ...chain(open)]
    .map(r => quantizeRing(r))
    .filter(r => r.length >= 3 && Math.abs(signedArea(r)) > 1e-9)

  if (!rings.length) throw new ImportError('no closed outlines found in the DXF file')

  // DXF has no notion of a hole, so a bolt circle inside a plate arrives as
  // plain rings; containment is what recovers the intent.
  const regions = nestRings(rings).map(poly => poly as Contour[])
  return { kind: '2d', format: 'dxf', regions }
}
