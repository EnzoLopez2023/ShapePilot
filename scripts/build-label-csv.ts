// Writes the filament label sheet from the command line.
//
//   node scripts/build-label-csv.ts [--line ID] [--brand B] [--keys K,K] [--qr MODE] [--out DIR]
//
// The Filaments page has a "Label sheet" button that exports exactly the rows
// it is showing, which is the way to get the labels for what you own. This is
// the same sheet for the cases a page cannot serve: the whole catalogue, a
// single line, or a scripted run -- and it also writes the CSV, which the page
// does not, since a browser download of one format is enough.
//
// The columns, the printing figures and the QR all live in
// src/features/filaments/model/labels.ts, so the two routes cannot drift.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  FILAMENT_CATALOG, FILAMENT_LINES, filamentLineById,
} from '../lib/contracts/bambuFilaments.ts'
import {
  labelSheet, linesWithoutSettings,
} from '../src/features/filaments/model/labels.ts'
import type { QrMode } from '../src/features/filaments/model/labels.ts'
import { writeCsv, writeXlsx } from '../src/export/xlsx.ts'

const argv = process.argv.slice(2)
const flag = (name: string): string | null => {
  const i = argv.indexOf(name)
  return i >= 0 ? (argv[i + 1] ?? null) : null
}

const qrMode = (flag('--qr') ?? 'profile') as QrMode
if (!['profile', 'key', 'none'].includes(qrMode)) {
  console.error('--qr wants profile, key or none')
  process.exit(1)
}
const lineFilter = flag('--line')
const brandFilter = flag('--brand')
const keyFilter = flag('--keys')?.split(',').map(k => k.trim()).filter(Boolean) ?? null

if (lineFilter && !filamentLineById(lineFilter)) {
  console.error(`No such line: ${lineFilter}. Known lines:`)
  for (const l of FILAMENT_LINES) console.error(`  ${l.brand}/${l.material}/${l.type}  (${l.label})`)
  process.exit(1)
}

let colors = [...FILAMENT_CATALOG]
if (lineFilter) colors = colors.filter(c => c.line === lineFilter)
if (brandFilter) colors = colors.filter(c => c.key.startsWith(`${brandFilter}/`))
if (keyFilter) {
  const missing = keyFilter.filter(k => !FILAMENT_CATALOG.some(c => c.key === k))
  if (missing.length) {
    console.error(`Not in the catalogue: ${missing.join(', ')}`)
    process.exit(1)
  }
  const wanted = new Set(keyFilter)
  colors = colors.filter(c => wanted.has(c.key))
}
if (!colors.length) {
  console.error('That selection matches no filament.')
  process.exit(1)
}

// Worth catching here rather than discovering on a printed sheet of 123.
const unset = linesWithoutSettings(colors)
if (unset.length) {
  console.error(`No speed/temperature for: ${unset.join(', ')} -- add them to PRINT_SETTINGS.`)
  process.exit(1)
}

const rows = labelSheet(colors, qrMode)
const outDir = resolve(flag('--out') ?? 'models/filament-swatch')
mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'filament-labels.csv'), writeCsv(rows), 'utf8')
writeFileSync(resolve(outDir, 'filament-labels.xlsx'), Buffer.from(writeXlsx(rows, 'Filaments')))

console.log(`Filament labels: ${colors.length} rows`)
for (const l of FILAMENT_LINES) {
  const n = colors.filter(c => c.line === `${l.brand}/${l.material}/${l.type}`).length
  if (n) console.log(`  ${l.label.padEnd(20)} ${n}`)
}
console.log(`  QR carries          ${
  qrMode === 'none' ? '(nothing)' : qrMode === 'key' ? 'the inventory key' : 'the profile page URL'}`)
console.log(`  written to          ${outDir}`)
