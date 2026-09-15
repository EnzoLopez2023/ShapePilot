// Writes the STL set for a Systainer3 S76 modular rack.
//
//   node scripts/build-rack-stl.ts [--bays N] [--out DIR] [--coupon]
//
// Geometry lives in src/rack/; this is only the CLI around it. `--coupon`
// writes a shrunken pair that exercises both joints and nothing else -- print
// that first, confirm the fit, and only then commit to the full set, which is
// a couple of kilos of filament.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { RackConfig } from '../src/rack/config.ts'
import { checkConfig, derive, RACK } from '../src/rack/config.ts'
import { buildPiece, pieceList, pieceName, stackLayout } from '../src/rack/geometry.ts'
import { checkManifold } from '../src/geometry/mesh.ts'
import { writeBinaryStl } from '../src/export/stl.ts'
import { BAMBU_X2D } from '../src/model/machines.ts'

/** PLA, for turning a solid volume into something comparable to a spool. */
const DENSITY_G_PER_CM3 = 1.24

const argv = process.argv.slice(2)
const flag = (name: string): string | null => {
  const i = argv.indexOf(name)
  return i >= 0 ? (argv[i + 1] ?? null) : null
}
const coupon = argv.includes('--coupon')
const bays = Number(flag('--bays') ?? RACK.bays)
const outDir = resolve(flag('--out') ?? (coupon ? 'out/rack-coupon' : 'out/rack'))

// A coupon is the same joints on a piece small enough to print in minutes.
// Shelves stay solid: it exists to prove the fit of the tongue and the tab, and
// a shelf shrunk this far has no room between its own frames anyway.
const cfg: RackConfig = coupon
  ? {
      ...RACK, bays: 2, seamTabs: 1, skeletonShelf: false,
      caseWidthMm: 60, caseDepthMm: 40, caseHeightMm: 20,
    }
  : { ...RACK, bays }

const issues = checkConfig(cfg)
if (issues.length) {
  console.error('This rack cannot be built:')
  for (const m of issues) console.error(`  - ${m}`)
  process.exit(1)
}

const d = derive(cfg)
const wanted = coupon
  ? pieceList(cfg).filter(s => s.kind === 'middle')
  : pieceList(cfg)

// Every middle course is the same two parts, so one STL each and a quantity --
// writing ten files that differ in nothing would only invite mixing them up.
const quantity = new Map<string, number>()
for (const s of wanted) quantity.set(pieceName(s), (quantity.get(pieceName(s)) ?? 0) + 1)
const specs = wanted.filter((s, i) => wanted.findIndex(o => pieceName(o) === pieceName(s)) === i)

mkdirSync(outDir, { recursive: true })

let totalMm3 = 0
const rows: string[] = []
for (const spec of specs) {
  const piece = buildPiece(cfg, spec)
  const report = checkManifold(piece.mesh)
  if (!report.ok) {
    console.error(`${pieceName(spec)} is not watertight: ${report.danglingEdges} dangling edges`)
    process.exit(1)
  }
  const [x0, y0, z0, x1, y1, z1] = piece.mesh.bbox
  const size: [number, number, number] = [x1 - x0, y1 - y0, z1 - z0]
  const [bx, by, bz] = BAMBU_X2D.buildMm
  if (size[0] > bx || size[1] > by || size[2] > bz) {
    console.error(`${pieceName(spec)} does not fit the plate: ${size.map(v => v.toFixed(1)).join(' x ')}`)
    process.exit(1)
  }
  const name = `rack_${pieceName(spec)}.stl`
  writeFileSync(
    resolve(outDir, name),
    Buffer.from(writeBinaryStl(piece.mesh, `ShapePilot S76 rack ${pieceName(spec)}`)),
  )
  const qty = quantity.get(pieceName(spec)) ?? 1
  totalMm3 += report.volume * qty
  rows.push(
    `  ${name.padEnd(22)} x${String(qty).padEnd(3)} ` +
    `${size.map(v => v.toFixed(1).padStart(6)).join(' x ')} mm` +
    `  ${(report.volume * qty / 1000).toFixed(0).padStart(5)} cm3`,
  )
}

const counts = new Map<string, number>()
for (const s of wanted) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1)
const layout = stackLayout(cfg)

const readme = [
  `Systainer3 S76 modular rack -- ${cfg.bays} bay${cfg.bays === 1 ? '' : 's'}`,
  ...(coupon ? ['', '*** JOINT COUPON -- not a usable rack. ***'] : []),
  '',
  `Case          ${cfg.caseWidthMm} x ${cfg.caseDepthMm} x ${cfg.caseHeightMm} mm (feet included)`,
  `Rack          ${d.rackWidthMm.toFixed(1)} w x ${d.rackDepthMm.toFixed(0)} d x ${layout.totalHeightMm.toFixed(1)} h mm`,
  `Bay opening   ${d.bayClearMm.toFixed(1)} mm clear, ${d.pitchMm.toFixed(1)} mm pitch`,
  `Pieces        ${wanted.length} to print, ${specs.length} distinct ` +
    `(${[...counts].map(([k, n]) => `${n} ${k}`).join(', ')})`,
  '',
  'PRINT QUANTITIES',
  ...[...quantity].map(([n, q]) => `  rack_${n}.stl  x${q}`),
  `Material      ~${(totalMm3 / 1000).toFixed(0)} cm3 solid, roughly ` +
    `${(totalMm3 / 1000 * DENSITY_G_PER_CM3 / 1000).toFixed(2)} kg of PLA at 100% infill`,
  '',
  'PRINTING',
  '  Print every piece EXACTLY as exported -- standing on its back face, the',
  '  long axis vertical. That is not arbitrary: in this orientation every layer',
  '  is the same cross-section, so nothing overhangs and no supports are needed.',
  '  Laid flat the way the rack is used, a shelf would cantilever over air.',
  '  Use a brim. No supports.',
  '',
  'ASSEMBLY',
  '  1. Lay a course flat and DROP the two halves together. The flared tabs',
  '     through the shelf pass straight down into their slots.',
  '  2. SLIDE the finished course onto the stack from the FRONT. The dovetail',
  '     along the wall runs the full depth and takes the load in tension.',
  '  3. Repeat: bottom cap, then middles, then the top cap.',
  '  The halves are locked in the loaded directions and free only straight up,',
  '  which is how you take it apart again.',
  '',
  'FIT',
  `  Every mating feature carries ${cfg.fitMm} mm of clearance. If the coupon is`,
  '  tight or sloppy, change fitMm in src/rack/config.ts and re-run. Do that',
  '  BEFORE printing the full set.',
  '',
].join('\n')

writeFileSync(resolve(outDir, 'README.txt'), readme)

console.log(readme)
console.log('Wrote:')
for (const r of rows) console.log(r)
console.log(`\n  ${outDir}`)
