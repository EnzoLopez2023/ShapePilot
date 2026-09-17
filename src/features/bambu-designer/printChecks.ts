// Manufacturability checks for the printer. Advisory only: PRODUCT.md is
// explicit that nothing is silently corrected, so these produce messages and
// never touch the document.
import type { Mesh } from '../../geometry/mesh.ts'
import { checkManifold } from '../../geometry/mesh.ts'
import type { PrinterProfile, Triple } from '../../model/document.ts'
import {
  OVERHANG_DEGREES, TIPPY_RATIO, averageThicknessMm, surfaceReport, tippiness,
} from './surfaces.ts'

export type Severity = 'error' | 'warning'

/** A correction the page can offer beside the message. Never applied on its own. */
export type PrintFix = 'drop-to-plate'

export interface PrintIssue {
  severity: Severity
  message: string
  fix?: PrintFix
  /** Where in the model it is, when that can be pointed at. */
  at?: Triple
}

export function checkPrint(mesh: Mesh | null, machine: PrinterProfile): PrintIssue[] {
  const issues: PrintIssue[] = []
  if (!mesh || mesh.triangleCount === 0) return issues

  const [minX, minY, minZ, maxX, maxY, maxZ] = mesh.bbox
  const size: [number, number, number] = [maxX - minX, maxY - minY, maxZ - minZ]

  const fits = (envelope: readonly [number, number, number]) =>
    size[0] <= envelope[0] + 1e-6 && size[1] <= envelope[1] + 1e-6 && size[2] <= envelope[2] + 1e-6

  const dims = size.map(v => v.toFixed(1)).join(' × ')
  if (!fits(machine.buildMm)) {
    issues.push({
      severity: 'error',
      message: `At ${dims} mm the model does not fit the ${machine.buildMm.join(' × ')} mm build volume.`,
    })
  } else if (machine.dualNozzleBuildMm && !fits(machine.dualNozzleBuildMm)) {
    // Worth saying rather than hiding: the part prints, but only single-nozzle.
    issues.push({
      severity: 'warning',
      message: `At ${dims} mm this fits only with the main nozzle. Using both nozzles reduces the`
        + ` envelope to ${machine.dualNozzleBuildMm.join(' × ')} mm.`,
    })
  }

  if (minZ < -1e-4) {
    issues.push({
      severity: 'warning',
      message: `The model sits ${Math.abs(minZ).toFixed(1)} mm below the build plate; the slicer will drop it.`,
      fix: 'drop-to-plate',
    })
  }

  const smallest = Math.min(...size)
  if (smallest < machine.nozzleDiameterMm * 2) {
    issues.push({
      severity: 'warning',
      message: `The thinnest overall dimension is ${smallest.toFixed(2)} mm, under two`
        + ` ${machine.nozzleDiameterMm} mm extrusions. Features this fine may not print.`,
    })
  }

  const surfaces = surfaceReport(mesh)

  if (surfaces.overhangArea > 0) {
    issues.push({
      severity: 'warning',
      message: `About ${Math.round(surfaces.overhangArea)} mm² of the model faces downwards more`
        + ` steeply than ${OVERHANG_DEGREES}° without touching the plate. It will need supports,`
        + ' or turning over.',
      ...(surfaces.overhangAt ? { at: surfaces.overhangAt } : {}),
    })
  }

  // Averaged over the whole surface, so it is named as an average: a thin rib
  // on a thick body does not move it, and a distance field is what would find
  // that. Plate-like parts are exactly where the average is meaningful.
  const thickness = averageThicknessMm(surfaces)
  const twoWalls = machine.nozzleDiameterMm * 2
  if (thickness !== null && thickness < twoWalls) {
    issues.push({
      severity: 'warning',
      message: `Averaged over its surface the model is ${thickness.toFixed(2)} mm thick, under two`
        + ` ${machine.nozzleDiameterMm} mm walls. Thin areas may come out hollow or be skipped.`,
    })
  }

  if (surfaces.footprintArea === 0) {
    issues.push({
      severity: 'warning',
      message: 'Nothing in the model lies flat on the build plate, so it has very little to stick'
        + ' to. Rest a face on the plate, or expect supports.',
    })
  } else {
    const ratio = tippiness(size[2], surfaces.footprintArea)
    if (ratio !== null && ratio > TIPPY_RATIO) {
      issues.push({
        severity: 'warning',
        message: `At ${size[2].toFixed(0)} mm tall on a ${Math.round(surfaces.footprintArea)} mm²`
          + ' footprint this is tall and narrow; a brim will help it stay put.',
      })
    }
  }

  const report = checkManifold(mesh)
  if (!report.ok) {
    issues.push({
      severity: 'error',
      message: `The mesh is not watertight (${report.danglingEdges} unpaired edges), so a slicer`
        + ' may fill or skip parts of it.',
    })
  }
  if (report.volume <= 0) {
    issues.push({ severity: 'error', message: 'The model encloses no volume.' })
  }

  return issues
}

export const worstSeverity = (issues: readonly PrintIssue[]): Severity | null =>
  issues.some(i => i.severity === 'error') ? 'error' : issues.length ? 'warning' : null
