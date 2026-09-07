// Manufacturability checks for a switch tray. Nothing here is auto-corrected --
// the panel shows what applies and the user decides.
import type { Mesh } from '../../../geometry/mesh.ts'
import { checkManifold } from '../../../geometry/mesh.ts'
import {
  MIN_SHELF_MM, cellKeepoutMm, feetHeightMm, minPitchMm, wallAtPitchMm,
} from '../model/defaults.ts'
import { stackBudget } from '../model/stack.ts'
import type { SwitchTrayDesign } from '../model/types.ts'
import type { FillPlan } from './fill.ts'
import { feetWanted } from './feet.ts'

export type Severity = 'error' | 'warning'

export interface Issue {
  code: string
  severity: Severity
  message: string
}

/** Room a brim and the nozzle skirt want around the part. */
const PLATE_MARGIN_MM = 5

// Layer heights Bambu Studio ships presets for. A plate that is a whole number
// of layers at one of these comes out flat; otherwise its top face lands
// mid-layer and prints stepped.
const COMMON_LAYER_HEIGHTS_MM = [0.2, 0.16, 0.12, 0.28] as const

const wholeLayers = (thicknessMm: number): boolean =>
  COMMON_LAYER_HEIGHTS_MM.some(h => {
    const n = thicknessMm / h
    return Math.abs(n - Math.round(n)) < 0.02
  })

export interface SwitchTrayFabrication {
  plateWidthMm: number
  plateDepthMm: number
  minWallMm: number
}

export const DEFAULT_SWITCH_FABRICATION: SwitchTrayFabrication = {
  plateWidthMm: 256,
  plateDepthMm: 256,
  minWallMm: 1.2,
}

export function checkCells(
  d: SwitchTrayDesign, plan: FillPlan, fab: SwitchTrayFabrication,
): Issue[] {
  const issues: Issue[] = []
  if (!plan.fitted) {
    issues.push({
      code: 'no-cells',
      severity: 'error',
      message: 'No switch fits at this pitch and margin. Lower the pitch, or the margin, '
        + 'or pick a larger outline.',
    })
    return issues
  }

  const wallX = wallAtPitchMm(plan.pitchXMm, d.plate, d.switch)
  const wallY = wallAtPitchMm(plan.pitchYMm, d.plate, d.switch)
  const wall = Math.min(wallX, wallY)
  if (wall < fab.minWallMm - 1e-9) {
    issues.push({
      code: 'wall-too-thin',
      severity: 'error',
      message: `Only ${wall.toFixed(2)} mm of plate is left between neighbouring cells `
        + `(${cellKeepoutMm(d.plate, d.switch).toFixed(1)} mm cells at a `
        + `${Math.min(plan.pitchXMm, plan.pitchYMm).toFixed(2)} mm pitch). `
        + `Raise the pitch to at least ${minPitchMm(d.plate, d.switch).toFixed(1)} mm.`,
    })
  }

  const pitch = Math.min(plan.pitchXMm, plan.pitchYMm)
  if (pitch < d.switch.minPitchMm - 1e-9) {
    issues.push({
      code: 'pitch-below-datasheet',
      severity: 'warning',
      message: `${pitch.toFixed(2)} mm is closer than the ${d.switch.minPitchMm} mm minimum `
        + `spacing ${d.switch.label} is specified for. The housings will touch.`,
    })
  }
  return issues
}

export function checkPlate(d: SwitchTrayDesign): Issue[] {
  const issues: Issue[] = []
  const { retention, shelfMm, recessMm } = d.plate

  if (shelfMm < MIN_SHELF_MM - 1e-9) {
    issues.push({
      code: 'shelf-too-thin',
      severity: 'error',
      message: `A ${shelfMm.toFixed(2)} mm plate will flex under a full tray of switches. `
        + `Keep it at ${MIN_SHELF_MM} mm or more.`,
    })
  } else if (!wholeLayers(shelfMm)) {
    issues.push({
      code: 'shelf-not-whole-layers',
      severity: 'warning',
      message: `${shelfMm.toFixed(2)} mm is not a whole number of layers at 0.2, 0.16, 0.12 `
        + `or 0.28 mm, so the plate's face lands mid-layer.`,
    })
  }

  if (retention === 'clip') {
    const wanted = d.switch.clipPlateMm
    if (Math.abs(shelfMm - wanted) > 0.3) {
      issues.push({
        code: 'clip-plate-mismatch',
        severity: 'warning',
        message: `${d.switch.label} clips are designed for a ${wanted} mm plate; this one is `
          + `${shelfMm.toFixed(2)} mm, so they may not latch (or may never let go).`,
      })
    }
  }

  if (retention === 'shelf') {
    const ledge = (cellKeepoutMm(d.plate, d.switch) - (d.switch.bodyMm + d.plate.holeClearanceMm)) / 2
    if (ledge < 0.6) {
      issues.push({
        code: 'ledge-too-narrow',
        severity: 'warning',
        message: `The shelf the switch sits on is only ${ledge.toFixed(2)} mm wide. Raise the `
          + `recess clearance, or lower the hole clearance.`,
      })
    }
    if (recessMm >= d.switch.flangeToTopMm) {
      issues.push({
        code: 'recess-too-deep',
        severity: 'error',
        message: `A ${recessMm.toFixed(1)} mm recess swallows a switch that only stands `
          + `${d.switch.flangeToTopMm} mm proud. You will not get it back out.`,
      })
    }
  }
  return issues
}

export function checkFeet(d: SwitchTrayDesign, fittedFeet: number): Issue[] {
  const issues: Issue[] = []
  const feet = d.feet
  const height = feetHeightMm(feet)
  if (!feet || height <= 0) {
    issues.push({
      code: 'no-feet',
      severity: 'warning',
      message: `Without feet the switch pins carry the tray, and nothing can stack on it.`,
    })
    return issues
  }

  const budget = stackBudget(d)
  if (budget.feetTooShort) {
    // Each tier is judged against its own job. A bottom tray only has to lift
    // its own pins; calling it short for not clearing a switch it will never
    // sit under would be wrong.
    issues.push(budget.tier === 'bottom'
      ? {
        code: 'feet-too-short',
        severity: 'error',
        message: `${height.toFixed(1)} mm posts leave this tray's own switch pins touching the `
          + `case floor. The bottom of a stack needs ${budget.bottomTierFeetMm.toFixed(1)} mm.`,
      }
      : {
        code: 'feet-too-short',
        severity: 'error',
        message: `${height.toFixed(1)} mm posts are not enough to stack on: a tray above `
          + `would land its pins on these switches. It needs `
          + `${budget.requiredFeetMm.toFixed(1)} mm.`,
      })
  }

  const wanted = feetWanted(feet)
  if (fittedFeet < wanted) {
    issues.push({
      code: 'feet-fewer-than-asked',
      severity: 'warning',
      message: `Only ${fittedFeet} of ${wanted} posts found solid material to stand on — the `
        + `outline's notches take the rest. The tray will rock.`,
    })
  }
  return issues
}

export function checkPlateFit(mesh: Mesh, fab: SwitchTrayFabrication): Issue[] {
  const w = mesh.bbox[3] - mesh.bbox[0]
  const h = mesh.bbox[4] - mesh.bbox[1]
  const within = (mw: number, md: number) => w <= mw && h <= md
  if (!(within(fab.plateWidthMm, fab.plateDepthMm) || within(fab.plateDepthMm, fab.plateWidthMm))) {
    return [{
      code: 'exceeds-plate',
      severity: 'warning',
      message: `The tray is ${w.toFixed(1)} × ${h.toFixed(1)} mm, larger than the `
        + `${fab.plateWidthMm} × ${fab.plateDepthMm} mm plate. It will need splitting.`,
    }]
  }
  const snug = (mw: number, md: number) => w > mw - PLATE_MARGIN_MM || h > md - PLATE_MARGIN_MM
  if (snug(fab.plateWidthMm, fab.plateDepthMm) && snug(fab.plateDepthMm, fab.plateWidthMm)) {
    return [{
      code: 'plate-margin-tight',
      severity: 'warning',
      message: `The tray is ${w.toFixed(1)} × ${h.toFixed(1)} mm, within ${PLATE_MARGIN_MM} mm of `
        + `the plate edge. A brim or skirt will not fit.`,
    }]
  }
  return []
}

export function checkStack(d: SwitchTrayDesign): Issue[] {
  const b = stackBudget(d)
  if (b.clearHeightMm === null) return []
  if (b.tiers === 0) {
    return [{
      code: 'stack-overflows',
      severity: 'warning',
      message: `One tray is ${stackHeightLabel(b.nextTierHeightMm)} tall with its switches in, `
        + `more than the ${b.clearHeightMm} mm of clear height in the case.`,
    }]
  }
  return []
}

const stackHeightLabel = (mm: number | null): string =>
  mm === null ? 'unknown' : `${mm.toFixed(1)} mm`

export function checkMesh(mesh: Mesh): Issue[] {
  const report = checkManifold(mesh)
  if (report.ok) return []
  return [{
    code: 'mesh-not-manifold',
    severity: 'error',
    message: `The generated solid is not watertight (${report.danglingEdges} unpaired edges). `
      + `This is a bug — please report the settings that produced it.`,
  }]
}

export interface ValidateOptions {
  fabrication?: SwitchTrayFabrication
  fittedFeet: number
  mesh?: Mesh
}

export function validateDesign(
  d: SwitchTrayDesign, plan: FillPlan, opts: ValidateOptions,
): Issue[] {
  const fab = opts.fabrication ?? DEFAULT_SWITCH_FABRICATION
  return [
    ...checkCells(d, plan, fab),
    ...checkPlate(d),
    ...checkFeet(d, opts.fittedFeet),
    ...checkStack(d),
    ...(opts.mesh ? [...checkPlateFit(opts.mesh, fab), ...checkMesh(opts.mesh)] : []),
  ]
}
