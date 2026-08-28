// legacy-export — read an approved immutable Hearth backup and write a
// deterministic ShapePilot export bundle.
//
// The bundle never lands in the repository: `--out` must point outside it (the
// repo ignores artifacts/ and legacy-export/ so an accident is still caught).
//
// Usage:
//   node scripts/legacy-export.ts \
//     --backup /path/to/hearth.sqlite3 \
//     --evidence /path/to/source-evidence.json \
//     --out ./artifacts/legacy-export.json
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { exportLegacyBundle } from '../lib/legacy/exportLegacy.ts'
import { serializeCanonical, sha256 } from '../lib/legacy/canonical.ts'
import { bundleHash } from '../lib/legacy/manifest.ts'
import { fail, parseArgs, requireFlag } from './cli.ts'

const args = parseArgs(process.argv.slice(2))

try {
  const backupPath = resolve(requireFlag(args, 'backup'))
  const evidencePath = resolve(requireFlag(args, 'evidence'))
  const outPath = resolve(requireFlag(args, 'out'))

  const evidence = JSON.parse(await readFile(evidencePath, 'utf8')) as unknown
  const bundle = await exportLegacyBundle({
    backupPath,
    source: evidence,
    createdUtc: args.flags.get('created-utc'),
  })

  const serialized = serializeCanonical(bundle)
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, serialized)

  console.log(`wrote ${outPath}`)
  console.log(`bundleHash  ${bundleHash(bundle)}`)
  console.log(`fileSha256  ${sha256(serialized)}`)
  for (const table of bundle.tables) {
    console.log(`  ${table.name}: ${table.rowCount} rows, rowsHash ${table.rowsHash}`)
  }
  for (const sequence of bundle.sqliteSequence) {
    console.log(`  sqlite_sequence ${sequence.name} = ${sequence.seq}`)
  }
} catch (error) {
  fail(error)
}
