// Writes a filament swatch card sized around a printed label.
//
//   node scripts/build-filament-swatch.ts [--label 50x30] [--steps 4] [--out DIR]
//
// Geometry and numbers live in src/swatch/; this is only the CLI around them,
// the same split as scripts/build-rack-stl.ts. The holders that these cards
// hang on read the card's slot through `cardHang()`, so there is exactly one
// definition of the interface between a card and anything that holds it.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkManifold } from '../src/geometry/mesh.ts'
import { writeBinaryStl } from '../src/export/stl.ts'
import { writeThreeMf } from '../src/export/threemf.ts'
import type { CardConfig } from '../src/swatch/card.ts'
import { CARD, checkConfig, derive, ladderSteps } from '../src/swatch/card.ts'
import { buildCard } from '../src/swatch/cardGeometry.ts'

/** PLA, for turning the volume into something comparable to a spool. */
const DENSITY_G_PER_CM3 = 1.24

const argv = process.argv.slice(2)
const flag = (name: string): string | null => {
  const i = argv.indexOf(name)
  return i >= 0 ? (argv[i + 1] ?? null) : null
}

const label = (flag('--label') ?? '50x30').toLowerCase().split('x').map(Number)
if (label.length !== 2 || label.some(v => !Number.isFinite(v) || v <= 0)) {
  console.error('--label wants WIDTHxHEIGHT in mm, e.g. 50x30')
  process.exit(1)
}
const stepCount = Number(flag('--steps') ?? CARD.ladderStepsMm.length)
if (!Number.isInteger(stepCount) || stepCount < 1 || stepCount > 12) {
  console.error('--steps wants a whole number of ladder windows, 1 to 12')
  process.exit(1)
}
const outDir = resolve(flag('--out') ?? 'models/filament-swatch')

const cfg: CardConfig = {
  ...CARD,
  labelWidthMm: label[0]!,
  labelHeightMm: label[1]!,
  ladderStepsMm: ladderSteps(stepCount),
}

const issues = checkConfig(cfg)
if (issues.length) {
  console.error('This swatch cannot be built:')
  for (const m of issues) console.error(`  - ${m}`)
  process.exit(1)
}

const d = derive(cfg)
const mesh = buildCard(cfg)
const report = checkManifold(mesh)
if (!report.ok) {
  console.error(`The swatch mesh is not closed: ${report.danglingEdges} dangling edges`)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
const stem = `swatch-${label[0]}x${label[1]}`
writeFileSync(resolve(outDir, `${stem}.stl`), Buffer.from(writeBinaryStl(mesh, 'ShapePilot filament swatch')))
writeFileSync(resolve(outDir, `${stem}.3mf`), Buffer.from(writeThreeMf(mesh, 'Filament swatch')))

const grams = (report.volume / 1000) * DENSITY_G_PER_CM3
console.log(`Filament swatch for a ${label[0]} x ${label[1]} mm label`)
console.log(`  card          ${d.cardWidthMm} x ${d.cardHeightMm} x ${cfg.cardThicknessMm} mm`)
console.log(`  border        ${cfg.borderMm} mm, ${d.slotZoneMm} mm on the slot edge`)
console.log(`  label pocket  ${d.pocketWidthMm} x ${d.pocketHeightMm} mm, ${cfg.labelDepthMm} mm deep`)
console.log(`  ladder        ${cfg.ladderWidthMm} x ${d.ladderHeightMm} mm, steps ${cfg.ladderStepsMm.join(' / ')} mm`)
console.log(`  mesh          ${mesh.triangleCount} triangles, ${grams.toFixed(2)} g in PLA`)
console.log(`  written to    ${outDir}`)
