// Rack pieces as z-bands, where the mesher's z is the rack's DEPTH.
//
// WHY THE AXES ARE SWAPPED. Look at the rack down its depth axis and every
// piece is a constant L: a side wall plus half a shelf. Mapping mesher-z onto
// that axis turns each piece into a stack of 2D regions extruded along the
// depth, which is the one thing `MeshBuilder` does -- so a rack needs no CSG,
// no new dependency, and inherits the tray pipeline's watertightness whole.
//
// It is also the print orientation, and that is not a coincidence. A piece
// printed the way it is used would cantilever a 137 mm shelf over thin air;
// stood on its back face every layer is the same cross-section, so it prints
// with no supports at all. Anything running front-to-back -- the course
// dovetail especially -- is then free, because it never changes between layers.
//
// z = 0 is the BACK. The back lip band is the widest cross-section, so putting
// it on the build plate buys the most adhesion for a ~182 mm tall print.
//
// Two joints, and they are assembled in different directions on purpose:
//
//   left <-> right   Flared tabs through the shelf plate, constant through the
//                    plate's thickness. The halves DROP together. An undercut
//                    can only be assembled along the axis it is constant in,
//                    and that axis is the height here.
//   course <-> course  A sliding dovetail along the full depth. The course
//                    above SLIDES on from the front. Constant along the print
//                    axis, so it prints as plain vertical walls.
//
// Assembly order falls straight out: lay a course's two halves together, then
// slide the finished course onto the stack. The course above then traps the
// seam tabs, which is the only direction the seam is free in.
import type { MultiPolygon, Ring } from '../geometry/vec.ts'
import { multiArea } from '../geometry/vec.ts'
import { difference, intersection, union } from '../geometry/boolean.ts'
import { insertTJunctions } from '../geometry/tjunction.ts'
import { circleRing } from '../geometry/primitives.ts'
import type { Mesh } from '../geometry/mesh.ts'
import { MeshBuilder } from '../geometry/mesh.ts'
import type { RackConfig, RackDerived } from './config.ts'
import { derive } from './config.ts'

export type Side = 'left' | 'right'
export type PieceKind = 'bottom' | 'middle' | 'top'
export interface PieceSpec { kind: PieceKind; side: Side }

export interface Band { z0: number; z1: number; region: MultiPolygon }
export interface Piece { spec: PieceSpec; mesh: Mesh; bands: Band[] }

const box = (x0: number, y0: number, x1: number, y1: number): Ring =>
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

/** Dovetail cross-section: `w0` wide at `y0`, `w1` wide at `y1`, about `cx`. */
const trapezoid = (cx: number, y0: number, y1: number, w0: number, w1: number): Ring =>
  [[cx - w0 / 2, y0], [cx + w0 / 2, y0], [cx + w1 / 2, y1], [cx - w1 / 2, y1]]

const multi = (r: Ring): MultiPolygon => [[r]]

const shift = (mp: MultiPolygon, dx: number): MultiPolygon =>
  mp.map(poly => poly.map(ring => ring.map(([x, y]) => [x + dx, y] as const)))

interface Frame {
  /** Nominal height, which is the stacking pitch contribution. Excludes the rail. */
  height: number
  plateY0: number
  hasSocket: boolean
  hasTongue: boolean
  /** Whether this piece's plate is a floor a case sits on, and so carries lips. */
  isFloor: boolean
}

export function frameFor(cfg: RackConfig, spec: PieceSpec): Frame {
  const d = derive(cfg)
  switch (spec.kind) {
    case 'bottom':
      return { height: d.capHeightMm, plateY0: 0, hasSocket: false, hasTongue: true, isFloor: true }
    case 'middle':
      return {
        height: d.middleHeightMm, plateY0: d.bayClearMm / 2,
        hasSocket: true, hasTongue: true, isFloor: true,
      }
    case 'top':
      // The top cap's plate is a ceiling. The case under it sits on the middle
      // below, which carries that bay's lips, so this plate needs none.
      return {
        height: d.capHeightMm, plateY0: d.bayClearMm / 2,
        hasSocket: true, hasTongue: false, isFloor: false,
      }
  }
}

/**
 * The x-interval one seam tab occupies at depth `z`, or null between tabs.
 *
 * THE SHAPE HAS TO HAVE A NECK, and the first version did not. Defining a tab
 * as "x from the seam out to reach(z)" makes it a graph over the seam line:
 * star-shaped, so it withdraws straight out in +x no matter what reach() does.
 * No undercut is reachable that way. A dovetail needs the tab to exist, at some
 * depths, ONLY beyond the seam -- an island in that slice, joined to the plate
 * at other depths. So the FAR edge is fixed and the NEAR edge is what moves:
 *
 *     |z-zc| <= neck      x from the seam    to seam + reach   (the neck)
 *     |z-zc| <= neck+reach  x from seam+(d-neck) to seam + reach   (the flank)
 *
 * Width at the seam is 2*neck; at the tip it is 2*(neck+reach). Wider at the
 * tip, so it locks. The flank rises 1:1 with depth -- 45 degrees, which is the
 * steepest an undercut can be and still print, since depth is the print axis.
 */
/**
 * The seam profile of a half, as a polyline up the plate's thickness.
 *
 * A V tongue on the left, the same V as a groove on the right, offset by
 * `fitMm` so there is a uniform gap for glue. Constant along the depth, so the
 * whole joint sits in the cross-section: no bands, no staircase, nothing to
 * overhang. That is the entire reason it replaced flared tabs.
 */
export function seamVee(
  cfg: RackConfig, d: RackDerived, side: Side, py0: number, py1: number,
): Ring {
  const x = d.halfWidthMm + (side === 'left' ? 0 : cfg.fitMm)
  return [[x, py0], [x + cfg.seamVeeDepthMm, (py0 + py1) / 2], [x, py1]]
}

export interface ShelfOpening { x0: number; x1: number; z0: number; z1: number }

/** Height of the 45 degree peak over an opening: half its width. */
export const gableHeight = (o: ShelfOpening): number => (o.x1 - o.x0) / 2

/**
 * The x-interval an opening removes at depth `z`, or null outside it.
 *
 * Vertical sides, flat bottom, and a 45 degree peak at the top so nothing ever
 * has to bridge across it. A diamond would do the same job but a rotated square
 * is always half its bounding box, and peaking only the top costs 20% of the
 * hole instead of 50%.
 */
export function openingSpanAt(o: ShelfOpening, z: number): [number, number] | null {
  if (z <= o.z0 || z >= o.z1) return null
  const peakFrom = o.z1 - gableHeight(o)
  if (z <= peakFrom) return [o.x0, o.x1]
  const inset = z - peakFrom                   // 45 degrees: 1 in x per 1 in z
  const x0 = o.x0 + inset, x1 = o.x1 - inset
  return x1 - x0 > 1e-6 ? [x0, x1] : null
}

/**
 * Split `lo..hi` into the fewest openings no longer than `maxLen`, separated by
 * ribs. Returns the openings, not the ribs.
 */
function spans(lo: number, hi: number, maxLen: number, rib: number): [number, number][] {
  const total = hi - lo
  if (total <= 0) return []
  const n = Math.max(1, Math.ceil((total + rib) / (maxLen + rib)))
  const len = (total - (n - 1) * rib) / n
  if (len <= 0.5) return []
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const a = lo + i * (len + rib)
    out.push([a, a + len])
  }
  return out
}

/**
 * The grid of holes cut out of one piece's shelf.
 *
 * Bounded by the frame on three edges and by the wider seam frame on the
 * fourth, so an opening can never reach the tabs, the lips or the wall.
 */
export function shelfOpenings(cfg: RackConfig, spec: PieceSpec): ShelfOpening[] {
  if (!cfg.skeletonShelf) return []
  const d = derive(cfg)
  const isLeft = spec.side === 'left'
  // The seam edge is the high side for a left piece and the low side for a right.
  const xLo = isLeft ? cfg.wallMm + cfg.shelfFrameMm : d.halfWidthMm + d.seamFrameMm
  const xHi = isLeft ? d.halfWidthMm - d.seamFrameMm : d.rackWidthMm - cfg.wallMm - cfg.shelfFrameMm
  const out: ShelfOpening[] = []
  for (const [x0, x1] of spans(xLo, xHi, cfg.shelfOpeningWidthMm, cfg.shelfRibMm)) {
    for (const [z0, z1] of spans(
      cfg.shelfFrameMm, d.rackDepthMm - cfg.shelfFrameMm, cfg.shelfOpeningDepthMm, cfg.shelfRibMm,
    )) {
      out.push({ x0, x1, z0, z1 })
    }
  }
  return out
}

/**
 * How far a piece reaches BEHIND the rack's back face, into the wall standoff.
 *
 * Only the caps do: the top one to make the hook, the bottom one to make the
 * pad that holds the rack parallel to the wall. Every middle course stops at
 * z=0 and stands off the wall, which is normal for a cleat.
 */
export const backReachMm = (cfg: RackConfig, spec: PieceSpec): number =>
  spec.kind === 'middle' ? 0 : cfg.cleatThicknessMm

/**
 * How far the bearing plane has dropped `u` behind the back face, QUANTISED to
 * the tread.
 *
 * Quantised rather than continuous so the hook and the strip agree even though
 * they are banded differently -- the strip carries extra breakpoints for the
 * screw counterbores, and evaluating a continuous plane at each part's own band
 * midpoints put their staircases a quarter-step out of register.
 */
export function cleatBevelDropAt(cfg: RackConfig, u: number): number {
  const clamped = Math.min(Math.max(u, 0), cfg.cleatThicknessMm)
  return Math.min(
    (Math.floor(clamped / cfg.cleatTreadMm + 1e-9) + 0.5) * cfg.cleatTreadMm,
    cfg.cleatThicknessMm,
  )
}

/**
 * Height of the front retaining lip at depth `z`: a symmetric 45 degree bump.
 *
 * A square lip appears all at once, which slices as 4.6 degrees and drew a tree
 * support from the bed 177 mm up. It cannot simply be ramped on one side: the
 * case sits BEHIND the lip and is pulled forward to come out, so the back face
 * is what retains and the front face is what you insert over. Ramping the back
 * alone would print but trade retention away; ramping the front alone is free
 * but fixes nothing, because material ending as the print rises never needed
 * holding up.
 *
 * Ramping both gives a bump that is self-supporting AND better at both jobs
 * than the square step was -- the case rides on and off it instead of catching.
 * Retention is still real: the case has to lift its full height against its own
 * weight, and `clearTopMm` leaves just enough room to do it deliberately.
 */
export function frontLipHeightAt(cfg: RackConfig, d: RackDerived, z: number): number {
  const from = d.rackDepthMm - cfg.frontLipDepthMm
  if (z <= from || z >= d.rackDepthMm) return 0
  const ramp = Math.min(z - from, d.rackDepthMm - z, cfg.frontLipHeightMm)
  // One layer of rise per layer of run is the 45 degrees; quantise so the two
  // flanks step identically however the bands happen to fall.
  return Math.floor(ramp / cfg.layerHeightMm + 1e-9) * cfg.layerHeightMm
}

/** Height of the bearing plane at depth `z`. Rises with z -- see RackConfig. */
export const bevelYAt = (cfg: RackConfig, z: number): number =>
  cfg.cleatBevelTopMm - cleatBevelDropAt(cfg, -z)

/** The piece's solid cross-section at depth `z`, already moved to x >= 0. */
export function crossSectionAt(cfg: RackConfig, spec: PieceSpec, z: number): MultiPolygon {
  const d = derive(cfg)
  const f = frameFor(cfg, spec)
  const isLeft = spec.side === 'left'
  const W = d.rackWidthMm
  const half = d.halfWidthMm
  const H = f.height

  const wallX0 = isLeft ? 0 : W - cfg.wallMm
  const wallX1 = isLeft ? cfg.wallMm : W
  const bossX0 = isLeft ? -cfg.bossOutMm : W - cfg.wallMm
  const bossX1 = isLeft ? cfg.wallMm : W + cfg.bossOutMm
  // A right piece stops fitMm short of the centreline so the joint has a glue
  // gap. The lips sit on the plate and have to start there too.
  const plateX0 = isLeft ? 0 : half + cfg.fitMm
  const plateX1 = isLeft ? half : W
  const cx = (bossX0 + bossX1) / 2
  const py0 = f.plateY0
  const py1 = py0 + cfg.shelfMm

  const parts: MultiPolygon[] = [
    multi(box(wallX0, 0, wallX1, H)),
    multi(box(bossX0, 0, bossX1, cfg.bossHeightMm)),
    multi(box(bossX0, H - cfg.bossHeightMm, bossX1, H)),
    multi(box(plateX0, py0, plateX1, py1)),
  ]
  if (f.hasTongue) {
    parts.push(multi(trapezoid(cx, H, H + cfg.railHeightMm, cfg.railNeckMm, cfg.railHeadMm)))
  }
  if (f.isFloor) {
    if (z < cfg.backLipDepthMm) {
      parts.push(multi(box(plateX0, py1, plateX1, py1 + cfg.backLipHeightMm)))
    }
    const h = frontLipHeightAt(cfg, d, z)
    if (h > 1e-9) parts.push(multi(box(plateX0, py1, plateX1, py1 + h)))
  }
  if (isLeft) parts.push([[seamVee(cfg, d, 'left', py0, py1)]])

  let region = union(...parts)

  // Behind the back face the piece becomes either the hook or the wall pad.
  if (z < 0) {
    const big = 1e4
    const keep: MultiPolygon = spec.kind === 'top'
      // Everything above the bearing plane. Its underside is the plane, so the
      // hook's underside rises with z and material only ever ends.
      ? [[[[-big, bevelYAt(cfg, z)], [big, bevelYAt(cfg, z)], [big, big], [-big, big]]]]
      : [[[[-big, -big], [big, -big], [big, cfg.spacerHeightMm], [-big, cfg.spacerHeightMm]]]]
    region = intersection(region, keep)
  }

  for (const o of shelfOpenings(cfg, spec)) {
    const span = openingSpanAt(o, z)
    if (span) region = difference(region, multi(box(span[0], py0 - 0.5, span[1], py1 + 0.5)))
  }

  if (f.hasSocket) {
    const f2 = cfg.fitMm * 2
    region = difference(region, multi(
      trapezoid(cx, 0, cfg.railHeightMm, cfg.railNeckMm + f2, cfg.railHeadMm + f2),
    ))
  }
  if (!isLeft) region = difference(region, [[seamVee(cfg, d, 'right', py0, py1)]])

  return shift(region, originShiftFor(cfg, spec))
}

/**
 * How far a piece is moved in x to sit at its own origin for export.
 *
 * Undo it to put two pieces back in the same rack frame, which is what the
 * interference and engagement tests do.
 */
export const originShiftFor = (cfg: RackConfig, spec: PieceSpec): number =>
  // A right piece's leftmost material is its seam face, which the glue gap
  // holds fitMm clear of the centreline -- not the centreline itself.
  spec.side === 'left' ? cfg.bossOutMm : -(derive(cfg).halfWidthMm + cfg.fitMm)

/** Every depth at which the cross-section changes, ascending and deduped. */
export function breakpoints(cfg: RackConfig, spec: PieceSpec): number[] {
  const d = derive(cfg)
  const back = -backReachMm(cfg, spec)
  const set = new Set<number>([back, 0, d.rackDepthMm])
  if (spec.kind === 'top') {
    const steps = Math.ceil(cfg.cleatThicknessMm / cfg.cleatTreadMm)
    for (let k = 0; k <= steps; k++) {
      set.add(Number(Math.max(back, -k * cfg.cleatTreadMm).toFixed(4)))
    }
  }
  const f = frameFor(cfg, spec)
  if (f.isFloor) {
    set.add(cfg.backLipDepthMm)
    const from = d.rackDepthMm - cfg.frontLipDepthMm
    const steps = Math.ceil(cfg.frontLipHeightMm / cfg.layerHeightMm)
    for (let k = 0; k <= steps; k++) {
      const off = k * cfg.layerHeightMm
      set.add(Number((from + off).toFixed(4)))
      set.add(Number((d.rackDepthMm - off).toFixed(4)))
    }
  }
  for (const o of shelfOpenings(cfg, spec)) {
    const steps = Math.ceil(gableHeight(o) / cfg.layerHeightMm)
    const zs = [o.z0, o.z1]
    for (let k = 0; k <= steps; k++) {
      zs.push(o.z1 - Math.min(k * cfg.layerHeightMm, gableHeight(o)))
    }
    for (const z of zs) {
      if (z > 1e-9 && z < d.rackDepthMm - 1e-9) set.add(Number(z.toFixed(4)))
    }
  }
  return [...set].sort((a, b) => a - b)
}

export function bandsFor(cfg: RackConfig, spec: PieceSpec): Band[] {
  const bps = breakpoints(cfg, spec)
  const out: Band[] = []
  for (let i = 0; i < bps.length - 1; i++) {
    const z0 = bps[i]!, z1 = bps[i + 1]!
    if (z1 - z0 < 1e-6) continue
    out.push({ z0, z1, region: crossSectionAt(cfg, spec, (z0 + z1) / 2) })
  }
  return out
}

/**
 * The two meshing rules from the tray pipeline, unchanged.
 *
 * Rule A: a horizontal face wherever the region changes, built as the
 * DIFFERENCE of the two bands that meet there -- never as a feature's own ring,
 * so its boundary is made of its neighbours' vertices and welds against their
 * walls. Rule B: walls per band. `insertTJunctions` over every region at once
 * first, `repairTJunctions` inside `finish()` last.
 */
export function buildPiece(cfg: RackConfig, spec: PieceSpec): Piece {
  const raw = bandsFor(cfg, spec)
  // Regions are evaluated at TRUE depth, which runs negative behind the back
  // face on the caps. Shift once here so every exported piece sits at z=0.
  const zOff = backReachMm(cfg, spec)
  const b = new MeshBuilder()
  if (!raw.length) return { spec, mesh: b.finish(), bands: [] }

  const rawUp: MultiPolygon[] = [[]]
  const rawDown: MultiPolygon[] = [[]]
  for (let i = 1; i < raw.length; i++) {
    rawUp.push(difference(raw[i - 1]!.region, raw[i]!.region))
    rawDown.push(difference(raw[i]!.region, raw[i - 1]!.region))
  }

  const n = raw.length
  const flat = insertTJunctions([...raw.map(x => x.region), ...rawUp, ...rawDown])
  const bands = raw.map((x, i) => ({ z0: x.z0 + zOff, z1: x.z1 + zOff, region: flat[i]! }))
  const floorsUp = flat.slice(n, 2 * n)
  const ceilingsDown = flat.slice(2 * n, 3 * n)

  b.addHorizontal(bands[0]!.region, bands[0]!.z0, 'down')
  for (let i = 1; i < bands.length; i++) {
    b.addHorizontal(floorsUp[i] ?? [], bands[i]!.z0, 'up')
    b.addHorizontal(ceilingsDown[i] ?? [], bands[i]!.z0, 'down')
  }
  b.addHorizontal(bands[n - 1]!.region, bands[n - 1]!.z1, 'up')
  for (const band of bands) b.addWalls(band.region, band.z0, band.z1)

  return { spec, mesh: b.finish(), bands }
}

/** Band areas times band lengths -- computed from the regions, not the mesh. */
export function bandVolume(bands: Band[]): number {
  let v = 0
  for (const band of bands) v += multiArea(band.region) * (band.z1 - band.z0)
  return v
}

/** Every piece a rack of `cfg.bays` bays needs, in assembly order. */
export function pieceList(cfg: RackConfig): PieceSpec[] {
  const out: PieceSpec[] = []
  const sides: Side[] = ['left', 'right']
  for (const side of sides) out.push({ kind: 'bottom', side })
  for (let i = 0; i < cfg.bays - 1; i++) {
    for (const side of sides) out.push({ kind: 'middle', side })
  }
  for (const side of sides) out.push({ kind: 'top', side })
  return out
}

export const pieceName = (spec: PieceSpec): string =>
  `${spec.kind}_${spec.side === 'left' ? 'L' : 'R'}`

export interface StackCourse { kind: PieceKind; baseY: number; height: number }
export interface BayOpening { floorTopY: number; ceilingY: number }
export interface StackLayout {
  courses: StackCourse[]
  bays: BayOpening[]
  totalHeightMm: number
}

/**
 * Where every course sits once stacked, and the clear opening each bay leaves.
 *
 * Heights add plainly because a tongue rises exactly as far above a piece's
 * nominal top as the socket above it is cut into its nominal bottom.
 */
export function stackLayout(cfg: RackConfig): StackLayout {
  const kinds: PieceKind[] = [
    'bottom', ...Array.from({ length: cfg.bays - 1 }, (): PieceKind => 'middle'), 'top',
  ]
  const courses: StackCourse[] = []
  let y = 0
  for (const kind of kinds) {
    const height = frameFor(cfg, { kind, side: 'left' }).height
    courses.push({ kind, baseY: y, height })
    y += height
  }
  const bays: BayOpening[] = []
  for (let i = 0; i < courses.length - 1; i++) {
    const below = courses[i]!, above = courses[i + 1]!
    bays.push({
      floorTopY: below.baseY + frameFor(cfg, { kind: below.kind, side: 'left' }).plateY0 + cfg.shelfMm,
      ceilingY: above.baseY + frameFor(cfg, { kind: above.kind, side: 'left' }).plateY0,
    })
  }
  return { courses, bays, totalHeightMm: y }
}

/* ---------------------------------------------------------------- the cleat */

export type CleatSide = 'left' | 'right'

/** Overall height of the wall strip, base to the bevel's high point. */
export const cleatHeightMm = (cfg: RackConfig): number =>
  cfg.cleatDropMm + cfg.cleatThicknessMm

/**
 * One half of the wall strip, in its own frame.
 *
 * Built along the THICKNESS: mesher-z runs 0 at the outer face to
 * `cleatThicknessMm` at the wall face, which is also how it prints. The strip
 * is tallest at the outer face and loses height 1:1 going back, so material
 * only ever ends -- no supports, and the screw holes come out vertical, which
 * is the one orientation that needs no teardrop.
 *
 * Its top in each band sits exactly `fitMm` below the hook's underside in the
 * matching band, because both are cut from the same staircase.
 */
export function buildCleat(cfg: RackConfig, side: CleatSide): Piece {
  const d = derive(cfg)
  const T = cfg.cleatThicknessMm
  const Hs = cleatHeightMm(cfg)
  const L = d.halfWidthMm
  // Everything must stay under the bevel at its LOWEST, which is at the wall
  // face. The peg first sat above it and poked through the back of the strip.
  const lowestTop = Hs - T - cfg.fitMm
  const screwY = cfg.cleatScrewHeadDiaMm / 2 + 6
  const pegY1 = lowestTop - 4
  const pegY0 = pegY1 - 8

  const bps = new Set<number>([0, T, Math.min(cfg.cleatScrewHeadDepthMm, T)])
  for (let u = 0; u <= T + 1e-9; u += cfg.cleatTreadMm) bps.add(Number(Math.min(u, T).toFixed(4)))
  const zs = [...bps].sort((a, b) => a - b)

  const raw: Band[] = []
  for (let i = 0; i < zs.length - 1; i++) {
    const z0 = zs[i]!, z1 = zs[i + 1]!
    if (z1 - z0 < 1e-6) continue
    const u = (z0 + z1) / 2
    const top = Hs - cleatBevelDropAt(cfg, u) - cfg.fitMm
    let region: MultiPolygon = [[box(0, 0, L, top)]]
    // The peg that stops the two halves mounting at different heights.
    if (side === 'left') {
      region = union(region, [[box(L, pegY0, L + cfg.cleatPegMm, pegY1)]])
    } else {
      region = difference(region, [[box(
        -1, pegY0 - cfg.fitMm, cfg.cleatPegMm + cfg.fitMm, pegY1 + cfg.fitMm,
      )]])
    }
    const dia = u < cfg.cleatScrewHeadDepthMm ? cfg.cleatScrewHeadDiaMm : cfg.cleatScrewDiaMm
    for (let k = 0; k < cfg.cleatScrewsPerHalf; k++) {
      const cx = L * ((k + 1) / (cfg.cleatScrewsPerHalf + 1))
      region = difference(region, [[circleRing(dia / 2, 32).map(([x, y]) => [x + cx, y + screwY])]])
    }
    raw.push({ z0, z1, region })
  }

  const b = new MeshBuilder()
  const rawUp: MultiPolygon[] = [[]], rawDown: MultiPolygon[] = [[]]
  for (let i = 1; i < raw.length; i++) {
    rawUp.push(difference(raw[i - 1]!.region, raw[i]!.region))
    rawDown.push(difference(raw[i]!.region, raw[i - 1]!.region))
  }
  const n = raw.length
  const flat = insertTJunctions([...raw.map(x => x.region), ...rawUp, ...rawDown])
  const bands = raw.map((x, i) => ({ ...x, region: flat[i]! }))
  b.addHorizontal(bands[0]!.region, bands[0]!.z0, 'down')
  for (let i = 1; i < bands.length; i++) {
    b.addHorizontal(flat.slice(n, 2 * n)[i] ?? [], bands[i]!.z0, 'up')
    b.addHorizontal(flat.slice(2 * n, 3 * n)[i] ?? [], bands[i]!.z0, 'down')
  }
  b.addHorizontal(bands[n - 1]!.region, bands[n - 1]!.z1, 'up')
  for (const band of bands) b.addWalls(band.region, band.z0, band.z1)

  return { spec: { kind: 'top', side }, mesh: b.finish(), bands }
}
