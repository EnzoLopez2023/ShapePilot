// Starting designs for the Shaper Designer. A template opens as a new, unsaved
// document; see sceneParts.ts for what it is made of.
import type { DesignDocument } from '../../../model/document.ts'
import type { CuttingBoard } from './cuttingBoards.ts'
import { IN, SHOP, cuttingBoards, fmtIn } from './cuttingBoards.ts'
import { monitorRiser } from './desk.ts'
import { cheeseBoard, coasters, servingBoard, trivet } from './kitchen.ts'
import { outline, part, templateDocument } from './sceneParts.ts'
import { cupHinge, dogHoleGrid, systainerInsert } from './shop.ts'

export type TemplateCategory = 'Kitchen' | 'Shop' | 'Desk'

export interface ShaperTemplate {
  id: string
  category: TemplateCategory
  name: string
  summary: string
  build: () => DesignDocument
}

/**
 * Profile, groove and handles as separate objects: Origin reads the cut from
 * each path, so grouped together the groove and handles would take the
 * profile's exterior cut and never be cut themselves.
 */
export function cuttingBoardDocument(board: CuttingBoard): DesignDocument {
  return templateDocument(board.name, [
    ...board.notes,
    `Juice groove: on-line cut for a ${fmtIn(SHOP.grooveBitIn * IN)} core box bit, `
      + `${fmtIn(SHOP.grooveDepthIn * IN)} deep -- set the depth on Origin.`,
  ], [
    outline('Board profile', board.profile, 'exterior'),
    outline('Juice groove', board.groove, 'online'),
    board.handles.length > 1
      ? part('Handles', board.handles, 'interior')
      : outline('Handle', board.handles[0]!, 'interior'),
  ])
}

export const SHAPER_TEMPLATES: ShaperTemplate[] = [
  ...cuttingBoards().map((board): ShaperTemplate => ({
    id: board.id,
    category: 'Kitchen',
    name: board.name,
    summary: board.summary,
    build: () => cuttingBoardDocument(board),
  })),
  {
    id: 'serving-board', category: 'Kitchen', name: 'Serving board',
    summary: '7 x 20 in paddle with a hang-hole handle', build: servingBoard,
  },
  {
    id: 'cheese-board', category: 'Kitchen', name: 'Round cheese board',
    summary: '12 in round with a juice groove', build: cheeseBoard,
  },
  {
    id: 'trivet', category: 'Kitchen', name: 'Trivet',
    summary: '8 x 8 in with five through slots', build: trivet,
  },
  {
    id: 'coasters', category: 'Kitchen', name: 'Coaster set',
    summary: 'Four 4 in coasters with cork pockets', build: coasters,
  },
  {
    id: 'dog-hole-grid', category: 'Shop', name: 'Dog-hole grid',
    summary: '20 mm holes on a 96 mm grid, 768 x 480 mm', build: dogHoleGrid,
  },
  {
    id: 'cup-hinge', category: 'Shop', name: '35 mm cup hinge bore',
    summary: 'Cup pocket with Blum 45/9.5 screw marks', build: cupHinge,
  },
  {
    id: 'systainer-insert', category: 'Shop', name: 'Systainer S76 insert',
    summary: 'Notched S76 outline with finger holes', build: systainerInsert,
  },
  {
    id: 'monitor-riser', category: 'Desk', name: 'Monitor riser / desk shelf',
    summary: '610 x 250 mm top on dadoed legs, cable notch', build: monitorRiser,
  },
]

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ['Kitchen', 'Shop', 'Desk']
