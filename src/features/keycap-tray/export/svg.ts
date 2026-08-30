// Kept as the tray's entry point into the shared Shaper writer so call sites and
// the parity tests do not have to know about CutDrawing.
import { writeShaperSvg as write } from '../../../export/shaperSvg.ts'
import type { Ring } from '../../../geometry/vec.ts'
import type { TrayDesign } from '../model/types.ts'
import { trayCutDrawing } from './cutDrawing.ts'

export { CUT_STYLE } from '../../../export/shaperSvg.ts'

export interface SvgOptions {
  /** Emit the guide-layer size labels. */
  labels?: boolean
  /** Glyph outlines per pocket id, already positioned in model space. */
  labelPaths?: Map<string, Ring[]>
}

export function writeShaperSvg(design: TrayDesign, opts: SvgOptions = {}): string {
  const labelPaths = opts.labels ? opts.labelPaths : undefined
  return write(trayCutDrawing(design, labelPaths ? { labelPaths } : {}))
}
