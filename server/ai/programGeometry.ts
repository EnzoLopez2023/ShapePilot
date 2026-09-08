// Withholding imported outlines from the model, and putting them back.
//
// An SVG or DXF import lands in the program as an `extrude` whose profile is
// hundreds of points. Asking a model to echo that back verbatim is a bargain it
// cannot keep: it either truncates the ring, invents coordinates, or -- what
// actually happened -- drops `params.profile` entirely and the answer fails
// validation with "extrude requires params.profile".
//
// It is also the wrong thing to ask for. Those points are the user's artwork.
// Changing a thickness, cutting a slot in it or standing something on it has no
// business retyping them. So a large ring is removed from the JSON the model
// sees and restored from the request afterwards, keyed by node id. What we hid,
// we own: whatever the model emits for those rings is discarded, because it was
// never in a position to know them.
//
// Withheld is not the same as untouchable. In place of the points the model
// gets a measured description and a simplified sketch of the outline -- enough
// to reason about where the part's edges, holes and free space are -- plus an
// explicit account of the edits it can still make: the extrusion thickness, the
// transform, and above all boolean composition, where the imported part is
// returned unchanged inside a `difference` or `union` with new solids the model
// positions against those measurements. That covers the real requests -- cut a
// cable slot, add a foot, thicken it -- without anyone pretending a model can
// author 421 coordinates.
import type {
  PartNode, Point2, ProgramParams, ShapeProgram,
} from '../../lib/contracts/shapeProgram.ts'
import { isBooleanNode } from '../../lib/contracts/shapeProgram.ts'

/**
 * Rings at or below this stay inline. A rectangle, a triangle, a rounded slot
 * -- geometry the model plausibly authored itself and may legitimately want to
 * redraw -- is well under it; every traced import is well over.
 */
export const MAX_INLINE_RING_POINTS = 32

export interface WithheldGeometry {
  /** The name the part had when it was withheld; the fallback match uses it. */
  name: string
  profile: Point2[]
  holes?: Point2[][]
}

export interface ElidedProgram {
  /** The program as it should be serialised into the prompt. */
  program: unknown
  /** One line per withheld outline, to be shown to the model as prose. */
  notes: string[]
  /** Keyed by node id; empty when nothing was large enough to withhold. */
  withheld: Map<string, WithheldGeometry>
}

const pointCount = (p: ProgramParams): number =>
  (p.profile?.length ?? 0) + (p.holes ?? []).reduce((n, h) => n + h.length, 0)

interface Extents { minX: number; minY: number; maxX: number; maxY: number }

function extents(ring: readonly Point2[]): Extents {
  const e: Extents = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const [x, y] of ring) {
    if (x < e.minX) e.minX = x
    if (x > e.maxX) e.maxX = x
    if (y < e.minY) e.minY = y
    if (y > e.maxY) e.maxY = y
  }
  return e
}

const n1 = (v: number): string => v.toFixed(1)

/** Where a ring sits, in coordinates rather than only in size: a cutter has to
 *  be placed somewhere, and "164.5 mm wide" does not say where. */
const span = (e: Extents): string =>
  `x ${n1(e.minX)}..${n1(e.maxX)}, y ${n1(e.minY)}..${n1(e.maxY)} mm`

/** Perpendicular distance from `p` to the segment a-b, or to `a` when the
 *  segment has no length. */
function segmentDistance(p: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Ramer-Douglas-Peucker on an open polyline. Iterative rather than recursive:
 *  a 2 000-point ring is within the limits and deep recursion is not worth the
 *  risk on untrusted input. */
function simplifyOpen(points: readonly Point2[], tolerance: number): Point2[] {
  if (points.length < 3) return [...points]
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()!
    let worst = -1
    let worstAt = -1
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance(points[i], points[first], points[last])
      if (d > worst) { worst = d; worstAt = i }
    }
    if (worst > tolerance && worstAt > 0) {
      keep[worstAt] = 1
      stack.push([first, worstAt], [worstAt, last])
    }
  }
  return points.filter((_, i) => keep[i] === 1)
}

/**
 * A ring reduced to at most `budget` points while keeping its corners.
 *
 * The loop is cut at the point furthest from its start before simplifying, so
 * both ends of each half are real features; running RDP straight down a closed
 * ring gives it a zero-length baseline and it protects the wrong points. The
 * tolerance is then relaxed until the result fits, because the caller wants a
 * sketch of a known size, not a known accuracy.
 */
function simplifyRing(ring: readonly Point2[], budget: number): Point2[] {
  if (ring.length <= budget) return [...ring]

  let cut = 0
  let furthest = -1
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1])
    if (d > furthest) { furthest = d; cut = i }
  }
  const first = ring.slice(0, cut + 1)
  const second = [...ring.slice(cut), ring[0]]

  const e = extents(ring)
  let tolerance = Math.hypot(e.maxX - e.minX, e.maxY - e.minY) / 1_000
  let simplified = ring as readonly Point2[]
  // Doubling converges in a couple of dozen steps for any real outline; the
  // bound is only there so a pathological ring cannot spin here.
  for (let attempt = 0; attempt < 40; attempt++) {
    const a = simplifyOpen(first, tolerance)
    const b = simplifyOpen(second, tolerance)
    // Drop b's duplicated ends: b starts at the cut point and closes on ring[0].
    simplified = [...a, ...b.slice(1, -1)]
    if (simplified.length <= budget) break
    tolerance *= 2
  }
  return simplified.map(([x, y]) => [Number(x.toFixed(1)), Number(y.toFixed(1))] as Point2)
}

/** Points the model may look at per outline. Enough to read a keyboard stand's
 *  ramp, lip and base; small enough that a design full of imports still fits. */
const SKETCH_POINTS = 64
const HOLE_SKETCH_POINTS = 20
/** Beyond this, inner rings are counted and measured but not drawn. */
const MAX_SKETCHED_HOLES = 6

const sketch = (ring: readonly Point2[], budget: number): string =>
  simplifyRing(ring, budget).map(([x, y]) => `[${n1(x)},${n1(y)}]`).join(' ')

function describe(node: PartNode & { params: ProgramParams }): string {
  const profile = node.params.profile ?? []
  const holes = node.params.holes ?? []
  const outer = extents(profile)

  const lines = [
    `- id "${node.id}" ("${node.name}"), thickness ${node.params.heightMm ?? 5} mm:`,
    `    outer ring, ${profile.length} points, spanning ${span(outer)}.`,
  ]
  holes.forEach((hole, i) => {
    if (i >= MAX_SKETCHED_HOLES) return
    lines.push(`    inner ring ${i + 1}, ${hole.length} points, spanning ${span(extents(hole))}.`)
  })
  if (holes.length > MAX_SKETCHED_HOLES) {
    lines.push(`    and ${holes.length - MAX_SKETCHED_HOLES} further inner rings.`)
  }
  lines.push(`    outline sketch (simplified, for reading the shape only, never echo it):`)
  lines.push(`      ${sketch(profile, SKETCH_POINTS)}`)
  holes.forEach((hole, i) => {
    if (i >= MAX_SKETCHED_HOLES) return
    lines.push(`    inner ring ${i + 1} sketch: ${sketch(hole, HOLE_SKETCH_POINTS)}`)
  })
  return lines.join('\n')
}

function elideNode(node: PartNode, out: ElidedProgram): unknown {
  if (isBooleanNode(node)) {
    return { ...node, children: node.children.map(c => elideNode(c, out)) }
  }
  if (node.op !== 'extrude' || pointCount(node.params) <= MAX_INLINE_RING_POINTS) return node

  out.notes.push(describe(node))
  out.withheld.set(node.id, {
    name: node.name,
    profile: node.params.profile ?? [],
    ...(node.params.holes ? { holes: node.params.holes } : {}),
  })
  const { profile: _profile, holes: _holes, ...rest } = node.params
  return { ...node, params: rest }
}

/** Strip large rings out of a program before it is serialised for the model. */
export function elideProgramGeometry(program: ShapeProgram): ElidedProgram {
  const out: ElidedProgram = { program: null, notes: [], withheld: new Map() }
  out.program = { ...program, parts: program.parts.map(p => elideNode(p, out)) }
  return out
}

/**
 * The prose that goes with an elided program: what was withheld, what shape it
 * is, and -- the part that matters -- what can still be done to it. Empty when
 * nothing was withheld, so the prompt is unchanged for designs the model can
 * see whole.
 */
export function withheldGeometryNote(notes: readonly string[]): string {
  return `These parts carry an imported outline with too many points to include.
Their \`profile\` and \`holes\` have been removed from the JSON above and are put
back automatically after you answer, so you never have to write them out:

${notes.join('\n')}

These parts are fully editable, by every means except retyping their points:

- Thickness: set \`params.heightMm\`. That is how far the outline extrudes in z,
  from the plate upwards.
- Placement: set the part's \`transform\` to move, turn or scale it.
- CUT INTO IT: return a \`difference\` whose FIRST child is the imported part and
  whose later children are new solids you position over it, using the spans and
  the outline sketch above to place them. This is how a slot, a bolt hole or a
  recess is added to an import.
- BUILD ONTO IT: return a \`union\` containing the imported part and your new
  parts, again placed against its measurements.
- Replace it: if the user wants a genuinely different shape rather than a change
  to this one, author a NEW part with a NEW id and leave this one out. Say so in
  your notes, because dropping someone's imported artwork should be deliberate.

Two rules make that work:
1. Return the imported part itself unchanged apart from its params, name and
   transform: same id, op "extrude", and \`params.profile\` and \`params.holes\`
   OMITTED.
2. Give any \`difference\` or \`union\` you wrap it in a NEW id of its own. Moving
   the imported id onto the wrapper loses the outline.

Never write coordinates for one of these outlines. The sketch above is a
simplification for reading the shape; points you emit for these parts are
discarded, so an edit expressed that way silently does nothing.`
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function fill(raw: Record<string, unknown>, geometry: WithheldGeometry): void {
  const params = isRecord(raw.params) ? raw.params : {}
  params.profile = geometry.profile
  if (geometry.holes) params.holes = geometry.holes
  else delete params.holes
  raw.params = params
}

/** Nodes that claim to be an extrude but arrived with no profile. Whatever the
 *  model meant by one, it is unusable as it stands. */
function collectOrphans(raw: unknown, into: Record<string, unknown>[]): void {
  if (!isRecord(raw)) return
  if (Array.isArray(raw.children)) for (const c of raw.children) collectOrphans(c, into)
  if (raw.op !== 'extrude') return
  const params = isRecord(raw.params) ? raw.params : null
  if (!params || params.profile === undefined) into.push(raw)
}

function restoreById(
  raw: unknown, withheld: Map<string, WithheldGeometry>, used: Set<string>,
): void {
  if (!isRecord(raw)) return
  if (Array.isArray(raw.children)) {
    for (const child of raw.children) restoreById(child, withheld, used)
  }
  const id = raw.id
  if (typeof id !== 'string') return
  const geometry = withheld.get(id)
  // Only an extrude can carry a profile. If the model turned the part into
  // something else it has misunderstood the request, and validation should say
  // so rather than this quietly patching a mismatch back together.
  if (!geometry || raw.op !== 'extrude') return
  fill(raw, geometry)
  used.add(id)
}

/**
 * Put the withheld rings back into the model's answer, in place, before it is
 * validated. `raw` is untrusted JSON, so this only ever adds known-good
 * geometry to objects that look like nodes and leaves everything else for the
 * validator to reject.
 */
export function restoreProgramGeometry(
  raw: unknown, withheld: Map<string, WithheldGeometry>,
): void {
  if (!withheld.size || !isRecord(raw) || !Array.isArray(raw.parts)) return

  const used = new Set<string>()
  for (const part of raw.parts) restoreById(part, withheld, used)

  const unclaimed = [...withheld].filter(([id]) => !used.has(id))
  if (!unclaimed.length) return

  // The model is told to keep the id, and mostly does. When it renames one
  // anyway -- "keyboard-holder" becoming "keyboard-holder-outline" as it wraps
  // the part in a difference -- the outline would be lost and the turn would
  // fail on a missing profile. So an unclaimed outline is matched by name
  // against the extrudes that arrived without one. Such a node cannot be built
  // as it stands, which makes filling it strictly better than the alternative,
  // and the name is the only other handle the model was given.
  const orphans: Record<string, unknown>[] = []
  for (const part of raw.parts) collectOrphans(part, orphans)

  for (const [, geometry] of unclaimed) {
    const match = orphans.find(o => o.name === geometry.name)
    if (!match) continue
    fill(match, geometry)
    orphans.splice(orphans.indexOf(match), 1)
  }
}
