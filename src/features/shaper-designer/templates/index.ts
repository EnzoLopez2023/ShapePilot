// Starting designs for the Shaper Designer. A template opens as a new, unsaved
// document made of ordinary path objects, so everything in it can be moved,
// re-typed or deleted like anything the user drew.
import type { CutType, DesignDocument, PathObject } from '../../../model/document.ts'
import type { Ring } from '../../../geometry/vec.ts'
import { IDENTITY_TRANSFORM, emptyDocument, newId } from '../../../model/scene.ts'
import type { CuttingBoard } from './cuttingBoards.ts'
import { IN, SHOP, cuttingBoards, fmtIn } from './cuttingBoards.ts'

export interface ShaperTemplate {
  id: string
  name: string
  summary: string
  build: () => DesignDocument
}

const path = (name: string, rings: Ring[], cut: CutType): PathObject => ({
  id: newId(),
  name,
  transform: IDENTITY_TRANSFORM,
  mode: 'solid',
  visible: true,
  locked: false,
  type: 'path',
  rings,
  thicknessMm: 19,
  cut: { type: cut },
})

/**
 * Three kinds of object, never grouped: a group resolves to one outline, and
 * Origin reads the cut from each path, so the groove and handles would take
 * the profile's exterior cut and never be cut themselves. Centred on the
 * origin so the board opens in the middle of the canvas.
 */
export function cuttingBoardDocument(board: CuttingBoard): DesignDocument {
  const cx = board.lengthMm / 2, cy = board.widthMm / 2
  const centre = (r: Ring): Ring => r.map(([x, y]) => [x - cx, y - cy] as const)
  const handles = board.handles.map((h, i) =>
    path(board.handles.length > 1 ? `Handle ${i + 1}` : 'Handle', [centre(h)], 'interior'))
  return {
    ...emptyDocument('shaper', board.name),
    notes: [
      ...board.notes,
      `Juice groove: on-line cut for a ${fmtIn(SHOP.grooveBitIn * IN)} core box bit, `
        + `${fmtIn(SHOP.grooveDepthIn * IN)} deep -- set the depth on Origin.`,
    ].join('\n'),
    objects: [
      path('Board profile', [centre(board.profile)], 'exterior'),
      path('Juice groove', [centre(board.groove)], 'online'),
      ...handles,
    ],
  }
}

export const SHAPER_TEMPLATES: ShaperTemplate[] = cuttingBoards().map(board => ({
  id: board.id,
  name: board.name,
  summary: board.summary,
  build: () => cuttingBoardDocument(board),
}))
