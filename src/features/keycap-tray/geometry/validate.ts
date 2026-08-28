// Manufacturability checks, scoped per machine. A design can be perfectly valid
// for the printer and impossible on the CNC, so nothing here is global and
// nothing is auto-corrected -- the export dialog shows the warnings that apply
// to the format being written.
import type { FabricationSettings, Pocket, TrayDesign } from '../model/types.ts'
import type { Polygon } from './vec.ts'
import { bboxOverlaps, multiArea, ringBBox } from './vec.ts'
import { difference, intersection } from './boolean.ts'
import { pocketRing } from './shapes.ts'
import { buildRegions } from './layers.ts'
import { checkManifold } from './mesh.ts'
import type { Mesh } from './mesh.ts'

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
  const offenders = d.pockets.filter(p => (p.cornerRadiusMm ?? d.sizing.cornerRadius) < minR - 1e-9)
  if (!offenders.length) return []
  const r = offenders[0].cornerRadiusMm ?? d.sizing.cornerRadius
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
      if (!bboxOverlaps(a, b, fab.minWallMm)) continue
      // Overlapping is caught separately; this is the "too close but apart" case.
      if (bboxOverlaps(a, b, 0)) continue
      thin.push(rings[i].p.id, rings[j].p.id)
    }
  }
  if (!thin.length) return []
  const ids = [...new Set(thin)]
  return [{
    code: 'wall-too-thin',
    severity: 'warning',
    targets: ['cnc', 'print'],
    pocketIds: ids,
    message: `${ids.length} pockets sit closer than the ${fab.minWallMm} mm minimum wall. ` +
      `Thin walls tear out on the CNC and warp when printed.`,
  }]
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

export function checkPlate(_d: TrayDesign, fab: FabricationSettings, mesh: Mesh): Issue[] {
  const w = mesh.bbox[3] - mesh.bbox[0]
  const h = mesh.bbox[4] - mesh.bbox[1]
  const fits = (w <= fab.plateWidthMm && h <= fab.plateDepthMm) ||
    (h <= fab.plateWidthMm && w <= fab.plateDepthMm)
  if (fits) return []
  return [{
    code: 'exceeds-plate',
    severity: 'warning',
    targets: ['print'],
    message: `The tray is ${w.toFixed(1)} x ${h.toFixed(1)} mm, larger than the ` +
      `${fab.plateWidthMm} x ${fab.plateDepthMm} mm plate. Split it before printing.`,
  }]
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

export function validateDesign(d: TrayDesign, fab: FabricationSettings, mesh: Mesh): Issue[] {
  return [
    ...checkPlacement(d),
    ...checkCornerRadius(d, fab),
    ...checkWallThickness(d, fab),
    ...checkDepth(d, fab),
    ...checkPlate(d, fab, mesh),
    ...checkMesh(mesh),
  ]
}

export const issuesFor = (issues: Issue[], target: Target): Issue[] =>
  issues.filter(i => i.targets.includes(target))

export const describePocket = label
