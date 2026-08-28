// reconcile — independently prove the ShapePilot target matches the legacy
// source bundle. Exits non-zero on any unexplained difference.
//
// Read-only, like the dry run: the target is opened `readonly` with
// `query_only = ON`, so a reconciliation can never create, migrate or modify
// the authority it is reporting on.
//
// Usage:
//   node scripts/reconcile.ts \
//     --bundle ./artifacts/legacy-export.json \
//     --owner-tenant <guid> --owner-oid <guid> \
//     --report ./artifacts/reconcile-report.json
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { openReadOnlyDatabase } from '../lib/db/readonly.ts'
import { serializeCanonical } from '../lib/legacy/canonical.ts'
import { reconcile } from '../lib/legacy/reconcile.ts'
import { loadConfig } from '../server/config.ts'
import { fail, parseArgs, requireFlag } from './cli.ts'

const args = parseArgs(process.argv.slice(2))

try {
  const bundlePath = resolve(requireFlag(args, 'bundle'))
  const owner = {
    tenantId: requireFlag(args, 'owner-tenant'),
    oid: requireFlag(args, 'owner-oid'),
  }
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8')) as unknown

  const config = loadConfig()
  const database = openReadOnlyDatabase({
    path: args.flags.get('database')
      ? resolve(args.flags.get('database') as string)
      : config.database.path,
    busyTimeoutMs: config.database.busyTimeoutMs,
  })

  try {
    const report = reconcile({ db: database.handle, bundle, owner })
    const serialized = serializeCanonical(report)
    const reportPath = args.flags.get('report')
    if (reportPath) {
      const target = resolve(reportPath)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, serialized)
      console.log(`wrote ${target}`)
    } else {
      process.stdout.write(serialized)
    }

    for (const table of report.tables) {
      console.log(
        `${table.name}: source ${table.sourceRowCount} / target ${table.targetRowCount} `
        + `${table.ok ? 'OK' : 'DIFFERENT'}`,
      )
    }
    for (const difference of report.differences) {
      console.error(`DIFFERENCE ${difference.table}.${difference.check}: ${difference.detail}`)
    }
    console.log(report.ok ? 'reconciliation: zero unexplained differences' : 'reconciliation: FAILED')
    if (!report.ok) process.exitCode = 2
  } finally {
    database.close()
  }
} catch (error) {
  fail(error)
}
