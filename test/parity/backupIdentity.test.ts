// Snapshot-derived backup identity.
//
// A backup manifest must describe the database it was taken from, proved from
// that database's own bytes: the app marker it stores, the schema-format
// marker, and the complete ordered migration ledger with each entry's ordinal,
// id, name and checksum.
//
// The failure this suite exists for is the quiet one: a database whose *head*
// migration id is right but whose history is not. Same head, different earlier
// checksum, reordered ledger, a missing entry, a foreign app marker — each one
// must stop a backup, a verification and, above all, a restore, before anything
// can be promoted.
import assert from 'node:assert/strict'
import { mkdirSync, renameSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, test } from 'vitest'
import { openDatabase } from '../../lib/db/connection.ts'
import { NativeIdentityError } from '../../lib/db/nativeIdentity.ts'
import { IdentityError, schemaMarkerOf } from '../../lib/db/identity.ts'
import { MIGRATIONS, migrationChecksum } from '../../lib/db/migrate.ts'
import { createFilesystemArtifactStore } from '../../lib/recovery/artifactStore.ts'
import { createBackup, sha256File } from '../../lib/recovery/backup.ts'
import type { BackupManifest } from '../../lib/recovery/manifest.ts'
import {
  BACKUP_DATABASE_FILE, BACKUP_MANIFEST_FILE, RecoveryError, artifactIdFor,
  serializeManifest, validateBackupManifest,
} from '../../lib/recovery/manifest.ts'
import { restoreBackup, verifyBackup } from '../../lib/recovery/verify.ts'
import { TEST_ROOT } from '../helpers/server.ts'

const scratch: string[] = []

const scratchDir = (label: string): string => {
  const path = join(TEST_ROOT, `${label}-${randomUUID()}`)
  mkdirSync(path, { recursive: true })
  scratch.push(path)
  return path
}

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true })
})

interface Fixture {
  root: string
  dbPath: string
  store: ReturnType<typeof createFilesystemArtifactStore>
}

function fixture(label: string): Fixture {
  const root = scratchDir(label)
  const dbPath = join(root, 'shapepilot.db')
  const database = openDatabase({ path: dbPath, busyTimeoutMs: 2_000, createIfMissing: true })
  database.handle.prepare(`
    INSERT INTO keycap_tray_designs
      (id, owner_tenant_id, owner_oid, name, profile_kind, profile_json, sizing_json)
    VALUES (1, 't', 'o', 'Identity tray', 'rect', '{}', '{}')`).run()
  database.close()

  const storeRoot = join(root, 'store')
  mkdirSync(storeRoot, { recursive: true })
  return { root, dbPath, store: createFilesystemArtifactStore(storeRoot) }
}

const backupOptions = (target: Fixture) => ({
  sourcePath: target.dbPath,
  store: target.store,
  appVersion: '0.1.0',
  buildId: 'test',
  sourceCommit: 'test',
  sourceCreatedUtc: '2026-08-28T05:36:25.317Z',
  workRoot: join(target.root, 'work'),
})

/** Edit a database in place, the way a bad restore or a swapped file would. */
function mutate(path: string, statements: string[]): void {
  const db = new Database(path, { fileMustExist: true })
  try {
    for (const statement of statements) db.prepare(statement).run()
  } finally {
    db.close()
  }
}

const HEAD = MIGRATIONS.at(-1)?.id ?? ''
const FIRST = MIGRATIONS[0]

/** Same head migration, different history. */
const DIVERGENT_HISTORY: [string, string[]][] = [
  ['a different earlier checksum', [
    `UPDATE schema_migrations SET checksum = '${'0'.repeat(64)}' WHERE ordinal = 0`,
  ]],
  ['a different earlier id', [
    "UPDATE schema_migrations SET id = '001-initial-from-somewhere-else' WHERE ordinal = 0",
  ]],
  ['a different earlier name', [
    "UPDATE schema_migrations SET name = 'not what this build calls it' WHERE ordinal = 0",
  ]],
  ['a reordered ledger', [
    'UPDATE schema_migrations SET ordinal = 9 WHERE ordinal = 0',
    'UPDATE schema_migrations SET ordinal = 0 WHERE ordinal = 1',
    'UPDATE schema_migrations SET ordinal = 1 WHERE ordinal = 9',
  ]],
  ['a missing earlier entry', ['DELETE FROM schema_migrations WHERE ordinal = 0']],
  ['a foreign app marker', ["UPDATE app_identity SET value = 'prism' WHERE key = 'app'"]],
  ['a foreign schema format marker', [
    "UPDATE app_identity SET value = 'someone.else.v1' WHERE key = 'schema_format'",
  ]],
  ['an altered sqlite_schema catalog', ['DROP INDEX idx_keycap_designs_owner']],
]

describe('a backup refuses a database this build did not produce', () => {
  for (const [label, statements] of DIVERGENT_HISTORY) {
    test(`${label} stops the backup`, async () => {
      const target = fixture('divergent-backup')
      mutate(target.dbPath, statements)

      // The head migration is still the one this build ships, which is exactly
      // why a head-only check would have let this through.
      if (!label.includes('missing') && !label.includes('reordered')) {
        const db = new Database(target.dbPath, { readonly: true, fileMustExist: true })
        try {
          const head = db.prepare<[], { id: string }>(
            'SELECT id FROM schema_migrations ORDER BY ordinal DESC LIMIT 1').get()
          assert.equal(head?.id, HEAD)
        } finally {
          db.close()
        }
      }

      await assert.rejects(
        () => createBackup(backupOptions(target)),
        (error: unknown) => error instanceof IdentityError
          && error.code === 'SCHEMA_IDENTITY_MISMATCH')
    })
  }

  test('a database with no identity markers stops the backup', async () => {
    const target = fixture('no-identity-backup')
    mutate(target.dbPath, ['DROP TABLE app_identity'])
    await assert.rejects(
      () => createBackup(backupOptions(target)),
      (error: unknown) => error instanceof IdentityError && error.code === 'APP_MARKER_MISSING')
  })

  test('a raced source path cannot back up another valid ShapePilot authority', async () => {
    const target = fixture('source-race')
    const replacement = fixture('source-race-replacement')
    const displaced = join(target.root, 'displaced.db')
    const replacementHash = await sha256File(replacement.dbPath)

    await assert.rejects(
      () => createBackup({
        ...backupOptions(target),
        afterSourcePreflight: () => {
          renameSync(target.dbPath, displaced)
          renameSync(replacement.dbPath, target.dbPath)
        },
      }),
      (error: unknown) => error instanceof NativeIdentityError
        && error.code === 'NATIVE_IDENTITY_MISMATCH',
    )
    assert.equal(await sha256File(target.dbPath), replacementHash)
  })
})

describe('the manifest identity block is self-proving', () => {
  test('the schema marker must be the marker of the ledger it carries', async () => {
    const target = fixture('manifest-marker')
    const result = await createBackup(backupOptions(target))
    const manifest = JSON.parse(
      JSON.stringify(result.manifest)) as unknown as BackupManifest

    manifest.database.schemaMarker = 'a'.repeat(64)
    assert.throws(
      () => validateBackupManifest(manifest),
      (error: unknown) => error instanceof RecoveryError
        && error.code === 'MANIFEST_SCHEMA_MARKER_MISMATCH')
  })

  test('a reordered or truncated ledger is refused', async () => {
    const target = fixture('manifest-ledger')
    const result = await createBackup(backupOptions(target))

    const reordered = JSON.parse(JSON.stringify(result.manifest)) as BackupManifest
    reordered.database.migrationLedger = [...reordered.database.migrationLedger].reverse()
    reordered.database.schemaMarker = schemaMarkerOf(reordered.database.migrationLedger)
    assert.throws(
      () => validateBackupManifest(reordered),
      (error: unknown) => error instanceof RecoveryError && error.code === 'MANIFEST_INVALID')

    const truncated = JSON.parse(JSON.stringify(result.manifest)) as BackupManifest
    truncated.database.migrationLedger = truncated.database.migrationLedger.slice(0, 1)
    truncated.database.schemaMarker = schemaMarkerOf(truncated.database.migrationLedger)
    assert.throws(
      () => validateBackupManifest(truncated),
      (error: unknown) => error instanceof RecoveryError && error.code === 'MANIFEST_INVALID')
  })

  test('an empty ledger or a blank app marker is refused', async () => {
    const target = fixture('manifest-empty')
    const result = await createBackup(backupOptions(target))

    const noLedger = JSON.parse(JSON.stringify(result.manifest)) as BackupManifest
    noLedger.database.migrationLedger = []
    assert.throws(
      () => validateBackupManifest(noLedger),
      (error: unknown) => error instanceof RecoveryError && error.code === 'MANIFEST_INVALID')

    const noApp = JSON.parse(JSON.stringify(result.manifest)) as BackupManifest
    noApp.database.appMarker = ''
    assert.throws(
      () => validateBackupManifest(noApp),
      (error: unknown) => error instanceof RecoveryError && error.code === 'MANIFEST_INVALID')
  })

  test('the ledger records the id, name, ordinal and checksum of every migration', async () => {
    const target = fixture('manifest-complete')
    const result = await createBackup(backupOptions(target))
    assert.deepEqual(result.manifest.database.migrationLedger, MIGRATIONS.map((m, index) => ({
      ordinal: index,
      id: m.id,
      name: m.name,
      checksum: migrationChecksum(m),
    })))
    assert.equal(
      result.manifest.database.schemaMarker,
      schemaMarkerOf(result.manifest.database.migrationLedger))
    assert.match(result.manifest.database.schemaObjectsSha256, /^[0-9a-f]{64}$/)
    assert.match(result.manifest.database.authorityId, /^[0-9a-f]{32}$/)
    assert.equal(result.manifest.database.migrationLedger[0].id, FIRST.id)
  })

  test('a missing or malformed authority id is refused', async () => {
    const target = fixture('manifest-authority')
    const result = await createBackup(backupOptions(target))
    for (const authorityId of ['', 'z'.repeat(32), 'a'.repeat(31)]) {
      const manifest = JSON.parse(JSON.stringify(result.manifest)) as BackupManifest
      manifest.database.authorityId = authorityId
      assert.throws(
        () => validateBackupManifest(manifest),
        (error: unknown) => error instanceof RecoveryError && error.code === 'MANIFEST_INVALID')
    }
  })
})

/**
 * Swap the stored artifact for a tampered database and rewrite the manifest's
 * byte length and hash to match — everything an attacker or a bad operator
 * controls — while leaving the identity block describing the original.
 */
async function swapArtifact(
  target: Fixture, artifactId: string, statements: string[],
): Promise<string> {
  const stored = join(target.root, 'store', artifactId, BACKUP_DATABASE_FILE)
  mutate(stored, statements)

  const manifestKey = `${artifactId}/${BACKUP_MANIFEST_FILE}`
  const manifest = JSON.parse(
    Buffer.from(await target.store.get(manifestKey)).toString('utf8')) as BackupManifest
  manifest.database.sha256 = await sha256File(stored)
  manifest.database.bytes = (await import('node:fs')).statSync(stored).size
  await target.store.put(manifestKey, Buffer.from(serializeManifest(manifest), 'utf8'))
  const tamperedId = artifactIdFor(manifest.sourceCreatedUtc, manifest)
  renameSync(
    join(target.root, 'store', artifactId),
    join(target.root, 'store', tamperedId),
  )
  return tamperedId
}

describe('read-back, disposable restore and promotion all re-derive identity', () => {
  test('a same-head divergence is caught on read-back and on the restore', async () => {
    const target = fixture('verify-divergence')
    const result = await createBackup(backupOptions(target))
    const tamperedId = await swapArtifact(target, result.artifactId, [
      `UPDATE schema_migrations SET checksum = '${'1'.repeat(64)}' WHERE ordinal = 0`,
    ])

    const report = await verifyBackup({
      store: target.store,
      artifactId: tamperedId,
      workRoot: join(target.root, 'verify-work'),
    })
    assert.equal(report.ok, false)
    assert.ok(report.differences.some((d) => d.startsWith('read-back identity:')),
      'the read-back must be judged on its own bytes')
    assert.ok(report.differences.some((d) => d.startsWith('disposable restore identity:')),
      'the disposable restore must be judged on its own bytes')
    assert.ok(report.differences.some((d) => d.includes('checksum')))
  })

  test('restore refuses to materialize a diverged database for promotion', async () => {
    const target = fixture('restore-divergence')
    const result = await createBackup(backupOptions(target))
    const tamperedId = await swapArtifact(target, result.artifactId, [
      "UPDATE app_identity SET value = 'watchtower' WHERE key = 'app'",
    ])

    const destination = join(target.root, 'restored.db')
    await assert.rejects(
      () => restoreBackup({
        store: target.store,
        artifactId: tamperedId,
        destinationPath: destination,
        activePath: target.dbPath,
      }),
      (error: unknown) => error instanceof RecoveryError
        && error.code === 'RESTORE_IDENTITY_MISMATCH')

    // Nothing may be left behind for an operator to promote by accident.
    const { existsSync } = await import('node:fs')
    assert.equal(existsSync(destination), false)
  })

  test('verify and restore reject a snapshot with another authority id', async () => {
    const target = fixture('authority-divergence')
    const result = await createBackup(backupOptions(target))
    const tamperedId = await swapArtifact(target, result.artifactId, [
      `UPDATE app_identity SET value = '${'a'.repeat(32)}' WHERE key = 'authority_id'`,
    ])

    const report = await verifyBackup({
      store: target.store,
      artifactId: tamperedId,
      workRoot: join(target.root, 'verify-work'),
    })
    assert.equal(report.ok, false)
    assert.ok(report.differences.some((difference) => difference.includes('authority id')))
    await assert.rejects(
      () => restoreBackup({
        store: target.store,
        artifactId: tamperedId,
        destinationPath: join(target.root, 'authority-divergent.db'),
        activePath: target.dbPath,
      }),
      (error: unknown) => error instanceof RecoveryError
        && error.code === 'RESTORE_IDENTITY_MISMATCH')
  })

  test('a good artifact restores and reports the identity it was taken with', async () => {
    const target = fixture('restore-good')
    const result = await createBackup(backupOptions(target))
    const destination = join(target.root, 'restored-good.db')

    const restored = await restoreBackup({
      store: target.store,
      artifactId: result.artifactId,
      destinationPath: destination,
      activePath: target.dbPath,
    })
    assert.equal(restored.identity.app, 'shapepilot')
    assert.equal(restored.identity.headMigration, HEAD)
    assert.equal(restored.identity.schemaMarker, result.manifest.database.schemaMarker)
    assert.deepEqual(restored.identity.ledger, result.manifest.database.migrationLedger)

    // ...and it still refuses to overwrite that destination or the live one.
    await assert.rejects(
      () => restoreBackup({
        store: target.store,
        artifactId: result.artifactId,
        destinationPath: destination,
        activePath: target.dbPath,
      }),
      (error: unknown) => error instanceof RecoveryError
        && error.code === 'RESTORE_DESTINATION_EXISTS')
    await assert.rejects(
      () => restoreBackup({
        store: target.store,
        artifactId: result.artifactId,
        destinationPath: target.dbPath,
        activePath: target.dbPath,
      }),
      (error: unknown) => error instanceof RecoveryError
        && ['RESTORE_DESTINATION_EXISTS', 'RESTORE_DESTINATION_ACTIVE'].includes(error.code))
  })

  test('a good artifact verifies with matching read-back and restore identities', async () => {
    const target = fixture('verify-good')
    const result = await createBackup(backupOptions(target))
    const report = await verifyBackup({
      store: target.store,
      artifactId: result.artifactId,
      workRoot: join(target.root, 'verify-work'),
    })
    assert.equal(report.ok, true)
    assert.deepEqual(report.differences, [])
    assert.equal(report.readBackIdentity.schemaMarker, result.manifest.database.schemaMarker)
    assert.deepEqual(report.restoredIdentity.ledger, result.manifest.database.migrationLedger)
    assert.match(report.sha256, /^[0-9a-f]{64}$/)
  })

  test('a manifest and database pair cannot be substituted beneath an existing id', async () => {
    const target = fixture('content-address')
    const result = await createBackup(backupOptions(target))
    const manifestKey = `${result.artifactId}/${BACKUP_MANIFEST_FILE}`
    const manifest = JSON.parse(
      Buffer.from(await target.store.get(manifestKey)).toString('utf8')) as BackupManifest
    manifest.buildId = 'substituted'
    await target.store.put(manifestKey, Buffer.from(serializeManifest(manifest), 'utf8'))

    await assert.rejects(
      () => verifyBackup({
        store: target.store,
        artifactId: result.artifactId,
        workRoot: join(target.root, 'verify-work'),
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === 'ARTIFACT_ID_MISMATCH')
    await assert.rejects(
      () => restoreBackup({
        store: target.store,
        artifactId: result.artifactId,
        destinationPath: join(target.root, 'substituted.db'),
      }),
      (error: unknown) => error instanceof RecoveryError && error.code === 'ARTIFACT_ID_MISMATCH')
  })
})
