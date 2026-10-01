// Writes the holders that filament swatch cards hang on.
//
//   node scripts/build-swatch-holder.ts [--back skadis|pad|all] [--columns 5]
//                                       [--slots 1] [--out DIR] [--coupon]
//
// Geometry lives in src/swatch/; this is only the CLI around it. `--coupon`
// writes the small parts that settle the two things no test can see -- how a
// prong really fits a Skadis slot, and how a blade really fits the slot in a
// card that has actually been printed. Print those first.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkManifold } from '../src/geometry/mesh.ts'
import { SKADIS } from '../src/geometry/skadis.ts'
import { writeBinaryStl } from '../src/export/stl.ts'
import { writeThreeMf } from '../src/export/threemf.ts'
import { BAMBU_X2D } from '../src/model/machines.ts'
import { CARD_50x30, cardHang } from '../src/swatch/card.ts'
import {
  HOLDER, checkConfig, derive, holderName, printNote,
} from '../src/swatch/holder.ts'
import type { HolderSpec } from '../src/swatch/holder.ts'
import { buildBladeLadder, buildHolder } from '../src/swatch/holderGeometry.ts'
import type { BladeVariant, Holder } from '../src/swatch/holderGeometry.ts'

/** PLA, to say what a set costs before it is printed. */
const DENSITY_G_PER_CM3 = 1.24

/**
 * The pairs the blade ladder asks about. A nominal 1.2 mm blade often prints
 * 1.3 and a nominal 2.0 mm slot often prints 1.9 -- that is 0.2 mm off a
 * 0.3 mm clearance, which is exactly the margin here. Left to right, thickest
 * blade and no lip first.
 */
const LADDER: BladeVariant[] = [
  { bladeThicknessMm: 1.6, bladeLipMm: 0.0 },
  { bladeThicknessMm: 1.4, bladeLipMm: 0.2 },
  { bladeThicknessMm: 1.2, bladeLipMm: 0.5 },
  { bladeThicknessMm: 1.0, bladeLipMm: 0.7 },
]

const argv = process.argv.slice(2)
const flag = (name: string): string | null => {
  const i = argv.indexOf(name)
  return i >= 0 ? (argv[i + 1] ?? null) : null
}
const coupon = argv.includes('--coupon')
const back = flag('--back') ?? 'all'
if (!['skadis', 'pad', 'all'].includes(back)) {
  console.error('--back wants skadis, pad or all')
  process.exit(1)
}
const columns = Number(flag('--columns') ?? 5)
const slots = Number(flag('--slots') ?? 1)
const outDir = resolve(flag('--out') ?? (coupon ? 'models/swatch-holder-coupon' : 'models/swatch-holder'))

const specs: HolderSpec[] = coupon
  ? [{ back: 'skadis', count: 1 }, { back: 'pad', count: 1 }]
  : [
      ...(back === 'pad' ? [] : [{ back: 'skadis' as const, count: columns }]),
      ...(back === 'skadis' ? [] : [{ back: 'pad' as const, count: slots }]),
    ]

const issues = specs.flatMap(spec =>
  checkConfig(HOLDER, spec).map(m => `${holderName(spec)}: ${m}`))
if (issues.length) {
  console.error('These holders cannot be built:')
  for (const m of issues) console.error(`  - ${m}`)
  process.exit(1)
}

const built: { name: string; holder: Holder; grams: number }[] = []
const add = (name: string, holder: Holder): void => {
  const report = checkManifold(holder.mesh)
  if (!report.ok) {
    console.error(`${name} is not closed: ${report.danglingEdges} dangling edges`)
    process.exit(1)
  }
  const [x0, y0, z0, x1, y1, z1] = holder.mesh.bbox
  const dims = [x1 - x0, y1 - y0, z1 - z0].sort((a, b) => b - a)
  const plate = [...BAMBU_X2D.buildMm].sort((a, b) => b - a)
  for (let i = 0; i < 3; i++) {
    if (dims[i]! > plate[i]!) {
      console.error(`${name} is ${dims.map(v => v.toFixed(1)).join(' x ')} mm and will not fit the plate`)
      process.exit(1)
    }
  }
  built.push({ name, holder, grams: (report.volume / 1000) * DENSITY_G_PER_CM3 })
}

for (const spec of specs) add(holderName(spec), buildHolder(HOLDER, spec))
if (coupon) add('coupon_blade_ladder', buildBladeLadder(HOLDER, LADDER))

mkdirSync(outDir, { recursive: true })
for (const { name, holder } of built) {
  writeFileSync(resolve(outDir, `${name}.stl`),
    Buffer.from(writeBinaryStl(holder.mesh, `ShapePilot ${name}`)))
  writeFileSync(resolve(outDir, `${name}.3mf`),
    Buffer.from(writeThreeMf(holder.mesh, name)))
}

const hang = cardHang(CARD_50x30)
const bar = derive(HOLDER, { back: 'skadis', count: columns })
const pad = derive(HOLDER, { back: 'pad', count: slots })

const readme = [
  coupon ? 'Swatch holder fit coupons' : 'Swatch card holders',
  '='.repeat(coupon ? 25 : 19),
  '',
  `For the ${hang.portraitWidthMm} x ${hang.portraitHeightMm} mm swatch card in`,
  'models/filament-swatch/. Cards hang PORTRAIT, like a luggage tag, from the',
  `${hang.slotWidthMm} x ${hang.slotLengthMm} mm slot already in them. Nothing you have`,
  'printed becomes obsolete.',
  '',
  'Transferring a card',
  '-------------------',
  'Present the card to the blade, push it back, let go. To take it off, lift it',
  `${bar.releaseLiftMm} mm until it clears the lip and pull it forward.`,
  '',
  'Every mount here carries an IDENTICAL blade, so that motion is the same on the',
  'bar by the shelf, on the AMS and on a dry box. That is the whole point: the',
  'card follows the spool.',
  '',
  'Printing',
  '--------',
  ...built.map(({ name, holder, grams }) => {
    const [x0, y0, z0, x1, y1, z1] = holder.mesh.bbox
    return `  ${name.padEnd(22)} ${(x1 - x0).toFixed(1)} x ${(y1 - y0).toFixed(1)} x `
      + `${(z1 - z0).toFixed(1)} mm   ${grams.toFixed(1)} g`
  }),
  '',
  `  Bar:  ${printNote({ back: 'skadis', count: columns })}`,
  '        It has features on BOTH faces -- blades forward, prongs back -- so',
  '        neither face can lie on the bed. Stood on its top edge, every lip',
  '        starts ON the bed and from there material only ever ends as the',
  '        print rises. The first layer is a long thin strip plus one island',
  '        per blade, so a brim is not optional.',
  `  Pad:  ${printNote({ back: 'pad', count: slots })}`,
  '',
  '  No supports on either. PETG, not PLA, for anything that goes on a dryer or',
  '  the AMS: a dryer runs 50-70 C and PLA starts creeping at 55.',
  '',
  'Hanging the bar',
  '---------------',
  `  ${columns} cards, one per Skadis column, ${bar.widthMm} mm wide.`,
  '  Put all the prongs in their slots, then DROP it 5 mm. The shank then rests',
  '  on the slot\'s lower edge and the catch is behind solid board.',
  '',
  `  For 10-15 cards print three bars and stack them ${bar.stackPitchMm} mm apart.`,
  `  That is two column-steps, so every bar's prongs land on a real slot, and a`,
  '  hanging card still clears the bar below it.',
  '',
  `  Cards sit ${bar.cardGapMm.toFixed(1)} mm apart. Do not try to overlap them: the`,
  '  thickness ladder is in the bottom 13 mm of a hanging card and it is the only',
  '  thing on the card that is not also printed on the label.',
  '',
  'Sticking the pad',
  '----------------',
  `  ${pad.widthMm} x ${pad.heightMm} mm, for 3M VHB or similar.`,
  '',
  '  FLAT FACES ONLY. A pad this wide needs a surface no rounder than about',
  `  ${Math.round(pad.minFlatRadiusMm)} mm radius before its edges lift further than the foam`,
  '  takes up. A dryer\'s flat side or a tub\'s lid is fine; the wall of a round',
  '  tub is not, and the tape will creep off over weeks rather than fail at once.',
  '',
  '  Sunlu and Eibos boxes and most food tubs are polypropylene or polyethylene.',
  '  VHB does not bond to those without 3M Primer 94 -- this is the most likely',
  '  reason a mount falls off. Clean with IPA, press hard for 15 seconds, and',
  '  leave it 72 hours before trusting it.',
  '',
  '  For the AMS: print singles and place them one at a time. There is no',
  '  published AMS 2 Pro tray pitch in this repo, and a card hanging off the',
  '  front may foul the lid -- measure yours before committing to a row.',
  '',
  ...(coupon ? [
    'What the coupons settle',
    '-----------------------',
    `  swatch_bar_1col   One prong and one blade. Does it hang on your board?`,
    `                    Board thickness is assumed to be ${HOLDER.boardThicknessMm} mm and has`,
    '                    never been measured here. Too thick and the bar rocks,',
    '                    too thin and the catch will not clear.',
    '',
    '  coupon_blade_ladder  Four blades, left to right:',
    ...LADDER.map((v, i) =>
      `                    ${i + 1}. ${v.bladeThicknessMm.toFixed(1)} mm blade, `
      + `${v.bladeLipMm.toFixed(1)} mm lip`),
    '                    Hang a real card on each. Keep the one that engages',
    '                    positively and still releases one-handed. A nominal',
    '                    1.2 mm blade often prints 1.3 and a nominal 2.0 mm slot',
    '                    often prints 1.9 -- that is 0.2 mm off a 0.3 mm',
    '                    clearance, and no test can see it.',
    '',
    '  swatch_pad_1up    Offer it to each box. Does it sit flat, or rock?',
    '                    No tape needed to find out.',
    '',
  ] : []),
  'Regenerate with: npm run swatch:holder' + (coupon ? ' -- --coupon' : ''),
  '',
].join('\n')

writeFileSync(resolve(outDir, 'README.txt'), readme)

console.log(coupon ? 'Swatch holder coupons' : 'Swatch card holders')
for (const { name, holder, grams } of built) {
  const [x0, y0, z0, x1, y1, z1] = holder.mesh.bbox
  console.log(
    `  ${name.padEnd(22)} ${(x1 - x0).toFixed(1).padStart(6)} x `
    + `${(y1 - y0).toFixed(1).padStart(5)} x ${(z1 - z0).toFixed(1).padStart(5)} mm`
    + `  ${grams.toFixed(1).padStart(5)} g`,
  )
}
console.log(`  blade            ${HOLDER.bladeThicknessMm} mm thick, ${HOLDER.bladeLengthMm} mm long, `
  + `${HOLDER.bladeLipMm} mm lip -- ${(HOLDER.bladeThicknessMm + HOLDER.bladeLipMm + HOLDER.fitMm)} mm `
  + `of the card's ${hang.slotWidthMm} mm slot`)
console.log(`  skadis           ${SKADIS.slotWidthMm} x ${SKADIS.slotHeightMm} mm slots on a `
  + `${SKADIS.columnPitchMm} mm pitch, board assumed ${HOLDER.boardThicknessMm} mm`)
console.log(`  written to       ${outDir}`)
