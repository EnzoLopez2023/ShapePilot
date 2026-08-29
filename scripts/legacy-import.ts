// legacy-import — dry run, then a hash-gated single-transaction apply.
//
// `--dry-run` is strictly read-only. It opens the target with better-sqlite3's
// `readonly` + `fileMustExist` and `query_only = ON`, so it cannot create a
// directory, a file or a database, cannot set a persistent pragma and cannot
// run a migration. An absent or incompatible target fails there, before
// anything touches the filesystem. Initializing an empty authority is a
// separate, explicit command (`npm run db:init`) or the server's own startup.
//
// `--apply` is the only mutating path.
//
// Usage:
//   node scripts/legacy-import.ts --dry-run \
//     --bundle ./artifacts/legacy-export.json \
//     --owner-tenant <guid> --owner-oid <guid> \
//     --report ./artifacts/import-report.json
//
//   node scripts/legacy-import.ts --apply \
//     --bundle ./artifacts/legacy-export.json \
//     --owner-tenant <guid> --owner-oid <guid> \
//     --report-hash <hash printed by the dry run>
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { openExistingCompatibleDatabase } from '../lib/db/connection.ts'
import { openReadOnlyDatabase } from '../lib/db/readonly.ts'
import { serializeCanonical } from '../lib/legacy/canonical.ts'
import { applyImport, planImport } from '../lib/legacy/importLegacy.ts'
import { loadConfig } from '../server/config.ts'
import { fail, parseArgs, requireFlag, UsageError } from './cli.ts'

const args = parseArgs(process.argv.slice(2))

try {
  const dryRun = args.booleans.has('dry-run')
  const apply = args.booleans.has('apply')
  if (dryRun === apply) throw new UsageError('pass exactly one of --dry-run or --apply')

  const bundlePath = resolve(requireFlag(args, 'bundle'))
  const owner = {
    tenantId: requireFlag(args, 'owner-tenant'),
    oid: requireFlag(args, 'owner-oid'),
  }
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8')) as unknown

  const config = loadConfig()
  const databasePath = args.flags.get('database')
    ? resolve(args.flags.get('database') as string)
    : config.database.path

  if (dryRun) {
    // Read-only from here down. Nothing below can create or modify the target.
    const target = openReadOnlyDatabase({
      path: databasePath,
      busyTimeoutMs: config.database.busyTimeoutMs,
    })
    try {
      const plan = planImport({ db: target.handle, bundle, owner })
      const serialized = serializeCanonical(plan.report)
      const reportPath = args.flags.get('report')
      if (reportPath) {
        // The only thing a dry run writes, and only when explicitly asked:
        // the operator's own report, outside the target database.
        const output = resolve(reportPath)
        await mkdir(dirname(output), { recursive: true })
        await writeFile(output, serialized)
        console.log(`wrote ${output}`)
      } else {
        process.stdout.write(serialized)
      }
      console.log(`target      ${target.path} (read-only)`)
      console.log(`schema      ${target.identity.headMigration} ${target.identity.schemaMarker}`)
      console.log(`reportHash  ${plan.reportHash}`)
      console.log(
        `totals      insert=${plan.report.totals.insert} `
        + `noop=${plan.report.totals.noop} reject=${plan.report.totals.reject}`,
      )
      for (const table of plan.report.tables) {
        for (const rejected of table.reject) {
          console.error(`REJECT ${table.name}#${rejected.id} ${rejected.code}: ${rejected.message}`)
        }
      }
      if (!plan.report.ok) process.exitCode = 2
    } finally {
      target.close()
    }
  } else {
    const database = openExistingCompatibleDatabase({
      path: databasePath,
      busyTimeoutMs: config.database.busyTimeoutMs,
    })
    try {
      const result = applyImport({
        db: database.handle,
        bundle,
        owner,
        expectedReportHash: requireFlag(args, 'report-hash'),
      })
      console.log(`applied     insert=${result.inserted} noop=${result.noop}`)
      console.log(`reportHash  ${result.reportHash}`)
      console.log(`runId       ${result.runId ?? 'none (idempotent replay)'}`)
    } finally {
      database.close()
    }
  }
} catch (error) {
  fail(error)
}
