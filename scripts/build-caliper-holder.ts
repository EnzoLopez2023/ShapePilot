// Writes the Skadis holder for the Woodpeckers Big Cal.
//
//   node scripts/build-caliper-holder.ts [--body-thickness 13] [--beam-width 25.4]
//                                        [--beam-thickness 2] [--out DIR]
//
// Geometry lives in src/caliper/; this is only the CLI. The body and beam
// thicknesses were not measured, so they are flags: measure and rebuild.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkManifold } from '../src/geometry/mesh.ts'
import { writeBinaryStl } from '../src/export/stl.ts'
import { writeThreeMf } from '../src/export/threemf.ts'
import { CALIPER_HOLDER, buildCaliperHolder, checkConfig, derive } from '../src/caliper/holder.ts'

const argv = process.argv.slice(2)
const flag = (name: string): string | null => {
  const i = argv.indexOf(name)
  return i >= 0 ? (argv[i + 1] ?? null) : null
}
const num = (name: string, fallback: number): number => {
  const v = flag(name)
  if (v === null) return fallback
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) { console.error(`${name} wants a positive number`); process.exit(1) }
  return n
}

const cfg = {
  ...CALIPER_HOLDER,
  bodyThicknessMm: num('--body-thickness', CALIPER_HOLDER.bodyThicknessMm),
  beamWidthMm: num('--beam-width', CALIPER_HOLDER.beamWidthMm),
  beamThicknessMm: num('--beam-thickness', CALIPER_HOLDER.beamThicknessMm),
}
const issues = checkConfig(cfg)
if (issues.length) {
  console.error('The caliper holder cannot be built:')
  for (const m of issues) console.error(`  - ${m}`)
  process.exit(1)
}

const outDir = resolve(flag('--out') ?? 'models/caliper-holder')
const mesh = buildCaliperHolder(cfg)
const report = checkManifold(mesh)
if (!report.ok) {
  console.error(`mesh is not closed: ${report.danglingEdges} dangling edges`)
  process.exit(1)
}
const d = derive(cfg)
const grams = (report.volume / 1000) * 1.24
const [x0, y0, z0, x1, y1, z1] = mesh.bbox

mkdirSync(outDir, { recursive: true })
const name = 'caliper_holder_bigcal'
writeFileSync(resolve(outDir, `${name}.stl`), Buffer.from(writeBinaryStl(mesh, `ShapePilot ${name}`)))
writeFileSync(resolve(outDir, `${name}.3mf`), Buffer.from(writeThreeMf(mesh, name)))
writeFileSync(resolve(outDir, 'README.txt'), [
  'Woodpeckers Big Cal -- Skadis holder',
  '====================================',
  '',
  `${name}   ${(x1 - x0).toFixed(1)} x ${(y1 - y0).toFixed(1)} x ${(z1 - z0).toFixed(1)} mm   ${grams.toFixed(0)} g solid`,
  '',
  'The caliper hangs beam-down. Drop the beam through the slot from above; the',
  'flat lower edge of the body rests on top of the block. The slot is open at the',
  'bottom, so the beam hangs free below.',
  '',
  'Printing',
  '--------',
  '  Already oriented: the STL/3MF stands on the shelf face, so the shelf is the',
  '  first layer, the slot is a vertical hole and the prongs rise off the bed.',
  '  No supports. A 5 mm brim helps the 52 x 20 mm footprint. PETG.',
  '',
  'Hanging it',
  '----------',
  `  Two prongs, ${40} mm apart (two Skadis columns), the same prong the swatch bar uses.`,
  '  Put both in their slots, then drop the holder 5 mm. The caliper stands above',
  '  the holder, so leave room for ~110 mm of body above and ~110 mm of beam below.',
  '',
  'Assumed, not measured -- check these before printing',
  '----------------------------------------------------',
  `  beam width      ${cfg.beamWidthMm} mm  (slot ${d.slotWidthMm.toFixed(1)} mm)`,
  `  beam thickness  ${cfg.beamThicknessMm} mm  (slot ${d.slotDepthMm.toFixed(1)} mm)`,
  `  body thickness  ${cfg.bodyThicknessMm} mm  (the block carries up to ${cfg.blockDepthMm - 2} mm)`,
  '  The beam is assumed to sit mid-thickness in the body, so the slot is centred.',
  '  Rebuild with: npm run caliper:holder -- --body-thickness 12 --beam-thickness 1.6',
  '',
].join('\n'))

console.log(`${name}  ${(x1 - x0).toFixed(1)} x ${(y1 - y0).toFixed(1)} x ${(z1 - z0).toFixed(1)} mm  ${grams.toFixed(0)} g solid`)
console.log(`written to ${outDir}`)
