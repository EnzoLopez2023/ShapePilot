// A traced VectorDrawing -> the Playground's path objects.
//
// The drawing speaks cubic beziers in millimetres, y-up (the contract's frame,
// which is already the document's frame -- see src/model/document.ts -- so no
// axis flip happens here). Everything downstream of the scene works in
// polylines, so curves are flattened at the same resolution src/import/svg.ts
// uses, and outer/hole nesting is recovered by containment exactly as an SVG
// import does, because a subpath carries no winding information we can trust.
import type { PathCommand, VectorDrawing } from '../../../lib/contracts/vectorDrawing.ts'
import type { Contour, PathObject } from '../../model/document.ts'
import { IDENTITY_TRANSFORM, newId } from '../../model/scene.ts'
import type { Ring } from '../../geometry/vec.ts'
import { quantizeRing, signedArea } from '../../geometry/vec.ts'
import { nestRings } from '../../geometry/nest.ts'

/** Curve flattening resolution, matching src/import/svg.ts. */
const CURVE_DIVISIONS = 24

type Pt = readonly [number, number]

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Cubic bezier sample at t, De Casteljau. */
function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const ax = lerp(p0[0], p1[0], t), ay = lerp(p0[1], p1[1], t)
  const bx = lerp(p1[0], p2[0], t), by = lerp(p1[1], p2[1], t)
  const cx = lerp(p2[0], p3[0], t), cy = lerp(p2[1], p3[1], t)
  const dx = lerp(ax, bx, t), dy = lerp(ay, by, t)
  const ex = lerp(bx, cx, t), ey = lerp(by, cy, t)
  return [lerp(dx, ex, t), lerp(dy, ey, t)]
}

/** Drop consecutive duplicates and any ring that collapsed to a sliver -- both
 *  only ever break the clipper downstream. */
function cleanRing(ring: Ring): Ring {
  const out: Ring = []
  for (const p of quantizeRing(ring)) {
    const prev = out[out.length - 1]
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p)
  }
  return out.length >= 3 && Math.abs(signedArea(out)) > 1e-9 ? out : []
}

/** One VectorPath's commands -> its subpath rings, curves already flattened. */
export function pathToRings(commands: readonly PathCommand[]): Ring[] {
  const rings: Ring[] = []
  let current: Ring = []
  let cursor: Pt = [0, 0]

  const flush = () => {
    const ring = cleanRing(current)
    if (ring.length) rings.push(ring)
    current = []
  }

  for (const command of commands) {
    switch (command.cmd) {
      case 'M':
        flush()
        cursor = command.to
        current.push([cursor[0], cursor[1]])
        break
      case 'L':
        cursor = command.to
        current.push([cursor[0], cursor[1]])
        break
      case 'C': {
        const from = cursor
        for (let i = 1; i <= CURVE_DIVISIONS; i++) {
          current.push(cubic(from, command.c1, command.c2, command.to, i / CURVE_DIVISIONS) as [number, number])
        }
        cursor = command.to
        break
      }
      case 'Z':
        flush()
        break
    }
  }
  flush()
  return rings
}

/**
 * Every filled region in the drawing, as its own scene object. A path with a
 * hole yields one object carrying [outer, ...holes]; an island inside a hole
 * (rare from a trace, but `nestRings` handles it) starts a fresh object.
 */
export function vectorDrawingToPathObjects(drawing: VectorDrawing): PathObject[] {
  const filename = `${drawing.paths[0]?.name ?? 'drawing'}.svg`
  const objects: PathObject[] = []

  for (const path of drawing.paths) {
    const regions = nestRings(pathToRings(path.commands))
    regions.forEach((polygon, i) => {
      objects.push(makePathObject(
        polygon.map(ring => ring.map(([x, y]) => [x, y] as const)) as Contour[],
        regions.length > 1 ? `${path.name} ${i + 1}` : path.name,
        path.fill,
        filename,
      ))
    })
  }
  return objects
}

function makePathObject(
  rings: Contour[], name: string, fill: string | undefined, filename: string,
): PathObject {
  return {
    id: newId(),
    name,
    type: 'path',
    rings,
    thicknessMm: 1,
    transform: { ...IDENTITY_TRANSFORM },
    mode: 'solid',
    visible: true,
    locked: false,
    ...(fill ? { color: fill } : {}),
    source: { format: 'svg', filename },
  }
}
