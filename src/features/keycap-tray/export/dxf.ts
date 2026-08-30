// Kept as the tray's entry point into the shared DXF writer. The reference file
// declares exactly four layers, so the tray pins that set rather than picking up
// the ONLINE layer the Shaper Designer adds.
import type { DxfLayer } from '../../../export/dxf.ts'
import { writeDxf as write } from '../../../export/dxf.ts'
import type { Ring } from '../../../geometry/vec.ts'
import type { TrayDesign } from '../model/types.ts'
import { trayCutDrawing } from './cutDrawing.ts'

export { DXF_LAYERS } from '../../../export/dxf.ts'
export type { DxfLayer } from '../../../export/dxf.ts'

const TRAY_LAYERS: readonly DxfLayer[] = ['PROFILE', 'POCKETS', 'THROUGH', 'LABELS']

export interface DxfOptions { labelRings?: Ring[] }

export function writeDxf(design: TrayDesign, opts: DxfOptions = {}): string {
  const drawing = trayCutDrawing(design)
  return write(
    { ...drawing, guideRings: opts.labelRings ?? [] },
    { declaredLayers: TRAY_LAYERS },
  )
}
