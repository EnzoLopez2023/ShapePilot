// Shop jigs: a dog-hole grid, a 35 mm cup hinge bore and a Systainer S76
// insert. Metric, because every one of them is a metric standard.
import type { DesignDocument } from '../../../model/document.ts'
import type { Ring, Vec2 } from '../../../geometry/vec.ts'
import { difference, union } from '../../../geometry/boolean.ts'
import { getPreset } from '../../../model/trayProfile.ts'
import { circle, roundedRect } from './outline.ts'
import { outline, part, templateDocument } from './sceneParts.ts'

/** 20 mm holes on the 96 mm grid Festool's MFT tops and most bench dogs use. */
export const DOG_GRID = { holeMm: 20, pitchMm: 96, columns: 8, rows: 5 }

export function dogHoleGrid(): DesignDocument {
  const { holeMm, pitchMm, columns, rows } = DOG_GRID
  // Half a pitch of margin all round, so two panels butted together keep the grid.
  const W = columns * pitchMm, H = rows * pitchMm
  const holes: Ring[] = []
  for (let i = 0; i < columns; i++) {
    for (let j = 0; j < rows; j++) {
      holes.push(circle([pitchMm / 2 + i * pitchMm, pitchMm / 2 + j * pitchMm], holeMm / 2))
    }
  }
  return templateDocument(`Dog-hole grid (${columns} x ${rows}, 96 mm)`, [
    `${W} x ${H} mm panel, ${columns * rows} holes of ${holeMm} mm on a ${pitchMm} mm grid.`,
    'Half a pitch of margin all round, so panels butted together continue the grid.',
    'Cut one test hole in scrap first and check your dogs fit -- adjust the hole',
    'size in the inspector if they are loose or tight. Use 18 mm or thicker stock.',
  ], [
    outline('Panel profile', roundedRect(0, 0, W, H, 3), 'exterior'),
    part('Dog holes', holes, 'interior'),
  ])
}

/**
 * Blum's 35 mm cup with the 45/9.5 screw pattern: the screws sit 22.5 mm either
 * side of the cup, 9.5 mm further from the door edge than its centre.
 */
export const HINGE = { cupMm: 35, depthMm: 13, boringMm: 5, screwSpanMm: 45, screwOffsetMm: 9.5 }

export function cupHinge(): DesignDocument {
  const { cupMm, depthMm, boringMm, screwSpanMm, screwOffsetMm } = HINGE
  const cupY = boringMm + cupMm / 2
  const screws: Ring[] = [-1, 1].map(s =>
    circle([s * (screwSpanMm / 2), cupY + screwOffsetMm], 1.5))
  // The door edge is a line, but a guide is drawn from closed outlines, so it
  // is a sliver this thin -- on Origin it reads as one line.
  const edge: Ring = [[-60, 0], [60, 0], [60, 0.2], [-60, 0.2]]
  return templateDocument('35 mm cup hinge bore', [
    `Cup: ${cupMm} mm, ${depthMm} mm deep, ${boringMm} mm from the door edge to the cup's`,
    'edge (Blum allows 3 to 6 -- check your hinge). Screw marks on the 45/9.5 pattern.',
    'Line the door-edge guide up with the door\'s hinge edge. Duplicate the',
    'design for each hinge: typically 100 mm in from the top and bottom of the door.',
  ], [
    outline('Door edge', edge, 'guide'),
    outline('Hinge cup', circle([0, cupY], cupMm / 2), 'pocket', depthMm),
    part('Screw marks', screws, 'guide'),
  ])
}

/** Ø25 mm, 30 mm in from each short end: 17.5 mm clear of the notched outline. */
const FINGER_HOLE = { diameterMm: 25, inFromEndMm: 30 }
const POCKET_WALL_MM = 6

/**
 * The outline shrunk by `d` with round joins: the outline less a band of width
 * `d` along every edge. The mitred offset in geometry/offset.ts throws spikes
 * at the S76's small notch fillets, where neighbouring edges nearly reverse.
 */
function insetRound(ring: Ring, d: number): Ring {
  const band: Ring[] = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 1e-9) continue
    const nx = (-(b[1] - a[1]) / len) * d, ny = ((b[0] - a[0]) / len) * d
    band.push([[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]])
    band.push(circle(a, d))
  }
  const inner = difference([[ring]], union(...band.map(r => [[r]])))
  // The S76 has no waist narrow enough to split in two at 6 mm.
  if (inner.length !== 1) throw new Error(`the inset came out in ${inner.length} pieces`)
  return inner[0]![0]!
}

/**
 * A flat insert for the Systainer3 S76, on the same notched outline every tray
 * here uses -- the one confirmed in the physical case, already turned the right
 * way round by the preset.
 */
export function systainerInsert(): DesignDocument {
  const preset = getPreset('systainer-s76-notched')
  const ring = preset.ring
  const cy = preset.heightMm / 2
  const holes: Vec2[] = [
    [FINGER_HOLE.inFromEndMm, cy],
    [preset.widthMm - FINGER_HOLE.inFromEndMm, cy],
  ]
  const keepOut = insetRound(ring, POCKET_WALL_MM)
  return templateDocument('Systainer S76 insert', [
    `${preset.widthMm} x ${preset.heightMm.toFixed(1)} mm, the notched S76 outline confirmed in the case.`,
    'Two 25 mm finger holes lift it out. Keep pockets inside the guide line, which',
    `leaves a ${POCKET_WALL_MM} mm wall. The base cavity is 48 mm deep, so the sheet and`,
    'anything stacked on it must stay under that.',
  ], [
    outline('Insert profile', ring, 'exterior'),
    part('Finger holes', holes.map(c => circle(c, FINGER_HOLE.diameterMm / 2)), 'interior'),
    outline('Pocket keep-out', keepOut, 'guide'),
  ])
}
