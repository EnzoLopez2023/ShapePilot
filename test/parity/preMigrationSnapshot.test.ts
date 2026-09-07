// The snapshot taken before a release changes the schema.
//
// The property this suite exists for is one sentence: a migration can never
// apply to a production database without a verified copy of that database
// existing first. Everything below is a way of trying to break that — no store,
// an unwritable store, a database that is not ours, a database that is ahead —
// and asserting that when the snapshot cannot be taken, the schema is still
// untouched afterwards.
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, test } from 'vitest'
import { applyConnectionPragmas } from '../../lib/db/connection.ts'
import { MIGRATIONS, codeIdentity, migrate, readAppliedMigrations } from '../../lib/db/migrate.ts'
import { IdentityError, assertLedgerPrefix, ledgerPrefixDifferences } from '../../lib/db/identity.ts'
import { createFilesystemArtifactStore } from '../../lib/recovery/artifactStore.ts'
import { createBackup } from '../../lib/recovery/backup.ts'
import {
  PreMigrationSnapshotError, ensurePreMigrationSnapshot, pendingMigrations,
} from '../../lib/recovery/preMigrationBackup.ts'
import { BACKUP_MANIFEST_FILE, validateBackupManifest } from '../../lib/recovery/manifest.ts'
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

const HEAD = MIGRATIONS.at(-1)?.id ?? ''

interface Fixture {
  root: string
  dbPath: string
  storeRoot: string
  store: ReturnType<typeof createFilesystemArtifactStore>
}

/**
 * A database migrated through the first `count` migrations and no further —
 * which is exactly what a production database looks like when a release that
 * adds a migration starts against it.
 */
function fixture(label: string, count = MIGRATIONS.length): Fixture {
  const root = scratchDir(label)
  const dbPath = join(root, 'shapepilot.db')
  const handle = new Database(dbPath)
  try {
    applyConnectionPragmas(handle, 2_000, dbPath)
    migrate(handle, MIGRATIONS.slice(0, count))
    handle.prepare(`
      INSERT INTO keycap_tray_designs
        (id, owner_tenant_id, owner_oid, name, profile_kind, profile_json, sizing_json)
      VALUES (1, 't', 'o', 'A tray worth not losing', 'rect', '{}', '{}')`).run()
  } finally {
    handle.close()
  }
  const storeRoot = join(root, 'store')
  mkdirSync(storeRoot, { recursive: true })
  return { root, dbPath, storeRoot, store: createFilesystemArtifactStore(storeRoot) }
}

const options = (target: Fixture, over: Record<string, unknown> = {}) => ({
  databasePath: target.dbPath,
  openStore: () => target.store,
  appVersion: '0.1.0',
  buildId: 'test',
  sourceCommit: 'test',
  workRoot: join(target.root, 'work'),
  required: true,
  ...over,
})

/** What the database has actually applied, right now. */
const appliedIds = (dbPath: string): string[] => {
  const handle = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    return readAppliedMigrations(handle).map(m => m.id)
  } finally {
    handle.close()
  }
}

describe('deciding whether a snapshot is needed', () => {
  test('a database this build already migrated has nothing pending', () => {
    const target = fixture('pending-current')
    assert.deepEqual(pendingMigrations(target.dbPath).pending, [])
  })

  test('a database one release behind reports exactly what is about to apply', () => {
    const target = fixture('pending-behind', MIGRATIONS.length - 1)
    assert.deepEqual(pendingMigrations(target.dbPath).pending, [HEAD])
  })

  test('a database several releases behind reports all of them, in order', () => {
    const target = fixture('pending-far-behind', MIGRATIONS.length - 3)
    assert.deepEqual(
      pendingMigrations(target.dbPath).pending,
      MIGRATIONS.slice(-3).map(m => m.id))
  })

  test('a database whose history is not ours reports nothing pending', () => {
    // `migrate` diagnoses divergence precisely a moment later; this only has to
    // refuse to take a copy of something it cannot vouch for.
    const target = fixture('pending-diverged', MIGRATIONS.length - 1)
    const handle = new Database(target.dbPath, { fileMustExist: true })
    handle.prepare(
      `UPDATE schema_migrations SET checksum = '${'0'.repeat(64)}' WHERE ordinal = 0`).run()
    handle.close()
    assert.deepEqual(pendingMigrations(target.dbPath).pending, [])
  })
})

describe('taking the snapshot', () => {
  test('nothing pending means no snapshot and no artifact', async () => {
    const target = fixture('snapshot-current')
    const result = await ensurePreMigrationSnapshot(options(target))
    assert.equal(result.status, 'up-to-date')
    assert.deepEqual(await target.store.list(''), [])
  })

  test('a pending migration produces a verified copy of the database as it is now', async () => {
    const target = fixture('snapshot-taken', MIGRATIONS.length - 1)
    const result = await ensurePreMigrationSnapshot(options(target))

    assert.equal(result.status, 'taken')
    if (result.status !== 'taken') return
    assert.deepEqual(result.pending, [HEAD])
    assert.ok(result.bytes > 0)
    assert.match(result.sha256, /^[0-9a-f]{64}$/)

    // The artifact is really in the store, under the id that was reported.
    const keys = await target.store.list('')
    assert.deepEqual(keys, [result.artifactId])

    // And the manifest describes the database *before* the migration: the
    // pending one is absent from the ledger it recorded. That is the whole
    // point of the artifact.
    const manifest = validateBackupManifest(JSON.parse(
      Buffer.from(await target.store.get(`${result.artifactId}/${BACKUP_MANIFEST_FILE}`))
        .toString('utf8')) as unknown)
    const ledger = manifest.database.migrationLedger.map(entry => entry.id)
    assert.equal(ledger.length, MIGRATIONS.length - 1)
    assert.ok(!ledger.includes(HEAD), `the snapshot already contains ${HEAD}`)
    assert.equal(manifest.database.tables.find(t => t.name === 'keycap_tray_designs')?.rowCount, 1)
  })

  test('the snapshot is taken before anything migrates', async () => {
    const target = fixture('snapshot-before', MIGRATIONS.length - 1)
    const before = appliedIds(target.dbPath)
    await ensurePreMigrationSnapshot(options(target))
    // Taking a copy must not itself apply anything.
    assert.deepEqual(appliedIds(target.dbPath), before)
  })
})

describe('refusing to migrate without one', () => {
  test('no artifact store in production is a hard failure, and the schema is untouched', async () => {
    const target = fixture('refuse-no-store', MIGRATIONS.length - 1)
    const before = appliedIds(target.dbPath)

    await assert.rejects(
      () => ensurePreMigrationSnapshot(options(target, { openStore: null })),
      (error: unknown) => {
        assert.ok(error instanceof PreMigrationSnapshotError)
        assert.equal(error.code, 'PRE_MIGRATION_SNAPSHOT_UNAVAILABLE')
        assert.match(error.message, /Refusing to change the schema/)
        assert.match(error.message, new RegExp(HEAD))
        return true
      })

    assert.deepEqual(appliedIds(target.dbPath), before)
  })

  test('a store that cannot be written is a hard failure, and the schema is untouched', async () => {
    const target = fixture('refuse-bad-store', MIGRATIONS.length - 1)
    const before = appliedIds(target.dbPath)
    // A regular file where the store root should be: the store cannot even be
    // opened, which is the shape a missing volume mount takes.
    const brokenRoot = join(target.root, 'not-a-directory')
    writeFileSync(brokenRoot, 'not a store')

    await assert.rejects(
      () => ensurePreMigrationSnapshot(options(target, {
        openStore: () => createFilesystemArtifactStore(brokenRoot),
      })),
      (error: unknown) => {
        assert.ok(error instanceof PreMigrationSnapshotError)
        assert.equal(error.code, 'PRE_MIGRATION_SNAPSHOT_FAILED')
        assert.match(error.message, /Refusing to change the schema/)
        return true
      })

    assert.deepEqual(appliedIds(target.dbPath), before)
  })

  test('outside production a missing store is reported, not fatal', async () => {
    const target = fixture('dev-no-store', MIGRATIONS.length - 1)
    const result = await ensurePreMigrationSnapshot(
      options(target, { openStore: null, required: false }))
    assert.equal(result.status, 'no-store')
    assert.deepEqual(result.pending, [HEAD])
  })

  test('a database with no file yet needs no snapshot', async () => {
    const target = fixture('no-database')
    rmSync(target.dbPath)
    const result = await ensurePreMigrationSnapshot(options(target))
    assert.equal(result.status, 'no-database')
  })

  test('a divergent ledger is left for migrate() to diagnose, and is not copied', async () => {
    const target = fixture('diverged', MIGRATIONS.length - 1)
    const handle = new Database(target.dbPath, { fileMustExist: true })
    handle.prepare(
      "UPDATE schema_migrations SET id = '001-from-somewhere-else' WHERE ordinal = 0").run()
    handle.close()

    const result = await ensurePreMigrationSnapshot(options(target))
    assert.equal(result.status, 'ledger-diverged')
    assert.deepEqual(await target.store.list(''), [])
  })
})

describe('the lineage check that makes the relaxation safe', () => {
  const identity = codeIdentity()
  const behind = { ...identity, ledger: identity.ledger.slice(0, -1) }

  test('a genuine earlier state of this build is accepted', () => {
    assert.deepEqual(ledgerPrefixDifferences(identity, behind), [])
    assert.doesNotThrow(() => assertLedgerPrefix(identity, behind, 'ctx'))
  })

  test('the current state is accepted too — a prefix may be the whole thing', () => {
    assert.deepEqual(ledgerPrefixDifferences(identity, identity), [])
  })

  test('a database ahead of this build is refused', () => {
    const ahead = {
      ...identity,
      ledger: [...identity.ledger, { ordinal: identity.ledger.length, id: 'x', name: 'x', checksum: 'x' }],
    }
    assert.match(ledgerPrefixDifferences(identity, ahead).join(' '), /more than the/)
  })

  test.each([
    ['a different earlier checksum', { checksum: '0'.repeat(64) }],
    ['a different earlier id', { id: '001-from-somewhere-else' }],
    ['a different earlier name', { name: 'not what this build calls it' }],
    ['a different earlier ordinal', { ordinal: 7 }],
  ])('%s is refused', (_label, patch) => {
    const tampered = {
      ...identity,
      ledger: identity.ledger.map((entry, index) =>
        index === 0 ? { ...entry, ...patch } : entry).slice(0, -1),
    }
    assert.ok(ledgerPrefixDifferences(identity, tampered).length > 0)
    assert.throws(() => assertLedgerPrefix(identity, tampered, 'ctx'), IdentityError)
  })

  test('a foreign app marker is refused', () => {
    assert.throws(
      () => assertLedgerPrefix(identity, { ...behind, app: 'something-else' }, 'ctx'),
      IdentityError)
  })

  test('an empty ledger is refused', () => {
    assert.throws(() => assertLedgerPrefix(identity, { ...identity, ledger: [] }, 'ctx'), IdentityError)
  })
})

describe('the relaxation is opt-in', () => {
  test('an ordinary backup still refuses a database this build did not produce', async () => {
    // Without `expectLedgerPrefix`, a behind-database is exactly the "wrong
    // file mounted" case the identity check exists to catch, and must stay so.
    const target = fixture('opt-in', MIGRATIONS.length - 1)
    await assert.rejects(
      () => createBackup({
        sourcePath: target.dbPath,
        store: target.store,
        appVersion: '0.1.0',
        buildId: 'test',
        sourceCommit: 'test',
        workRoot: join(target.root, 'work'),
      }),
      (error: unknown) => {
        assert.ok(error instanceof IdentityError)
        assert.equal(error.code, 'SCHEMA_IDENTITY_MISMATCH')
        return true
      })
  })
})
