// A step's footprint, in tray coordinates.
//
// One rule holds the whole file together: every step of a pocket is built at
// the origin, transformed about the *pocket's* box, then translated by the
// pocket's (x, y). Passing the pocket's box rather than the step's own is what
// makes a tiered pocket rotate as one rigid body -- get that wrong and a
// rotated hotend bay's nozzle channel swings off its heatsink.
import type { MultiPolygon, Polygon, Ring, Vec2 } from '../../../geometry/vec.ts'
import { translateRing } from '../../../geometry/vec.ts'
import {
  circleRing, ellipseRing, rectRing, regularPolygonRing,
} from '../../../geometry/primitives.ts'
import { applyPocketTransform } from '../../../geometry/pocketTransform.ts'
import { union, unionDisjointFast } from '../../../geometry/boolean.ts'
import type { FingerAccess, PocketStep, StepShape, ToolPocket } from '../model/types.ts'

/** union() but skipping the clipper when nothing overlaps. */
const unionAll = (polys: Polygon[]): MultiPolygon => {
  if (!polys.length) return []
  if (polys.length === 1) return [polys[0]!]
  return unionDisjointFast(polys) ?? union(...polys.map(p => [p]))
}

/**
 * A constant-width run along a polyline: one rectangle per segment, rotated to
 * that segment's heading, plus a disc at each interior vertex so the corner
 * comes out round whatever the angle. The end caps are square -- a channel for
 * an allen key wants its arms to end flush, not domed.
 */
export function channelRings(path: readonly Vec2[], widthMm: number): Polygon[] {
  if (path.length < 2 || !(widthMm > 0)) return []
  const half = widthMm / 2
  const out: Polygon[] = []

  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, ay] = path[i]!
    const [bx, by] = path[i + 1]!
    const len = Math.hypot(bx - ax, by - ay)
    if (len < 1e-9) continue
    const deg = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI
    // Centred on the origin, turned about the origin (which is what a 0 x 0
    // pivot box means), then dropped on the segment's midpoint.
    const centred = translateRing(rectRing(len, widthMm), -len / 2, -half)
    const spun = applyPocketTransform(centred, 0, 0, { rotationDeg: deg })
    out.push([translateRing(spun, (ax + bx) / 2, (ay + by) / 2)])
  }

  // Round every joint, including the two ends' interior neighbours, so a path
  // that doubles back does not leave a notch on the inside of the fold.
  for (let i = 1; i + 1 < path.length; i++) {
    const [x, y] = path[i]!
    out.push([translateRing(circleRing(half, 24), x, y)])
  }
  return out
}

/** The footprint of one step, at the origin and untransformed. */
export function stepLocalRings(shape: StepShape): Polygon[] {
  switch (shape.kind) {
    case 'rect':
      return [[rectRing(shape.widthMm, shape.heightMm, shape.cornerRadiusMm ?? 0, 16)]]
    case 'ellipse':
      return [[translateRing(ellipseRing(shape.rxMm, shape.ryMm), shape.rxMm, shape.ryMm)]]
    case 'polygon':
      // 90 is the primitive's own default -- a vertex at the top, which is what
      // people expect of a drawn hexagon.
      return [[translateRing(
        regularPolygonRing(shape.sides, shape.radiusMm, shape.rotationDeg ?? 90),
        shape.radiusMm, shape.radiusMm,
      )]]
    case 'channel':
      return channelRings(shape.path, shape.widthMm)
    case 'outline':
      return shape.rings.map(poly => poly)
  }
}

/**
 * One step's footprint in tray coordinates: local rings, transformed about the
 * pocket's box, then translated to the pocket's position.
 */
export function stepRings(pocket: ToolPocket, step: PocketStep): Polygon[] {
  const { widthMm: w0, heightMm: h0, x, y } = pocket
  const [ox, oy] = step.offset ?? [0, 0]
  // Offset inside the pocket's frame FIRST, so the transform still pivots on
  // the pocket's box and every step of a tiered pocket turns together.
  return stepLocalRings(step.shape).map(poly =>
    poly.map(ring => translateRing(
      applyPocketTransform(translateRing(ring as Ring, ox, oy), w0, h0, pocket), x, y)),
  )
}

/**
 * The finger scoop, as a footprint hanging off one side of the pocket box.
 *
 * A scallop is a disc, so the wall it breaks is left with a curve a fingertip
 * follows; a slot is square, for getting a tool under something flat. Either
 * way it reaches `reachMm` beyond the box, into the web -- which is why the web
 * checks measure against the pocket's rings including this, not the box.
 */
export function fingerAccessRings(pocket: ToolPocket, fa: FingerAccess): Polygon[] {
  const { widthMm: w0, heightMm: h0, x, y } = pocket
  const w = fa.widthMm
  if (!(w > 0) || !(fa.reachMm > 0)) return []

  // Centre of the chosen side, in the pocket's own frame.
  const at: Record<FingerAccess['side'], [number, number]> = {
    left: [0, h0 / 2], right: [w0, h0 / 2], bottom: [w0 / 2, 0], top: [w0 / 2, h0],
  }
  const [cx, cy] = at[fa.side]

  // Both styles are centred ON the wall and reach `reachMm` beyond it, which is
  // what the type has always promised. The scallop used to be a circle of
  // diameter `widthMm`, so it reached widthMm/2 outward and ignored `reachMm`
  // entirely -- a field that did nothing on one of the two styles, and a scoop
  // that got deeper into the web every time it was made wider.
  const across = fa.side === 'left' || fa.side === 'right'
  const local: Ring = fa.style === 'scallop'
    ? translateRing(
      across ? ellipseRing(fa.reachMm, w / 2, 32) : ellipseRing(w / 2, fa.reachMm, 32),
      cx, cy)
    : (across
        ? translateRing(rectRing(fa.reachMm * 2, w), cx - fa.reachMm, cy - w / 2)
        : translateRing(rectRing(w, fa.reachMm * 2), cx - w / 2, cy - fa.reachMm))

  return [[translateRing(applyPocketTransform(local, w0, h0, pocket), x, y)]]
}

/**
 * How far a finger access reaches beyond the pocket box, on its own side.
 *
 * Placement has to reserve this: the pocket box is not the footprint, and a
 * scoop that overhangs a neighbour or the outline is exactly the defect the
 * wall and web checks exist to catch.
 */
export const fingerAccessReach = (fa: FingerAccess): number => fa.reachMm

/**
 * Everything a pocket removes at one depth: its steps at that depth, plus the
 * finger access when it reaches this far down. Unioned, because a scallop
 * overlaps the step it breaks into.
 */
export function pocketRingsAtDepth(
  pocket: ToolPocket, depthMm: number | null, deepestMm: number,
): MultiPolygon {
  const polys: Polygon[] = []
  for (const step of pocket.steps) {
    if (step.depthMm === depthMm) polys.push(...stepRings(pocket, step))
  }
  const fa = pocket.fingerAccess
  if (fa) {
    const faDepth = fa.depthMm ?? deepestMm
    if (faDepth === depthMm) polys.push(...fingerAccessRings(pocket, fa))
  }
  return unionAll(polys)
}

/** The whole footprint a pocket occupies, at its widest. For web checks. */
export function pocketFootprint(pocket: ToolPocket): MultiPolygon {
  const polys: Polygon[] = pocket.steps.flatMap(s => stepRings(pocket, s))
  if (pocket.fingerAccess) polys.push(...fingerAccessRings(pocket, pocket.fingerAccess))
  return unionAll(polys)
}

/** How far down the pocket's deepest step reaches. `null` if any cuts through. */
export function deepestStepMm(pocket: ToolPocket): number | null {
  let deepest = 0
  for (const s of pocket.steps) {
    if (s.depthMm === null) return null
    if (s.depthMm > deepest) deepest = s.depthMm
  }
  return deepest
}
