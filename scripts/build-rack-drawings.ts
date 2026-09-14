// Renders the rack drawing set to an HTML file.
//
//   node scripts/build-rack-drawings.ts [--out FILE]
//
// The sheets are generated from `src/rack/geometry.ts`, the same code that
// exports the STLs, so a change to config.ts shows up in both. Run it after
// changing anything in config.ts and republish the artifact.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { RACK, checkConfig } from '../src/rack/config.ts'
import { auditDrawings, buildDrawings } from '../src/rack/drawings.ts'

const argv = process.argv.slice(2)
const i = argv.indexOf('--out')
const out = resolve(i >= 0 ? (argv[i + 1] ?? '') : 'out/rack/drawings.html')

const issues = checkConfig(RACK)
if (issues.length) {
  console.error('This rack cannot be built:')
  for (const m of issues) console.error(`  - ${m}`)
  process.exit(1)
}

const html = buildDrawings(RACK)
const problems = auditDrawings(html)
for (const p of problems) console.error(`  figure ${p.figure}: ${p.kind} -- ${p.detail}`)
if (problems.length) {
  console.error(`\n${problems.length} drawing problem(s). Not written.`)
  process.exit(1)
}

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, html)
console.log(`${(html.length / 1024).toFixed(0)} KB, ${(html.match(/<svg /g) ?? []).length} figures, all clean`)
console.log(`  ${out}`)
