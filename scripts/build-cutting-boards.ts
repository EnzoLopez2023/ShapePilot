// Writes Shaper Origin SVGs for two cutting boards with juice grooves, after
// the Woodpeckers CBJG-SM (8 x 13 in, corner hang hole) and CBJG-LG
// (10.75 x 17.75 in, a slot handle at each end) templates. Origin cuts the
// board directly, so these are the boards themselves, not the acrylic jigs.
//
//   node scripts/build-cutting-boards.ts [--out DIR]
//
// The boards themselves live in src/features/shaper-designer/templates/, where
// the Shaper Designer opens them as templates; this is only the CLI around them.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CutDrawing } from '../src/export/cutLayers.ts'
import { writeShaperSvg } from '../src/export/shaperSvg.ts'
import {
  IN, R, SHOP, cuttingBoards, fmtIn, groove, wall,
} from '../src/features/shaper-designer/templates/cuttingBoards.ts'

// -- Output ------------------------------------------------------------------

const argv = process.argv.slice(2)
const outIndex = argv.indexOf('--out')
const outDir = resolve(outIndex >= 0 ? argv[outIndex + 1] ?? '' : 'models/cutting-boards')


mkdirSync(outDir, { recursive: true })
const boards = cuttingBoards()
for (const b of boards) {
  const drawing: CutDrawing = {
    name: b.name,
    layers: [
      // Profile first, as the keycap tray's proven file has it: its white fill
      // would otherwise paint over everything inside it.
      { id: 'board-profile', cutType: 'exterior', polygons: [[b.profile]] },
      { id: 'juice-groove', cutType: 'online', polygons: [[b.groove]] },
      { id: 'handles', cutType: 'interior', polygons: b.handles.map(h => [h]) },
    ],
    description: '1 unit = 1 mm, 1:1 scale. black = interior (handles) | '
      + 'grey line = on-line (juice groove) | white+outline = exterior (profile)',
  }
  writeFileSync(resolve(outDir, `${b.id}.svg`), writeShaperSvg(drawing))
  console.log(`${b.id}.svg  ${fmtIn(b.lengthMm)} x ${fmtIn(b.widthMm)}`)
}

const readme = [
  'Cutting boards with juice grooves, for the Shaper Origin',
  '========================================================',
  '',
  'Regenerate with: node scripts/build-cutting-boards.ts',
  'Each SVG is 1:1 in millimetres and carries Shaper\'s cut types, so Origin',
  'reads it directly. It also imports into ShapePilot\'s Shaper Designer.',
  '',
  ...boards.flatMap(b => [
    `${b.id}.svg -- ${b.name}`,
    `  Profile: ${fmtIn(b.lengthMm)} x ${fmtIn(b.widthMm)}, ${fmtIn(R)} corner radius.`,
    ...b.notes.map(n => `  ${n}`),
    '',
  ]),
  'Juice groove',
  `  On-line cut, centreline ${fmtIn(groove.inset)} from the edge, corners`,
  `  concentric with the board's. It bends in around each handle, keeping`,
  `  ${fmtIn(wall)} of wood between the groove's edge and the opening.`,
  `  Bit: ${fmtIn(SHOP.grooveBitIn * IN)} core box (round nose). Depth: ${fmtIn(SHOP.grooveDepthIn * IN)}.`,
  '  The SVG cannot carry an on-line depth -- set it on Origin. Take it in',
  '  two or three passes, and go slowly through the curves.',
  '',
  'Cut order on Origin',
  '  1. Juice groove (on-line), while the board is still full size and stiff.',
  '  2. Handles (interior), with a 1/4 in spiral bit, full thickness in passes.',
  '     Leave tabs or use tape so the slugs do not catch the bit.',
  '  3. Profile (exterior), same bit, in passes, tabs on the last pass.',
  '  Then round over the edges and handles with a 1/4 in roundover.',
  '',
  'Groove size, inset and handle wall live in SHOP at the top of the script.',
  '',
].join('\n')
writeFileSync(resolve(outDir, 'README.txt'), readme)
