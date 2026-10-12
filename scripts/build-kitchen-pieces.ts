// Writes Shaper Origin SVGs for the coaster set and the trivet.
//
//   node scripts/build-kitchen-pieces.ts [--out DIR]
//
// The pieces are the Shaper Designer's own templates, exported through the
// same cut drawing the designer's SVG button uses -- so a file here is exactly
// what opening the template and pressing SVG would give.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { writeShaperSvg } from '../src/export/shaperSvg.ts'
import { sceneCutDrawing } from '../src/features/shaper-designer/cutDrawing.ts'
import { coasters, trivet } from '../src/features/shaper-designer/templates/kitchen.ts'

const argv = process.argv.slice(2)
const outIndex = argv.indexOf('--out')
const outDir = resolve(outIndex >= 0 ? argv[outIndex + 1] ?? '' : 'models/kitchen-pieces')

const pieces = [
  { file: 'coaster-set', doc: coasters() },
  { file: 'trivet', doc: trivet() },
]

mkdirSync(outDir, { recursive: true })
for (const { file, doc } of pieces) {
  const drawing = sceneCutDrawing(doc)
  writeFileSync(resolve(outDir, `${file}.svg`), writeShaperSvg(drawing))
  console.log(`${file}.svg  ${drawing.layers.map(l => `${l.polygons.length} ${l.cutType}`).join(', ')}`)
}

const readme = [
  'Kitchen pieces, for the Shaper Origin',
  '=====================================',
  '',
  'Regenerate with: node scripts/build-kitchen-pieces.ts',
  'Each SVG is 1:1 in millimetres and carries Shaper\'s cut types, so Origin',
  'reads it directly. Both also open from the Shaper Designer\'s Templates menu.',
  '',
  ...pieces.flatMap(({ file, doc }) => [
    `${file}.svg -- ${doc.name}`,
    ...(doc.notes ?? '').split('\n').map(n => `  ${n}`),
    '',
  ]),
  'Cut on Origin',
  '  Pockets (grey) carry their depth in the file. Through cuts -- the trivet\'s',
  '  slots and every profile -- go full thickness in passes with a 1/4 in spiral',
  '  bit, tabs on the last pass. Round over the edges afterwards.',
  '',
].join('\n')
writeFileSync(resolve(outDir, 'README.txt'), readme)
