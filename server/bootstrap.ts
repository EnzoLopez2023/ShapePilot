// Validated startup and graceful lifecycle.
//
// Startup does exactly: load config, take a pre-migration snapshot if this
// release is about to change the schema, open the database, apply the
// connection invariants, run pending migrations, build the app, listen. There
// is no integrity scan, no repair and no unbounded work anywhere on this path —
// those are explicit operator commands (see scripts/recovery.ts).
//
// The snapshot is the one exception to "no backup on the startup path", and it
// is a deliberate one. It runs only when the ledger is actually short, so it
// happens once per migration ever rather than once per start, and it is the
// only place a *pre*-migration copy can be taken: the migration applies inside
// `openDatabase` below, in this process, moments later. The alternative was a
// documented manual step, and docs/DEPLOYMENT.md records what that produced —
// four migrations shipped with no snapshot at all. See
// lib/recovery/preMigrationBackup.ts.
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { openDatabase } from '../lib/db/connection.ts'
import type { AppDatabase } from '../lib/db/connection.ts'
import { createRepositories } from '../lib/db/repositories/index.ts'
import { createFilesystemArtifactStore } from '../lib/recovery/artifactStore.ts'
import {
  describePreMigrationSnapshot, ensurePreMigrationSnapshot, snapshotRequiredFor,
} from '../lib/recovery/preMigrationBackup.ts'
import type { PreMigrationSnapshot } from '../lib/recovery/preMigrationBackup.ts'
import type { Lifecycle } from '../lib/health/readiness.ts'
import { assertProductionBuildIdentity, buildIdentity } from '../lib/lineage/buildIdentity.ts'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import type { AppConfig } from './config.ts'
import { validateProductionStorage } from './storage.ts'
import { ensureProductionEmptySeed } from './emptySeed.ts'

const DRAIN_TIMEOUT_MS = 45_000

/**
 * A durable record of the snapshot, in the trail an operator can query.
 *
 * Deliberately *not* on readiness: that probe is unauthenticated, and an
 * artifact id is a pointer at a copy of the whole database. The log line is for
 * the deploy transcript; this is for six months later.
 */
function recordSnapshot(
  repos: ReturnType<typeof createRepositories>,
  snapshot: PreMigrationSnapshot,
  buildId: string,
): void {
  if (snapshot.status !== 'taken') return
  void repos.audit.record({
    // No actor: this is the process acting on its own behalf at start-up, not a
    // person, and attributing it to one would be a lie in the trail.
    owner: null,
    category: 'deploy',
    action: 'pre_migration_snapshot',
    outcome: 'success',
    subject: snapshot.artifactId,
    detail: `${snapshot.pending.join(', ')} · ${snapshot.bytes} bytes · build ${buildId}`,
  }).catch(() => { /* the snapshot is already safe; the note is not worth a crash */ })
}

export interface RunningServer {
  server: Server
  config: AppConfig
  database: AppDatabase
  port: number
  close(): Promise<void>
}

export async function start(env: NodeJS.ProcessEnv = process.env): Promise<RunningServer> {
  const config = loadConfig(env)
  const identity = buildIdentity()
  if (config.nodeEnv === 'production') assertProductionBuildIdentity(identity)
  validateProductionStorage(config)
  ensureProductionEmptySeed(config, identity)

  // Before anything can migrate. In production a failure here stops the start,
  // which leaves the schema untouched, the previous image valid and automatic
  // rollback still available — the exact situation the snapshot protects.
  const snapshot = await ensurePreMigrationSnapshot({
    databasePath: config.database.path,
    openStore: config.artifactStoreDir
      ? () => createFilesystemArtifactStore(config.artifactStoreDir as string)
      : null,
    appVersion: identity.version,
    buildId: identity.build,
    sourceCommit: identity.commit,
    workRoot: config.recoveryWorkDir ?? undefined,
    required: snapshotRequiredFor(config.nodeEnv),
  })
  if (snapshot.status !== 'up-to-date') {
    console.log(`ShapePilot ${describePreMigrationSnapshot(snapshot)}`)
  }

  let lifecycle: Lifecycle = 'starting'
  const database = openDatabase(config.database)
  const repos = createRepositories(database)
  recordSnapshot(repos, snapshot, identity.build)

  const app = createApp({
    config,
    identity,
    repos,
    database: () => database,
    lifecycle: () => lifecycle,
    instanceId: randomUUID(),
  })

  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(config.port, () => resolve(listening))
    listening.once('error', reject)
  })

  lifecycle = 'ready'
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : config.port

  console.log(
    `ShapePilot ${identity.version} (build ${identity.build}) listening on :${port} `
    + `— database ${database.path}`,
  )
  if (config.auth.devBypass.enabled) {
    console.warn(
      'ShapePilot development auth bypass is ENABLED. '
      + 'This is refused when NODE_ENV=production.',
    )
  }

  const close = async (): Promise<void> => {
    lifecycle = 'draining'
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve()
      }
      const timeout = setTimeout(() => {
        server.closeAllConnections()
        finish()
      }, DRAIN_TIMEOUT_MS)
      timeout.unref()
      server.close(finish)
    })
    database.close()
    lifecycle = 'stopped'
  }

  return { server, config, database, port, close }
}

export function installSignalHandlers(running: RunningServer): void {
  let closing = false
  const shutdown = (signal: string) => {
    if (closing) return
    closing = true
    console.log(`Received ${signal}; draining.`)
    running.close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error('Shutdown failed:', error instanceof Error ? error.message : error)
        process.exit(1)
      })
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
