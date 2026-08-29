// Liveness and readiness.
//
// Liveness never touches the database. Readiness performs exactly one bounded
// cheap read plus a schema-identity comparison. No integrity scan, no backup,
// no repair, no table walk — those belong to the explicit recovery commands.
import type { AppDatabase } from '../db/connection.ts'
import { headMigrationId, readAppliedMigrations, schemaIdentity } from '../db/migrate.ts'
import type { BuildIdentity } from '../lineage/buildIdentity.ts'

export type Lifecycle = 'starting' | 'ready' | 'draining' | 'stopped'

export interface LivenessReport {
  status: 'ok'
  app: string
  lifecycle: Lifecycle
  uptimeSeconds: number
  pid: number
}

export interface ReadinessReport {
  status: 'ready' | 'not-ready'
  app: string
  lifecycle: Lifecycle
  build: { version: string; build: string; commit: string; builtAt: string }
  database: {
    authority: string
    reachable: boolean
    journalMode: string | null
    foreignKeys: boolean | null
    schemaIdentity: string | null
    expectedSchemaIdentity: string
    headMigration: string | null
    expectedHeadMigration: string
  }
  checkedAt: string
  durationMs: number
  reason?: string
}

export const liveness = (
  identity: BuildIdentity,
  lifecycle: Lifecycle,
  startedAtMs: number,
): LivenessReport => ({
  status: 'ok',
  app: identity.app,
  lifecycle,
  uptimeSeconds: Math.max(0, Math.round((Date.now() - startedAtMs) / 1000)),
  pid: process.pid,
})

export function readiness(
  identity: BuildIdentity,
  lifecycle: Lifecycle,
  database: AppDatabase | null,
): ReadinessReport {
  const startedAt = Date.now()
  const expectedSchemaIdentity = schemaIdentity()
  const expectedHeadMigration = headMigrationId()

  const base: ReadinessReport = {
    status: 'not-ready',
    app: identity.app,
    lifecycle,
    build: {
      version: identity.version,
      build: identity.build,
      commit: identity.commit,
      builtAt: identity.builtAt,
    },
    database: {
      authority: database?.path ?? 'unopened',
      reachable: false,
      journalMode: null,
      foreignKeys: null,
      schemaIdentity: null,
      expectedSchemaIdentity,
      headMigration: null,
      expectedHeadMigration,
    },
    checkedAt: new Date(startedAt).toISOString(),
    durationMs: 0,
  }

  if (!database) {
    return { ...base, durationMs: Date.now() - startedAt, reason: 'database not opened' }
  }

  try {
    // One trivially bounded read, plus the ledger. Nothing scales with data.
    database.handle.prepare('SELECT 1').get()
    const journalMode = String(database.handle.pragma('journal_mode', { simple: true }))
    const foreignKeys = database.handle.pragma('foreign_keys', { simple: true }) === 1
    const applied = readAppliedMigrations(database.handle)
    const head = applied.at(-1)?.id ?? null
    const identityMatches = database.schemaIdentity === expectedSchemaIdentity
      && head === expectedHeadMigration

    const report: ReadinessReport = {
      ...base,
      status: identityMatches && lifecycle === 'ready' ? 'ready' : 'not-ready',
      database: {
        ...base.database,
        reachable: true,
        journalMode,
        foreignKeys,
        schemaIdentity: database.schemaIdentity,
        headMigration: head,
      },
      durationMs: Date.now() - startedAt,
    }
    if (!identityMatches) return { ...report, reason: 'schema identity mismatch' }
    if (lifecycle !== 'ready') return { ...report, reason: `lifecycle is ${lifecycle}` }
    return report
  } catch {
    // The reason is deliberately generic: readiness is an unauthenticated probe.
    return { ...base, durationMs: Date.now() - startedAt, reason: 'database probe failed' }
  }
}
