// Manufacturability checks, scoped per machine. A design can be perfectly valid
// for the printer and impossible on the CNC, so nothing here is global and
// nothing is auto-corrected -- the export dialog shows the warnings that apply
// to the format being written.
import type { FabricationSettings, Pocket, TrayDesign } from '../model/types.ts'
import type { Polygon, Ring, Vec2 } from '../../../geometry/vec.ts'
import { bboxOverlaps, multiArea, ringBBox } from '../../../geometry/vec.ts'
import { difference, intersection } from '../../../geometry/boolean.ts'
import { effectivePocketCornerRadius, pocketRing } from './shapes.ts'
import { buildRegions } from './layers.ts'
import { profileToMulti } from '../model/presets.ts'
import { checkManifold } from '../../../geometry/mesh.ts'
import type { Mesh } from '../../../geometry/mesh.ts'

export type Target = 'cnc' | 'print'
export type Severity = 'error' | 'warning'

export interface Issue {
  code: string
  severity: Severity
  message: string
  targets: Target[]
  pocketIds?: string[]
}

const label = (p: Pocket): string => p.label ?? `${p.units}u`

/** A router cannot cut an internal corner tighter than its own radius. */
export function checkCornerRadius(d: TrayDesign, fab: FabricationSettings): Issue[] {
  const minR = fab.toolDiameterMm / 2
  const offenders = d.pockets.filter(
    p => effectivePocketCornerRadius(p, d.sizing) < minR - 1e-9,
  )
  if (!offenders.length) return []
  const r = effectivePocketCornerRadius(offenders[0], d.sizing)
  return [{
    code: 'corner-radius-below-tool',
    severity: 'error',
    targets: ['cnc'],
    pocketIds: offenders.map(p => p.id),
    message: `${offenders.length} pocket${offenders.length > 1 ? 's have' : ' has'} a ${r} mm corner radius, ` +
      `below the ${minR.toFixed(3)} mm minimum for a ${fab.toolDiameterMm} mm bit. ` +
      `The cutter will leave a larger radius than drawn. Raise the radius or fit a smaller bit.`,
  }]
}

export function checkWallThickness(d: TrayDesign, fab: FabricationSettings): Issue[] {
  const rings = d.pockets.map(p => ({ p, poly: pocketRing(p, d.sizing) }))
  const thin: string[] = []
  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      const a = ringBBox(rings[i].poly[0]), b = ringBBox(rings[j].poly[0])
      // Broad phase: a rotated pocket's bbox is bigger than the shape, so bbox
      // proximity alone over-reports. Confirm with the exact edge distance.
      if (!bboxOverlaps(a, b, fab.minWallMm)) continue
      const dist = ringDistance(rings[i].poly[0], rings[j].poly[0])
      if (dist <= 1e-9) continue // touching / overlapping -- checkPlacement owns it
      if (dist < fab.minWallMm - 1e-9) thin.push(rings[i].p.id, rings[j].p.id)
    }
  }
  const issues: Issue[] = []
  if (thin.length) {
    const ids = [...new Set(thin)]
    issues.push({
      code: 'wall-too-thin',
      severity: 'warning',
      targets: ['cnc', 'print'],
      pocketIds: ids,
      message: `${ids.length} pockets sit closer than the ${fab.minWallMm} mm minimum wall. ` +
        `Thin walls tear out on the CNC and warp when printed.`,
    })
  }

  const profile = profileToMulti(d.profile)
  const boundaryIndex = buildBoundaryIndex(profile.flat())
  const rim = rings
    .filter(({ poly }) => boundaryWithin(poly[0], boundaryIndex, fab.minWallMm - 1e-9))
    .map(({ p }) => p.id)
  if (rim.length) {
    issues.push({
      code: 'rim-too-thin',
      severity: 'warning',
      targets: ['cnc', 'print'],
      pocketIds: rim,
      message: `${rim.length} pocket${rim.length === 1 ? ' is' : 's are'} closer than the ` +
        `${fab.minWallMm} mm minimum wall to the tray rim.`,
    })
  }
  return issues
}

const pointSegmentDistance = (point: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(point[0] - a[0], point[1] - a[1])
  const t = Math.max(0, Math.min(1,
    ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared))
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy))
}

const segmentDistance = (a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): number => {
  const cross = (u: Vec2, v: Vec2, w: Vec2) =>
    (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0])
  const aSide0 = cross(a0, a1, b0), aSide1 = cross(a0, a1, b1)
  const bSide0 = cross(b0, b1, a0), bSide1 = cross(b0, b1, a1)
  const rangesOverlap = Math.max(Math.min(a0[0], a1[0]), Math.min(b0[0], b1[0]))
    <= Math.min(Math.max(a0[0], a1[0]), Math.max(b0[0], b1[0])) + 1e-12
    && Math.max(Math.min(a0[1], a1[1]), Math.min(b0[1], b1[1]))
    <= Math.min(Math.max(a0[1], a1[1]), Math.max(b0[1], b1[1])) + 1e-12
  const intersects = rangesOverlap && aSide0 * aSide1 <= 0 && bSide0 * bSide1 <= 0
  if (intersects) return 0
  return Math.min(
    pointSegmentDistance(a0, b0, b1),
    pointSegmentDistance(a1, b0, b1),
    pointSegmentDistance(b0, a0, a1),
    pointSegmentDistance(b1, a0, a1),
  )
}

/** Minimum distance between two closed rings; 0 if they touch or cross. */
const ringDistance = (a: Ring, b: Ring): number => {
  let min = Infinity
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i], a1 = a[(i + 1) % a.length]
    for (let j = 0; j < b.length; j++) {
      const dd = segmentDistance(a0, a1, b[j], b[(j + 1) % b.length])
      if (dd < min) {
        min = dd
        if (min === 0) return 0
      }
    }
  }
  return min
}

interface BoundarySegment {
  a: Vec2
  b: Vec2
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface BoundaryNode {
  minX: number
  minY: number
  maxX: number
  maxY: number
  left?: BoundaryNode
  right?: BoundaryNode
  segments?: BoundarySegment[]
}

const segmentBounds = (a: Vec2, b: Vec2): BoundarySegment => ({
  a,
  b,
  minX: Math.min(a[0], b[0]),
  minY: Math.min(a[1], b[1]),
  maxX: Math.max(a[0], b[0]),
  maxY: Math.max(a[1], b[1]),
})

const buildBoundaryNode = (segments: BoundarySegment[]): BoundaryNode => {
  const minX = Math.min(...segments.map(segment => segment.minX))
  const minY = Math.min(...segments.map(segment => segment.minY))
  const maxX = Math.max(...segments.map(segment => segment.maxX))
  const maxY = Math.max(...segments.map(segment => segment.maxY))
  const node: BoundaryNode = { minX, minY, maxX, maxY }
  if (segments.length <= 16) {
    node.segments = segments
    return node
  }
  const axis = maxX - minX >= maxY - minY ? 'x' : 'y'
  segments.sort((a, b) => axis === 'x'
    ? (a.minX + a.maxX) - (b.minX + b.maxX)
    : (a.minY + a.maxY) - (b.minY + b.maxY))
  const middle = Math.floor(segments.length / 2)
  node.left = buildBoundaryNode(segments.slice(0, middle))
  node.right = buildBoundaryNode(segments.slice(middle))
  return node
}

const buildBoundaryIndex = (boundaries: Ring[]): BoundaryNode | undefined => {
  const segments = boundaries.flatMap(boundary =>
    boundary.map((point, index) =>
      segmentBounds(point, boundary[(index + 1) % boundary.length])))
  return segments.length ? buildBoundaryNode(segments) : undefined
}

const boxesOverlap = (
  a: Pick<BoundaryNode, 'minX' | 'minY' | 'maxX' | 'maxY'>,
  b: Pick<BoundaryNode, 'minX' | 'minY' | 'maxX' | 'maxY'>,
): boolean =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY

const boundaryWithin = (ring: Ring, root: BoundaryNode | undefined, limit: number): boolean => {
  if (!root || limit <= 0) return false
  for (let index = 0; index < ring.length; index++) {
    const a = ring[index]
    const b = ring[(index + 1) % ring.length]
    const bounds = segmentBounds(a, b)
    const query = {
      minX: bounds.minX - limit,
      minY: bounds.minY - limit,
      maxX: bounds.maxX + limit,
      maxY: bounds.maxY + limit,
    }
    const pending = [root]
    while (pending.length) {
      const node = pending.pop() as BoundaryNode
      if (!boxesOverlap(node, query)) continue
      if (node.segments) {
        for (const segment of node.segments) {
          if (boxesOverlap(segment, query)
            && segmentDistance(a, b, segment.a, segment.b) < limit) return true
        }
      } else {
        if (node.left) pending.push(node.left)
        if (node.right) pending.push(node.right)
      }
    }
  }
  return false
}

export function checkDepth(d: TrayDesign, fab: FabricationSettings): Issue[] {
  const issues: Issue[] = []
  const total = d.floorThicknessMm + d.pocketDepthMm
  if (d.pocketDepthMm >= fab.stockThicknessMm) {
    issues.push({
      code: 'depth-exceeds-stock',
      severity: 'error',
      targets: ['cnc'],
      message: `A ${d.pocketDepthMm} mm pocket cannot be cut in ${fab.stockThicknessMm} mm stock.`,
    })
  } else {
    const remaining = fab.stockThicknessMm - d.pocketDepthMm
    if (remaining < 3) {
      issues.push({
        code: 'thin-floor',
        severity: 'warning',
        targets: ['cnc'],
        message: `Only ${remaining.toFixed(1)} mm of stock remains below the pocket. ` +
          `Under 3 mm the floor flexes and can blow through.`,
      })
    }
  }
  if (total <= 0) {
    issues.push({ code: 'zero-height', severity: 'error', targets: ['print', 'cnc'], message: 'Tray has no height.' })
  }
  return issues
}

// Layer heights Bambu Studio ships presets for. A floor that is a whole number
// of layers at one of these prints a flat pocket floor; otherwise the top of
// the floor lands mid-layer and comes out stepped or smeared.
const COMMON_LAYER_HEIGHTS_MM = [0.2, 0.16, 0.12, 0.28] as const

const wholeLayers = (thicknessMm: number): boolean =>
  COMMON_LAYER_HEIGHTS_MM.some(h => {
    const n = thicknessMm / h
    return Math.abs(n - Math.round(n)) < 0.02
  })

export interface PrintCheckOptions {
  /**
   * Floor thinner than this is flagged. Defaults to 0.8 mm (four 0.2 mm layers);
   * the material picker raises it -- PETG wants 1.4, PLA Matte 1.0.
   */
  minFloorMm?: number
}

/**
 * FDM-only checks, scoped to `print`. The rest of this file grew up around the
 * CNC (bit radius, stock blow-through); these are the equivalents for a printed
 * tray -- floor stiffness and whole-layer floors so a keycap drops in against a
 * flat surface, not a stepped one.
 */
export function checkPrintability(d: TrayDesign, opts: PrintCheckOptions = {}): Issue[] {
  const issues: Issue[] = []
  const floor = d.floorThicknessMm
  const minFloor = opts.minFloorMm ?? 0.8

  if (floor > 0 && floor < minFloor) {
    issues.push({
      code: 'floor-too-thin-fdm',
      severity: 'warning',
      targets: ['print'],
      message: `A ${floor} mm floor is below the ${minFloor} mm this print wants -- it flexes under the ` +
        `caps and can split along a layer line. Thicken the floor or pick a stiffer material.`,
    })
  } else if (floor > 0 && !wholeLayers(floor)) {
    const lo = Math.floor(floor / 0.2) * 0.2
    issues.push({
      code: 'floor-not-whole-layers',
      severity: 'warning',
      targets: ['print'],
      message: `The ${floor} mm floor is ${(floor / 0.2).toFixed(1)} layers at 0.2 mm, so the pocket ` +
        `floor prints mid-layer and comes out rough. ${lo.toFixed(1)} or ${(lo + 0.2).toFixed(1)} mm sits on a layer.`,
    })
  }

  if (d.pocketDepthMm > 0 && d.pocketDepthMm < 1.2) {
    issues.push({
      code: 'pocket-too-shallow-fdm',
      severity: 'warning',
      targets: ['print'],
      message: `A ${d.pocketDepthMm} mm pocket is barely a few layers deep; caps won't be held and ` +
        `the walls print as a fragile lip.`,
    })
  }

  return issues
}

// Room a brim and the nozzle skirt want around the part.
const PLATE_MARGIN_MM = 5

export function checkPlate(_d: TrayDesign, fab: FabricationSettings, mesh: Mesh): Issue[] {
  const w = mesh.bbox[3] - mesh.bbox[0]
  const h = mesh.bbox[4] - mesh.bbox[1]
  const within = (mw: number, md: number) => w <= mw && h <= md
  const fits = within(fab.plateWidthMm, fab.plateDepthMm) || within(fab.plateDepthMm, fab.plateWidthMm)
  if (!fits) {
    return [{
      code: 'exceeds-plate',
      severity: 'warning',
      targets: ['print'],
      message: `The tray is ${w.toFixed(1)} x ${h.toFixed(1)} mm, larger than the ` +
        `${fab.plateWidthMm} x ${fab.plateDepthMm} mm plate. Split it before printing.`,
    }]
  }
  const snug = (mw: number, md: number) => w > mw - PLATE_MARGIN_MM || h > md - PLATE_MARGIN_MM
  const tight = snug(fab.plateWidthMm, fab.plateDepthMm) && snug(fab.plateDepthMm, fab.plateWidthMm)
  if (tight) {
    return [{
      code: 'plate-margin-tight',
      severity: 'warning',
      targets: ['print'],
      message: `The tray is ${w.toFixed(1)} x ${h.toFixed(1)} mm, within ${PLATE_MARGIN_MM} mm of the ` +
        `plate edge. A brim or skirt will not fit -- turn them off or trim the tray.`,
    }]
  }
  return []
}

export function checkPlacement(d: TrayDesign): Issue[] {
  const issues: Issue[] = []
  const { profile } = buildRegions(d)
  const entries = d.pockets.map(p => ({ p, poly: pocketRing(p, d.sizing) as Polygon }))

  const outside: string[] = []
  for (const { p, poly } of entries) {
    const spill = difference([poly], profile)
    if (multiArea(spill) > 1e-6) outside.push(p.id)
  }
  if (outside.length) {
    issues.push({
      code: 'pocket-outside-profile',
      severity: 'error',
      targets: ['cnc', 'print'],
      pocketIds: outside,
      message: `${outside.length} pocket${outside.length > 1 ? 's extend' : ' extends'} past the tray outline ` +
        `and will be cut off, leaving an open-sided cavity.`,
    })
  }

  const overlapping = new Set<string>()
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      // Broad phase only; a rotated pocket's bbox is loose but the exact
      // intersection below still decides. More candidates, same verdict.
      const a = ringBBox(entries[i].poly[0]), b = ringBBox(entries[j].poly[0])
      if (!bboxOverlaps(a, b)) continue
      if (multiArea(intersection([entries[i].poly], [entries[j].poly])) > 1e-6) {
        overlapping.add(entries[i].p.id)
        overlapping.add(entries[j].p.id)
      }
    }
  }
  if (overlapping.size) {
    issues.push({
      code: 'pockets-overlap',
      severity: 'warning',
      targets: ['cnc', 'print'],
      pocketIds: [...overlapping],
      message: `${overlapping.size} pockets overlap and will merge into one cavity.`,
    })
  }
  return issues
}

export function checkMesh(mesh: Mesh): Issue[] {
  const r = checkManifold(mesh)
  if (r.ok) return []
  return [{
    code: 'non-manifold',
    severity: 'error',
    targets: ['print'],
    message: `The generated mesh is not watertight (${r.danglingEdges} unpaired edges). ` +
      `Bambu Studio would silently repair it and distort the pockets. This is a bug -- please report it.`,
  }]
}

export function validateDesign(
  d: TrayDesign, fab: FabricationSettings, mesh: Mesh, print: PrintCheckOptions = {},
): Issue[] {
  return [
    ...checkPlacement(d),
    ...checkCornerRadius(d, fab),
    ...checkWallThickness(d, fab),
    ...checkDepth(d, fab),
    ...checkPrintability(d, print),
    ...checkPlate(d, fab, mesh),
    ...checkMesh(mesh),
  ]
}

export const issuesFor = (issues: Issue[], target: Target): Issue[] =>
  issues.filter(i => i.targets.includes(target))

export const describePocket = label
