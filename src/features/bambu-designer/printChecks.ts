// Manufacturability checks for the printer. Advisory only: PRODUCT.md is
// explicit that nothing is silently corrected, so these produce messages and
// never touch the document.
import type { Mesh } from '../../geometry/mesh.ts'
import { checkManifold } from '../../geometry/mesh.ts'
import type { PrinterProfile } from '../../model/document.ts'

export type Severity = 'error' | 'warning'

export interface PrintIssue {
  severity: Severity
  message: string
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
