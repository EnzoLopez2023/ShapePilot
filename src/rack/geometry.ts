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
import { difference, union } from '../geometry/boolean.ts'
import { insertTJunctions } from '../geometry/tjunction.ts'
import type { Mesh } from '../geometry/mesh.ts'
import { MeshBuilder } from '../geometry/mesh.ts'
import type { RackConfig, RackDerived } from './config.ts'
import { derive, seamTabCentres } from './config.ts'

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
export function tabSpanAt(
  cfg: RackConfig, d: RackDerived, z: number, inflate: number,
): [number, number] | null {
  const neck = cfg.seamTabRootMm / 2 + inflate
  const reach = cfg.seamTabReachMm + inflate
  const far = d.halfWidthMm + reach
  for (const zc of seamTabCentres(cfg, d)) {
    const dist = Math.abs(z - zc)
    if (dist > neck + reach) continue
    return [dist <= neck ? d.halfWidthMm : d.halfWidthMm + (dist - neck), far]
  }
  return null
}

/**
 * The seam edge of a half, as one open chain from z=0 to z=depth.
 *
 * It doubles back on itself at every tab, which is what an undercut looks like
 * drawn in plan.
 */
export function seamOutline(cfg: RackConfig, inflate: number): [number, number][] {
  const d = derive(cfg)
  const neck = cfg.seamTabRootMm / 2 + inflate
  const reach = cfg.seamTabReachMm + inflate
  const x = d.halfWidthMm, far = x + reach
  const pts: [number, number][] = [[x, 0]]
  for (const zc of seamTabCentres(cfg, d)) {
    pts.push([x, zc - neck], [far, zc - neck - reach], [far, zc + neck + reach], [x, zc + neck])
  }
  pts.push([x, d.rackDepthMm])
  return pts
}

export interface ShelfOpening { x0: number; x1: number; z0: number; z1: number }

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
  for (const [x0, x1] of spans(xLo, xHi, cfg.shelfOpeningMaxMm, cfg.shelfRibMm)) {
    for (const [z0, z1] of spans(
      cfg.shelfFrameMm, d.rackDepthMm - cfg.shelfFrameMm, cfg.shelfOpeningMaxMm, cfg.shelfRibMm,
    )) {
      out.push({ x0, x1, z0, z1 })
    }
  }
  return out
}

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
  const plateX0 = isLeft ? 0 : half
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
    if (z > d.rackDepthMm - cfg.frontLipDepthMm) {
      parts.push(multi(box(plateX0, py1, plateX1, py1 + cfg.frontLipHeightMm)))
    }
  }
  if (isLeft) {
    const span = tabSpanAt(cfg, d, z, 0)
    // Beyond the neck this box does not touch the plate. That island is the
    // undercut: it is what the other half cannot pull off over.
    if (span) parts.push(multi(box(span[0], py0, span[1], py1)))
  }

  let region = union(...parts)

  for (const o of shelfOpenings(cfg, spec)) {
    if (z <= o.z0 || z >= o.z1) continue
    region = difference(region, multi(box(o.x0, py0 - 0.5, o.x1, py1 + 0.5)))
  }

  if (f.hasSocket) {
    const f2 = cfg.fitMm * 2
    region = difference(region, multi(
      trapezoid(cx, 0, cfg.railHeightMm, cfg.railNeckMm + f2, cfg.railHeadMm + f2),
    ))
  }
  if (!isLeft) {
    const span = tabSpanAt(cfg, d, z, cfg.fitMm)
    if (span) {
      // Overshoot past the seam only where the cavity actually reaches it.
      // On the flank the near edge must stay put -- the material inboard of it
      // is the wedge that traps the tab's head.
      const x0 = span[0] <= half + 1e-9 ? half - 1 : span[0]
      region = difference(region, multi(box(x0, py0 - 1, span[1], py1 + 1)))
    }
  }

  return shift(region, originShiftFor(cfg, spec))
}

/**
 * How far a piece is moved in x to sit at its own origin for export.
 *
 * Undo it to put two pieces back in the same rack frame, which is what the
 * interference and engagement tests do.
 */
export const originShiftFor = (cfg: RackConfig, spec: PieceSpec): number =>
  spec.side === 'left' ? cfg.bossOutMm : -derive(cfg).halfWidthMm

/** Every depth at which the cross-section changes, ascending and deduped. */
export function breakpoints(cfg: RackConfig, spec: PieceSpec): number[] {
  const d = derive(cfg)
  const inflate = spec.side === 'left' ? 0 : cfg.fitMm
  const set = new Set<number>([0, d.rackDepthMm])
  const f = frameFor(cfg, spec)
  if (f.isFloor) {
    set.add(cfg.backLipDepthMm)
    set.add(d.rackDepthMm - cfg.frontLipDepthMm)
  }
  for (const o of shelfOpenings(cfg, spec)) {
    for (const z of [o.z0, o.z1]) {
      if (z > 1e-9 && z < d.rackDepthMm - 1e-9) set.add(Number(z.toFixed(4)))
    }
  }
  const half = cfg.seamTabRootMm / 2 + inflate
  const reach = cfg.seamTabReachMm + inflate
  const steps = Math.ceil(reach / cfg.seamStepMm)
  for (const zc of seamTabCentres(cfg, d)) {
    for (let k = 0; k <= steps; k++) {
      const off = half + Math.min(k * cfg.seamStepMm, reach)
      for (const z of [zc - off, zc + off]) {
        if (z > 1e-9 && z < d.rackDepthMm - 1e-9) set.add(Number(z.toFixed(4)))
      }
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
  const bands = raw.map((x, i) => ({ ...x, region: flat[i]! }))
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
