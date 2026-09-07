// Manufacturability checks for a switch tray. Nothing here is auto-corrected --
// the panel shows what applies and the user decides.
import type { Mesh } from '../../../geometry/mesh.ts'
import { checkManifold } from '../../../geometry/mesh.ts'
import type { MultiPolygon } from '../../../geometry/vec.ts'
import { multiArea } from '../../../geometry/vec.ts'
import { nameplateDepthMm, nameplateStyleOf } from './layers.ts'
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

/** A typical extrusion from a 0.4 mm nozzle. What one bead of plastic is. */
const EXTRUSION_MM = 0.42

/**
 * Where an inset groove stops being reliable.
 *
 * A groove wants two extrusions so first-layer squish cannot close it, which
 * would be 0.84 mm -- but `meanStrokeMm` averages the whole run, and the thin
 * parts of a letter (the waist of an S, the crossbar of an A) drag that below
 * what the stems actually measure. 1.8 extrusions is the same rule stated
 * against the estimator that is available, and it puts the boundary between an
 * 8 mm run, which comes out crisp, and a 6 mm one, which comes out soft.
 */
const INSET_STROKE_FLOOR_MM = 1.8 * EXTRUSION_MM

/**
 * Mean stroke width of a glyph run.
 *
 * For a stroke-like shape, area is roughly length x width and perimeter is
 * roughly twice the length, so twice the area over the perimeter is the width.
 * Crude for a single letter, good for a run of them -- and it is the number
 * that decides whether text survives the process, so it is worth measuring
 * rather than guessing from the point size.
 */
function meanStrokeMm(glyphs: MultiPolygon): number {
  let perimeter = 0
  for (const poly of glyphs) for (const ring of poly) {
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i]
      const [bx, by] = ring[(i + 1) % ring.length]
      perimeter += Math.hypot(bx - ax, by - ay)
    }
  }
  return perimeter > 0 ? (2 * multiArea(glyphs)) / perimeter : 0
}

export function checkNameplate(d: SwitchTrayDesign, glyphs: MultiPolygon | undefined): Issue[] {
  const np = d.nameplate
  if (!np || !glyphs?.length) return []
  const issues: Issue[] = []
  const style = nameplateStyleOf(d)
  const depth = nameplateDepthMm(d)
  const plateMm = d.plate.shelfMm + d.plate.recessMm

  if (style !== 'raised' && depth >= plateMm) {
    issues.push({
      code: 'nameplate-too-deep',
      severity: 'error',
      message: `A ${depth.toFixed(2)} mm cut goes through a ${plateMm.toFixed(2)} mm plate. `
        + `Three layers — 0.6 mm — is opaque for an inlay.`,
    })
  }

  const stroke = meanStrokeMm(glyphs)
  if (style === 'inset' && stroke < INSET_STROKE_FLOOR_MM) {
    issues.push({
      code: 'nameplate-stroke-thin',
      severity: 'warning',
      message: `${stroke.toFixed(2)} mm strokes are under two extrusions wide. An inset is read `
        + `by the shadow in its groove, and the first layer squishes a gap that narrow shut — `
        + `raise the text size, or switch to an inlay, which is read by colour instead.`,
    })
  } else if (style !== 'inset' && stroke < EXTRUSION_MM) {
    issues.push({
      code: 'nameplate-stroke-thin',
      severity: 'warning',
      message: `${stroke.toFixed(2)} mm strokes are narrower than a single extrusion, so the `
        + `slicer may drop parts of the text. Raise the text size.`,
    })
  }
  return issues
}

export function checkNameplatePlacement(
  d: SwitchTrayDesign, glyphs: MultiPolygon | undefined, solid: MultiPolygon | undefined,
): Issue[] {
  if (!d.nameplate || !glyphs?.length || solid === undefined) return []
  const wanted = multiArea(glyphs)
  const landed = multiArea(solid)
  if (wanted <= 0) return []
  const kept = landed / wanted
  if (kept < 0.02) {
    return [{
      code: 'nameplate-off-plate',
      severity: 'warning',
      message: 'The name is off the plate — nothing of it will be cut or printed. '
        + 'Drag it back onto the tray on the layout view.',
    }]
  }
  if (kept < 0.98) {
    return [{
      code: 'nameplate-clipped',
      severity: 'warning',
      message: `${Math.round((1 - kept) * 100)}% of the name hangs over a switch hole or the `
        + 'tray edge and will be cut away. Move it onto solid plate.',
    }]
  }
  return []
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
  /** The name's glyphs in tray coordinates, and the part of them on solid plate. */
  nameplateGlyphs?: MultiPolygon
  nameplateSolid?: MultiPolygon
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
    ...checkNameplate(d, opts.nameplateGlyphs),
    ...checkNameplatePlacement(d, opts.nameplateGlyphs, opts.nameplateSolid),
    ...(opts.mesh ? [...checkPlateFit(opts.mesh, fab), ...checkMesh(opts.mesh)] : []),
  ]
}
