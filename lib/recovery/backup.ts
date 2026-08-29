// Online backup.
//
// Uses SQLite's backup API through better-sqlite3, never a byte-copy of a live
// database file. The snapshot is inspected offline — quick_check,
// integrity_check and foreign_key_check run against the *copy*, never against
// the live authority, and never on a startup or request path.
import { createHash } from 'node:crypto'
import { closeSync, createReadStream, fstatSync, openSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import type DatabaseConstructor from 'better-sqlite3'
import { codeIdentity } from '../db/migrate.ts'
import {
  assertIdentityMatches, readAuthorityId, readDatabaseIdentity,
} from '../db/identity.ts'
import { verifyNativeFileIdentity } from '../db/nativeIdentity.ts'
import type { ArtifactStore } from './artifactStore.ts'
import type {
  BackupDatabase, BackupManifest, CheckResult, ForeignKeyCheck, TableSnapshot,
} from './manifest.ts'
import {
  BACKUP_DATABASE_FILE, BACKUP_FORMAT, BACKUP_MANIFEST_CONTRACT, BACKUP_MANIFEST_FILE,
  BACKUP_MANIFEST_VERSION, RecoveryError, artifactIdFor, manifestIdentity, serializeManifest,
  validateBackupManifest,
} from './manifest.ts'

const RECENCY_COLUMNS = ['updated_at', 'occurred_at', 'created_at', 'applied_at', 'started_at']

export const sha256File = async (path: string): Promise<string> => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Uint8Array)
  return hash.digest('hex')
}

const quote = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`

const pragmaMessages = (db: DatabaseConstructor.Database, name: string): string[] =>
  (db.pragma(name) as Record<string, unknown>[])
    .map((row) => String(Object.values(row)[0] ?? ''))
    .filter(Boolean)

/** Offline checks against a snapshot. Never call this on the live database. */
export function runSnapshotChecks(db: DatabaseConstructor.Database): {
  quickCheck: CheckResult
  integrityCheck: CheckResult
  foreignKeyCheck: ForeignKeyCheck
} {
  const quickMessages = pragmaMessages(db, 'quick_check')
  const integrityMessages = pragmaMessages(db, 'integrity_check')
  const violations = (db.pragma('foreign_key_check') as Record<string, unknown>[])
    .map((row) => ({
      table: String(row.table),
      rowid: row.rowid == null ? null : Number(row.rowid),
      parent: String(row.parent),
      foreignKeyIndex: Number(row.fkid),
    }))
    .sort((a, b) =>
      a.table.localeCompare(b.table)
      || (a.rowid ?? -1) - (b.rowid ?? -1)
      || a.parent.localeCompare(b.parent)
      || a.foreignKeyIndex - b.foreignKeyIndex)

  const checks = {
    quickCheck: {
      ok: quickMessages.length === 1 && quickMessages[0] === 'ok',
      messages: quickMessages,
    },
    integrityCheck: {
      ok: integrityMessages.length === 1 && integrityMessages[0] === 'ok',
      messages: integrityMessages,
    },
    foreignKeyCheck: { ok: violations.length === 0, violations },
  }

  if (!checks.quickCheck.ok) {
    throw new RecoveryError('BACKUP_QUICK_CHECK_FAILED', 'snapshot quick_check did not return ok')
  }
  if (!checks.integrityCheck.ok) {
    throw new RecoveryError('BACKUP_INTEGRITY_CHECK_FAILED', 'snapshot integrity_check did not return ok')
  }
  if (!checks.foreignKeyCheck.ok) {
    throw new RecoveryError(
      'BACKUP_FOREIGN_KEY_CHECK_FAILED',
      `snapshot foreign_key_check returned ${violations.length} violation(s)`,
    )
  }
  return checks
}

function tableRecency(
  db: DatabaseConstructor.Database, table: string, rowCount: number,
): TableSnapshot['recency'] {
  if (rowCount === 0) return undefined
  const columns = (db.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string }[])
    .map((column) => column.name)
  const column = RECENCY_COLUMNS.find((candidate) => columns.includes(candidate))
  if (!column) return undefined
  const row = db.prepare<[], { value: string | number | null }>(
    `SELECT MAX(${quote(column)}) AS value FROM ${quote(table)} WHERE ${quote(column)} IS NOT NULL`,
  ).get()
  if (row?.value == null) return undefined
  const text = String(row.value)
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(' ', 'T')}Z`
    : text
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return undefined
  return { column, raw: row.value, utc: new Date(parsed).toISOString() }
}

export function inspectSnapshot(
  db: DatabaseConstructor.Database,
  input: { sourcePath: string; sha256: string; bytes: number },
): BackupDatabase {
  const objects = db.prepare<[], { type: string; name: string }>(
    "SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all()
  const schemaObjectCounts = { index: 0, table: 0, trigger: 0, view: 0 }
  for (const object of objects) {
    if (Object.hasOwn(schemaObjectCounts, object.type)) {
      schemaObjectCounts[object.type as keyof typeof schemaObjectCounts] += 1
    }
  }

  const tables = db.prepare<[], { name: string }>(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map(({ name }): TableSnapshot => {
    const rowCount = Number(
      (db.prepare(`SELECT COUNT(*) AS count FROM ${quote(name)}`).get() as { count: number }).count)
    const recency = tableRecency(db, name, rowCount)
    return recency ? { name, rowCount, recency } : { name, rowCount }
  })

  // Identity comes out of the snapshot: the app marker it stores and the
  // ledger it carries, not the ledger this build happens to ship.
  const identity = readDatabaseIdentity(db)
  const authorityId = readAuthorityId(db)

  return {
    format: BACKUP_FORMAT,
    file: BACKUP_DATABASE_FILE,
    sourcePath: resolve(input.sourcePath),
    sha256: input.sha256,
    bytes: input.bytes,
    appMarker: identity.app,
    authorityId,
    schemaFormat: identity.schemaFormat,
    schemaMarker: identity.schemaMarker,
    schemaObjectsSha256: identity.schemaObjectsSha256,
    migrationLedger: identity.ledger,
    headMigration: identity.headMigration,
    schemaObjectCount: objects.length,
    schemaObjectCounts,
    tables,
    checks: runSnapshotChecks(db),
  }
}

export interface CreateBackupOptions {
  /** Path to the live app database. It is read through the online backup API. */
  sourcePath: string
  store: ArtifactStore
  appVersion: string
  buildId: string
  sourceCommit: string
  /** Frozen for reproducible tests. */
  sourceCreatedUtc?: string
  /**
   * Scratch directory for the snapshot before it is uploaded. Defaults to a
   * hidden directory beside the database rather than the system temp dir, which
   * on App Service is small and not on the persistent volume.
   */
  workRoot?: string
  /** Deterministic test seam after descriptor preflight and before SQLite open. */
  afterSourcePreflight?: () => void
}

export interface BackupResult {
  artifactId: string
  manifest: BackupManifest
  databaseKey: string
  manifestKey: string
  bytes: number
  sha256: string
}

/**
 * Take an online backup, inspect the copy, write the manifest, and upload both
 * to the configured artifact store.
 */
export async function createBackup(options: CreateBackupOptions): Promise<BackupResult> {
  const sourceCreatedUtc = options.sourceCreatedUtc ?? new Date().toISOString()
  const workRoot = options.workRoot ?? join(dirname(resolve(options.sourcePath)), '.recovery-work')
  await mkdir(workRoot, { recursive: true })
  const work = await mkdtemp(join(workRoot, 'backup-'))
  const snapshotPath = join(work, BACKUP_DATABASE_FILE)

  try {
    const sourcePath = resolve(options.sourcePath)
    const descriptor = openSync(sourcePath, 'r')
    let sourceAuthorityId = ''
    try {
      const preflight = fstatSync(descriptor, { bigint: true })
      const pathBefore = statSync(sourcePath, { bigint: true })
      if (preflight.dev !== pathBefore.dev || preflight.ino !== pathBefore.ino) {
        throw new RecoveryError(
          'BACKUP_SOURCE_RACED',
          'the backup source changed during descriptor preflight',
        )
      }
      options.afterSourcePreflight?.()

      const source = new Database(sourcePath, { fileMustExist: true, readonly: true })
      try {
        verifyNativeFileIdentity(source, {
          dev: preflight.dev,
          ino: preflight.ino,
          size: null,
        }, {
          allowSidecars: true,
          databasePath: sourcePath,
        })
        source.pragma('query_only = ON')
        const sourceIdentity = readDatabaseIdentity(source)
        sourceAuthorityId = readAuthorityId(source)
        assertIdentityMatches(
          codeIdentity(),
          sourceIdentity,
          'the backup source is not a database this build produced',
        )
        // SQLite's own backup API: a consistent copy of a live database.
        await source.backup(snapshotPath)
      } finally {
        source.close()
      }
      const descriptorAfter = fstatSync(descriptor, { bigint: true })
      const pathAfter = statSync(sourcePath, { bigint: true })
      if (descriptorAfter.dev !== preflight.dev || descriptorAfter.ino !== preflight.ino
        || pathAfter.dev !== preflight.dev || pathAfter.ino !== preflight.ino) {
        throw new RecoveryError(
          'BACKUP_SOURCE_RACED',
          'the backup source path stopped referring to the preflighted authority',
        )
      }
    } finally {
      closeSync(descriptor)
    }

    const details = await stat(snapshotPath)
    const sha256 = await sha256File(snapshotPath)

    const snapshot = new Database(snapshotPath, { fileMustExist: true, readonly: true })
    let database: BackupDatabase
    try {
      database = inspectSnapshot(snapshot, {
        sourcePath: options.sourcePath,
        sha256,
        bytes: details.size,
      })
    } finally {
      snapshot.close()
    }
    if (database.authorityId !== sourceAuthorityId) {
      throw new RecoveryError(
        'BACKUP_AUTHORITY_MISMATCH',
        'the snapshot authority does not match the preflighted backup source',
      )
    }

    // The snapshot must be an authority this build produced: same app marker,
    // same ordered ledger, same checksums — not merely the same head id.
    assertIdentityMatches(
      codeIdentity(),
      {
        app: database.appMarker,
        schemaFormat: database.schemaFormat,
        schemaMarker: database.schemaMarker,
        schemaObjectsSha256: database.schemaObjectsSha256,
        headMigration: database.headMigration,
        ledger: database.migrationLedger,
      },
      'the snapshot is not a database this build produced',
    )

    const manifest: BackupManifest = {
      contract: BACKUP_MANIFEST_CONTRACT,
      contractVersion: BACKUP_MANIFEST_VERSION,
      app: 'shapepilot',
      appVersion: options.appVersion,
      buildId: options.buildId,
      sourceCommit: options.sourceCommit,
      sourceCreatedUtc,
      database,
    }

    const artifactId = artifactIdFor(sourceCreatedUtc, manifest)
    const databaseKey = `${artifactId}/${BACKUP_DATABASE_FILE}`
    const manifestKey = `${artifactId}/${BACKUP_MANIFEST_FILE}`
    const manifestPath = join(work, BACKUP_MANIFEST_FILE)
    const manifestBytes = Buffer.from(serializeManifest(manifest))
    await writeFile(manifestPath, manifestBytes, { mode: 0o600 })

    await options.store.putBundle(artifactId, [
      {
        name: BACKUP_DATABASE_FILE,
        sourcePath: snapshotPath,
        bytes: details.size,
        sha256,
      },
      {
        name: BACKUP_MANIFEST_FILE,
        sourcePath: manifestPath,
        bytes: manifestBytes.byteLength,
        sha256: createHash('sha256').update(manifestBytes).digest('hex'),
      },
    ])

    // Read the manifest back out of the external store and re-derive the
    // identity from it. A backup that cannot be read back is not a backup.
    const readBack = validateBackupManifest(
      JSON.parse(Buffer.from(await options.store.get(manifestKey)).toString('utf8')) as unknown)
    if (serializeManifest(readBack) !== serializeManifest(manifest)) {
      throw new RecoveryError(
        'BACKUP_READ_BACK_MISMATCH', 'the stored manifest differs from the one that was written')
    }
    assertIdentityMatches(
      manifestIdentity(manifest), manifestIdentity(readBack),
      'the manifest read back from the artifact store has a different identity')
    if (readBack.database.authorityId !== manifest.database.authorityId) {
      throw new RecoveryError(
        'BACKUP_READ_BACK_MISMATCH',
        'the manifest read back from the artifact store has a different authority id',
      )
    }

    return {
      artifactId,
      manifest,
      databaseKey,
      manifestKey,
      bytes: details.size,
      sha256,
    }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
