// recovery — backup, verify and restore.
//
// None of these run at startup or inside an HTTP request. They are operator
// commands, invoked explicitly, against the configured external artifact store.
//
// Usage:
//   node scripts/recovery.ts backup
//   node scripts/recovery.ts list
//   node scripts/recovery.ts verify --artifact <id>
//   node scripts/recovery.ts restore --artifact <id> --to /path/to/new.db
import { resolve } from 'node:path'
import { buildIdentity } from '../lib/lineage/buildIdentity.ts'
import { assertDirectory, createFilesystemArtifactStore } from '../lib/recovery/artifactStore.ts'
import { createBackup } from '../lib/recovery/backup.ts'
import { restoreBackup, verifyBackup } from '../lib/recovery/verify.ts'
import { loadConfig } from '../server/config.ts'
import { fail, parseArgs, requireFlag, UsageError } from './cli.ts'

const args = parseArgs(process.argv.slice(2))

try {
  const config = loadConfig()
  const identity = buildIdentity()

  const storeRoot = args.flags.get('store') ?? config.artifactStoreDir
  if (!storeRoot) {
    throw new UsageError(
      'SHAPEPILOT_ARTIFACT_STORE_DIR must be configured (or pass --store) so backups land '
      + 'on the external artifact destination rather than beside the database',
    )
  }
  await assertDirectory(resolve(storeRoot), 'artifact store root')
  const store = createFilesystemArtifactStore(resolve(storeRoot))

  switch (args.command) {
    case 'backup': {
      const result = await createBackup({
        sourcePath: args.flags.get('database') ?? config.database.path,
        store,
        appVersion: identity.version,
        buildId: identity.build,
        sourceCommit: identity.commit,
      })
      console.log(`artifact    ${result.artifactId}`)
      console.log(`store       ${store.description}`)
      console.log(`bytes       ${result.bytes}`)
      console.log(`sha256      ${result.sha256}`)
      console.log(`app         ${result.manifest.database.appMarker}`)
      console.log(`schema      ${result.manifest.database.schemaMarker}`)
      for (const entry of result.manifest.database.migrationLedger) {
        console.log(`  ${entry.ordinal} ${entry.id} (${entry.name}) ${entry.checksum}`)
      }
      for (const table of result.manifest.database.tables) {
        console.log(`  ${table.name}: ${table.rowCount} rows`)
      }
      break
    }

    case 'list': {
      const artifacts = await store.list('')
      if (!artifacts.length) console.log('no artifacts in the store')
      for (const artifact of artifacts) console.log(artifact)
      break
    }

    case 'verify': {
      const report = await verifyBackup({ store, artifactId: requireFlag(args, 'artifact') })
      console.log(`artifact    ${report.artifactId}`)
      console.log(`bytes       ${report.bytes}`)
      console.log(`sha256      ${report.sha256}`)
      console.log(`read-back   ${report.readBackIdentity.schemaMarker}`)
      console.log(`restored    ${report.restoredIdentity.schemaMarker}`)
      console.log(`quick_check ${report.checks.quickCheck.messages.join(', ')}`)
      console.log(`integrity   ${report.checks.integrityCheck.messages.join(', ')}`)
      console.log(`foreign key ${report.checks.foreignKeyCheck.ok ? 'ok' : 'VIOLATIONS'}`)
      for (const table of report.tables) {
        console.log(
          `  ${table.name}: manifest ${table.manifestRowCount} / restored ${table.restoredRowCount}`
          + `${table.ok ? '' : '  MISMATCH'}`)
      }
      for (const difference of report.differences) console.error(`DIFFERENCE ${difference}`)
      console.log(report.ok ? 'verify: ok' : 'verify: FAILED')
      if (!report.ok) process.exitCode = 2
      break
    }

    case 'restore': {
      const result = await restoreBackup({
        store,
        artifactId: requireFlag(args, 'artifact'),
        destinationPath: requireFlag(args, 'to'),
        activePath: config.database.path,
      })
      console.log(`restored    ${result.destinationPath}`)
      console.log(`bytes       ${result.bytes}`)
      console.log(`sha256      ${result.sha256}`)
      console.log(`app         ${result.identity.app}`)
      console.log(`schema      ${result.identity.schemaMarker}`)
      console.log('promote it manually once you have verified it; restore is forward-only')
      break
    }

    default:
      throw new UsageError('expected one of: backup, list, verify, restore')
  }
} catch (error) {
  fail(error)
}
