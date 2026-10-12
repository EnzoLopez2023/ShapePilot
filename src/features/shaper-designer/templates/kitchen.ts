// Kitchen pieces in the cutting boards' family: a serving paddle, a round
// cheese board, a slotted trivet and a set of cork-lined coasters. Drawn in
// inches because that is how the stock is bought and the bits are sold.
import type { DesignDocument } from '../../../model/document.ts'
import type { Ring } from '../../../geometry/vec.ts'
import { IN, belt, circle, fmtIn, roundedRect, stadium } from './outline.ts'
import { outline, part, templateDocument } from './sceneParts.ts'
import { SHOP } from './cuttingBoards.ts'

const grooveNote = (): string =>
  `Juice groove: on-line cut for a ${fmtIn(SHOP.grooveBitIn * IN)} core box bit, `
  + `${fmtIn(SHOP.grooveDepthIn * IN)} deep -- set the depth on Origin.`

/** A long board with a handle off one end and a hang hole through it. The
 *  neck is two concave fillets, so the handle grows out of the board rather
 *  than being stuck on. */
export function servingBoard(): DesignDocument {
  const L = 20 * IN, bodyL = 15 * IN, W = 7 * IN
  const R = 1.5 * IN, rf = 1 * IN
  const hw = 0.875 * IN
  const cy = W / 2
  const profile = belt([
    { c: [R, R], r: R, turn: 1 },
    { c: [bodyL - R, R], r: R, turn: 1 },
    { c: [bodyL + rf, cy - hw - rf], r: rf, turn: -1 },
    { c: [L - hw, cy], r: hw, turn: 1 },
    { c: [bodyL + rf, cy + hw + rf], r: rf, turn: -1 },
    { c: [bodyL - R, W - R], r: R, turn: 1 },
    { c: [R, W - R], r: R, turn: 1 },
  ])
  return templateDocument('Serving board (7 x 20 in)', [
    'Body 7 x 15 in, handle 1-3/4 in wide and 5 in long, 20 in overall.',
    'Hang hole: 3/4 in, centred in the handle\'s rounded end.',
    'No juice groove: a serving board is for dry food. Round over every edge.',
  ], [
    outline('Board profile', profile, 'exterior'),
    outline('Hang hole', circle([L - hw, cy], 0.375 * IN), 'interior'),
  ])
}

export function cheeseBoard(): DesignDocument {
  const r = 6 * IN
  const inset = 0.75 * IN
  return templateDocument('Round cheese board (12 in)', [
    '12 in across. Juice groove 3/4 in in from the edge.',
    grooveNote(),
  ], [
    outline('Board profile', circle([0, 0], r), 'exterior'),
    outline('Juice groove', circle([0, 0], r - inset), 'online'),
  ])
}

/** Slots rather than holes: they read as a trivet, and they let heat out. */
export function trivet(): DesignDocument {
  const S = 8 * IN
  const count = 5, pitch = 1 * IN, slotR = 0.25 * IN, slotLen = 5.5 * IN
  const x0 = S / 2 - ((count - 1) * pitch) / 2
  const slots: Ring[] = Array.from({ length: count }, (_, i) => {
    const x = x0 + i * pitch
    return stadium([x, S / 2 - slotLen / 2 + slotR], [x, S / 2 + slotLen / 2 - slotR], slotR)
  })
  return templateDocument('Trivet (8 x 8 in)', [
    `8 x 8 in, 1 in corners. ${count} slots, 1/2 x 5-1/2 in, on 1 in centres.`,
    'Use hardwood at least 3/4 in thick, and leave it unfinished or oiled.',
  ], [
    outline('Trivet profile', roundedRect(0, 0, S, S, 1 * IN), 'exterior'),
    part('Slots', slots, 'interior'),
  ])
}

/** Four coasters off one blank, each with a pocket for a cork disc. */
export function coasters(): DesignDocument {
  const S = 4 * IN, gap = 0.75 * IN
  const corkR = 1.75 * IN, corkDepth = 0.125 * IN
  const origins: [number, number][] = [[0, 0], [S + gap, 0], [0, S + gap], [S + gap, S + gap]]
  return templateDocument('Coaster set (4 x 4 in)', [
    `Four 4 x 4 in coasters, 1/2 in corners, ${fmtIn(gap)} apart on one blank.`,
    `Pocket: ${fmtIn(corkR * 2)} round, ${fmtIn(corkDepth)} deep, for a cork disc of that size.`,
    'Cut the pockets first, while the blank is whole, then the profiles.',
  ], [
    part('Coasters', origins.map(([x, y]) => roundedRect(x, y, x + S, y + S, 0.5 * IN)), 'exterior'),
    part('Cork pockets', origins.map(([x, y]) => circle([x + S / 2, y + S / 2], corkR)), 'pocket', corkDepth),
  ])
}
