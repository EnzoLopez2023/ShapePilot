// Backup, verify and restore.
//
// The contract these prove: SQLite's online backup API rather than a byte copy,
// a manifest with hash/counts/recency and all three offline checks, a read-back
// that restores into a disposable destination, a forward-only restore that
// refuses an active destination, and no recovery work on any startup or request
// path.
import assert from 'node:assert/strict'
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, describe, test } from 'vitest'
import { openDatabase } from '../../lib/db/connection.ts'
import { MIGRATIONS, headMigrationId, schemaIdentity } from '../../lib/db/migrate.ts'
import {
  ArtifactStoreError, assertSafeKey, createFilesystemArtifactStore,
} from '../../lib/recovery/artifactStore.ts'
import { createBackup, sha256File } from '../../lib/recovery/backup.ts'
import {
  BACKUP_DATABASE_FILE, BACKUP_MANIFEST_FILE, RecoveryError, validateBackupManifest,
} from '../../lib/recovery/manifest.ts'
import { restoreBackup, verifyBackup } from '../../lib/recovery/verify.ts'
import { TEST_ROOT, startTestServer, stubVerifier } from '../helpers/server.ts'

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
  dbPath: string
  storeRoot: string
  store: ReturnType<typeof createFilesystemArtifactStore>
}

function seededDatabase(label: string): Fixture {
  const root = scratchDir(label)
  const dbPath = join(root, 'shapepilot.db')
  const database = openDatabase({ path: dbPath, busyTimeoutMs: 2_000, createIfMissing: true })
  database.handle.prepare(`
    INSERT INTO keycap_tray_designs
      (id, owner_tenant_id, owner_oid, name, profile_kind, profile_json, sizing_json,
       created_at, updated_at)
    VALUES (1, 't', 'o', 'Backed up tray', 'rect', '{}', '{}',
            '2026-08-27 00:00:00', '2026-08-27 00:07:24')`).run()
  database.handle.prepare(`
    INSERT INTO keycap_tray_pockets (id, design_id, units, x_mm, y_mm, sort_order)
    VALUES (1, 1, 1, 0, 0, 0), (2, 1, 2, 30, 0, 1)`).run()
  database.close()

  const storeRoot = join(root, 'artifact-store')
  mkdirSync(storeRoot, { recursive: true })
  return { dbPath, storeRoot, store: createFilesystemArtifactStore(storeRoot) }
}

const backupOptions = (fixture: Fixture) => ({
  sourcePath: fixture.dbPath,
  store: fixture.store,
  appVersion: '0.1.0',
  buildId: 'test',
  sourceCommit: 'test',
  sourceCreatedUtc: '2026-08-28T05:36:25.317Z',
  workRoot: join(fixture.storeRoot, '..', 'work'),
})

describe('artifact store', () => {
  test('keys are relative and cannot traverse out of the root', () => {
    const root = scratchDir('store')
    const store = createFilesystemArtifactStore(root)
    for (const key of ['../escape', '/absolute', 'a/../../b', '..']) {
      assert.rejects(() => store.get(key),
        (error: unknown) => error instanceof ArtifactStoreError)
    }
    assert.equal(assertSafeKey('20260828T053625317Z-abc/manifest.json'),
      '20260828T053625317Z-abc/manifest.json')
    assert.throws(() => assertSafeKey('../x'),
      (error: unknown) => error instanceof ArtifactStoreError)
  })

  test('put and get round-trip bytes and report the hash', async () => {
    const store = createFilesystemArtifactStore(scratchDir('store-roundtrip'))
    const payload = Buffer.from('shapepilot artifact', 'utf8')
    const stored = await store.put('bundle/data.bin', payload)
    assert.equal(stored.bytes, payload.byteLength)
    assert.deepEqual(Buffer.from(await store.get('bundle/data.bin')), payload)
    assert.deepEqual(await store.list('bundle'), ['bundle/data.bin'])
  })
})

describe('backup', () => {
  test('the backup is a real SQLite snapshot, not a byte copy of the live file', async () => {
    const fixture = seededDatabase('backup')

    // Hold a live connection open with an uncommitted write in flight; a naive
    // byte copy would capture a torn file, the online backup API cannot.
    const live = openDatabase({
      path: fixture.dbPath, busyTimeoutMs: 2_000, createIfMissing: false,
    })
    try {
      live.handle.prepare(`
        INSERT INTO keycap_tray_designs
          (id, owner_tenant_id, owner_oid, name, profile_kind, profile_json, sizing_json)
        VALUES (2, 't', 'o', 'second', 'rect', '{}', '{}')`).run()

      const result = await createBackup(backupOptions(fixture))
      assert.match(result.artifactId, /^\d{8}T\d{9}Z-[0-9a-f]{16}$/)
      assert.equal(result.databaseKey, `${result.artifactId}/${BACKUP_DATABASE_FILE}`)

      const manifest = result.manifest
      assert.equal(manifest.contract, 'shapepilot.sqlite-backup-manifest.v2')
      assert.equal(manifest.database.checks.quickCheck.ok, true)
      assert.equal(manifest.database.checks.integrityCheck.ok, true)
      assert.equal(manifest.database.checks.foreignKeyCheck.ok, true)
      // Identity is derived from the snapshot and happens to agree with this
      // build, which is what makes the backup acceptable in the first place.
      assert.equal(manifest.database.appMarker, 'shapepilot')
      assert.equal(manifest.database.schemaMarker, schemaIdentity())
      assert.equal(manifest.database.headMigration, headMigrationId())
      assert.deepEqual(
        manifest.database.migrationLedger.map(entry => entry.id),
        MIGRATIONS.map(migration => migration.id))
      assert.deepEqual(
        manifest.database.migrationLedger.map(entry => entry.ordinal),
        MIGRATIONS.map((_, index) => index))

      const designs = manifest.database.tables.find(t => t.name === 'keycap_tray_designs')
      assert.equal(designs?.rowCount, 2)
      assert.equal(designs?.recency?.column, 'updated_at')
      const pockets = manifest.database.tables.find(t => t.name === 'keycap_tray_pockets')
      assert.equal(pockets?.rowCount, 2)
    } finally {
      live.close()
    }
  })

  test('the manifest validates and records the exact stored bytes', async () => {
    const fixture = seededDatabase('backup-manifest')
    const result = await createBackup(backupOptions(fixture))

    const stored = await fixture.store.get(`${result.artifactId}/${BACKUP_MANIFEST_FILE}`)
    const parsed = validateBackupManifest(JSON.parse(Buffer.from(stored).toString('utf8')))
    assert.equal(parsed.database.sha256, result.sha256)
    assert.equal(parsed.database.bytes, result.bytes)

    const onDisk = join(fixture.storeRoot, result.artifactId, BACKUP_DATABASE_FILE)
    assert.equal(await sha256File(onDisk), result.sha256)
  })

  test('the live database is left untouched by taking a backup', async () => {
    const fixture = seededDatabase('backup-untouched')
    const before = await sha256File(fixture.dbPath)
    await createBackup(backupOptions(fixture))
    assert.equal(await sha256File(fixture.dbPath), before)
    assert.ok(!existsSync(`${fixture.dbPath}-wal`))
  })

  test('the scratch directory is cleaned up', async () => {
    const fixture = seededDatabase('backup-scratch')
    const options = backupOptions(fixture)
    await createBackup(options)
    const leftovers = existsSync(options.workRoot)
      ? readFileSync
      : null
    // The work root may remain, but no snapshot may be left inside it.
    if (leftovers) {
      const { readdirSync } = await import('node:fs')
      assert.deepEqual(readdirSync(options.workRoot), [])
    }
  })
})

describe('verify', () => {
  test('a good artifact verifies, restoring into a disposable destination', async () => {
    const fixture = seededDatabase('verify')
    const result = await createBackup(backupOptions(fixture))
    const workRoot = join(fixture.storeRoot, '..', 'verify-work')

    const report = await verifyBackup({
      store: fixture.store, artifactId: result.artifactId, workRoot,
    })
    assert.equal(report.ok, true)
    assert.deepEqual(report.differences, [])
    assert.equal(report.sha256, result.sha256)
    assert.equal(report.manifestSha256, result.sha256)
    assert.ok(report.tables.every(t => t.ok))
    assert.deepEqual(report.checks.quickCheck.messages, ['ok'])
    assert.deepEqual(report.checks.integrityCheck.messages, ['ok'])
    // Disposable: the scratch restore is gone once verification finishes.
    const { readdirSync } = await import('node:fs')
    assert.deepEqual(readdirSync(workRoot), [])
  })

  test('a tampered artifact fails verification', async () => {
    const fixture = seededDatabase('verify-tampered')
    const result = await createBackup(backupOptions(fixture))
    const target = join(fixture.storeRoot, result.artifactId, BACKUP_DATABASE_FILE)
    const bytes = readFileSync(target)
    // Flip a byte deep inside the page data, past the header.
    bytes[bytes.length - 1] ^= 0xff
    writeFileSync(target, bytes)

    // Detection may surface either as a reported difference (bytes/hash) or as
    // a thrown integrity failure, depending on which page was hit. Both are a
    // refusal to accept the artifact; silently passing is not.
    let detected = false
    try {
      const report = await verifyBackup({
        store: fixture.store,
        artifactId: result.artifactId,
        workRoot: join(fixture.storeRoot, '..', 'verify-work'),
      })
      detected = !report.ok
        && report.differences.some(d => d.includes('SHA-256'))
    } catch (error) {
      detected = error instanceof RecoveryError || error instanceof Error
    }
    assert.ok(detected, 'a tampered artifact must never verify clean')
  })

  test('a truncated artifact fails verification on bytes and hash', async () => {
    const fixture = seededDatabase('verify-truncated')
    const result = await createBackup(backupOptions(fixture))
    const target = join(fixture.storeRoot, result.artifactId, BACKUP_DATABASE_FILE)
    writeFileSync(target, readFileSync(target).subarray(0, 4096))

    await assert.rejects(() => verifyBackup({
      store: fixture.store,
      artifactId: result.artifactId,
      workRoot: join(fixture.storeRoot, '..', 'verify-work'),
    }))
  })

  test('a manifest recording a failed check is rejected on read', async () => {
    const fixture = seededDatabase('verify-manifest')
    const result = await createBackup(backupOptions(fixture))
    const manifestPath = join(fixture.storeRoot, result.artifactId, BACKUP_MANIFEST_FILE)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, never>
    ;(manifest.database as unknown as { checks: { quickCheck: { ok: boolean } } })
      .checks.quickCheck.ok = false
    writeFileSync(manifestPath, JSON.stringify(manifest))

    await assert.rejects(
      () => verifyBackup({ store: fixture.store, artifactId: result.artifactId }),
      (error: unknown) => error instanceof RecoveryError
        && error.code === 'MANIFEST_CHECKS_FAILED')
  })
})

describe('restore', () => {
  const assertNoRestoreTemps = (directory: string): void => {
    assert.deepEqual(
      readdirSync(directory).filter((name) => name.startsWith('.shapepilot-restore-')),
      [],
    )
  }

  test('restore materializes a new verified file', async () => {
    const fixture = seededDatabase('restore')
    const result = await createBackup(backupOptions(fixture))
    const destination = join(fixture.storeRoot, '..', 'restored', 'shapepilot.db')

    const restored = await restoreBackup({
      store: fixture.store,
      artifactId: result.artifactId,
      destinationPath: destination,
      activePath: fixture.dbPath,
    })
    assert.equal(restored.sha256, result.sha256)
    assert.equal(restored.checks.foreignKeyCheck.ok, true)

    const reopened = openDatabase({
      path: destination, busyTimeoutMs: 2_000, createIfMissing: false,
    })
    try {
      const row = reopened.handle.prepare<[], { name: string }>(
        'SELECT name FROM keycap_tray_designs WHERE id = 1').get()
      assert.equal(row?.name, 'Backed up tray')
    } finally {
      reopened.close()
    }
  })

  test('restore refuses the active authority', async () => {
    const fixture = seededDatabase('restore-active')
    const result = await createBackup(backupOptions(fixture))
    await assert.rejects(
      () => restoreBackup({
        store: fixture.store,
        artifactId: result.artifactId,
        destinationPath: fixture.dbPath,
        activePath: fixture.dbPath,
      }),
      (error: unknown) => error instanceof RecoveryError
        && error.code === 'RESTORE_DESTINATION_EXISTS')
  })

  test('restore refuses any existing destination, so it is forward-only', async () => {
    const fixture = seededDatabase('restore-exists')
    const result = await createBackup(backupOptions(fixture))
    const destination = join(fixture.storeRoot, '..', 'occupied.db')
    writeFileSync(destination, 'not empty')

    await assert.rejects(
      () => restoreBackup({
        store: fixture.store, artifactId: result.artifactId, destinationPath: destination,
      }),
      (error: unknown) => error instanceof RecoveryError
        && error.code === 'RESTORE_DESTINATION_EXISTS')
    assert.equal(readFileSync(destination, 'utf8'), 'not empty')
  })

  test('restore refuses a destination with a live journal sidecar', async () => {
    const fixture = seededDatabase('restore-journal')
    const result = await createBackup(backupOptions(fixture))
    const destination = join(fixture.storeRoot, '..', 'busy.db')
    writeFileSync(`${destination}-journal`, '')

    await assert.rejects(
      () => restoreBackup({
        store: fixture.store, artifactId: result.artifactId, destinationPath: destination,
      }),
      (error: unknown) => error instanceof RecoveryError
        && error.code === 'RESTORE_DESTINATION_ACTIVE')
  })

  for (const code of [
    'BACKUP_QUICK_CHECK_FAILED',
    'BACKUP_INTEGRITY_CHECK_FAILED',
    'BACKUP_FOREIGN_KEY_CHECK_FAILED',
  ]) {
    test(`${code} removes the restored file and temporary sidecars`, async () => {
      const fixture = seededDatabase(`restore-${code}`)
      const result = await createBackup(backupOptions(fixture))
      const destination = join(fixture.storeRoot, '..', `${code}.db`)

      await assert.rejects(
        () => restoreBackup({
          store: fixture.store,
          artifactId: result.artifactId,
          destinationPath: destination,
          snapshotChecks: (database) => {
            writeFileSync(`${database.name}-journal`, 'temporary')
            throw new RecoveryError(code, 'injected offline check failure')
          },
        }),
        (error: unknown) => error instanceof RecoveryError && error.code === code)

      for (const path of [
        destination,
        `${destination}-journal`,
        `${destination}-wal`,
        `${destination}-shm`,
      ]) {
        assert.equal(existsSync(path), false, `${path} must be removed`)
      }
      assertNoRestoreTemps(join(destination, '..'))
    })
  }

  test('a failed artifact fetch removes partial destination bytes', async () => {
    const fixture = seededDatabase('restore-partial-fetch')
    const result = await createBackup(backupOptions(fixture))
    const destination = join(fixture.storeRoot, '..', 'partial-fetch.db')
    const failingStore = {
      ...fixture.store,
      async fetchToFile(_key: string, target: string): Promise<never> {
        writeFileSync(target, 'partial SQLite bytes')
        writeFileSync(`${target}-journal`, 'temporary')
        throw new ArtifactStoreError('ARTIFACT_FETCH_FAILED', 'injected fetch failure')
      },
    }

    await assert.rejects(
      () => restoreBackup({
        store: failingStore,
        artifactId: result.artifactId,
        destinationPath: destination,
      }),
      (error: unknown) => error instanceof ArtifactStoreError
        && error.code === 'ARTIFACT_FETCH_FAILED')
    assert.equal(existsSync(destination), false)
    assert.equal(existsSync(`${destination}-journal`), false)
    assertNoRestoreTemps(join(destination, '..'))
  })

  test('a concurrent destination creator wins without being overwritten or deleted', async () => {
    const fixture = seededDatabase('restore-race')
    const result = await createBackup(backupOptions(fixture))
    const destination = join(fixture.storeRoot, '..', 'raced.db')
    const racingStore = {
      ...fixture.store,
      async fetchToFile(key: string, target: string) {
        const stored = await fixture.store.fetchToFile(key, target)
        writeFileSync(destination, 'created by another process')
        return stored
      },
    }

    await assert.rejects(
      () => restoreBackup({
        store: racingStore,
        artifactId: result.artifactId,
        destinationPath: destination,
      }),
      (error: unknown) => error instanceof RecoveryError
        && error.code === 'RESTORE_DESTINATION_EXISTS')
    assert.equal(readFileSync(destination, 'utf8'), 'created by another process')
    assertNoRestoreTemps(join(destination, '..'))
  })

  test('a raced sidecar is preserved because this restore did not create it', async () => {
    const fixture = seededDatabase('restore-sidecar-race')
    const result = await createBackup(backupOptions(fixture))
    const destination = join(fixture.storeRoot, '..', 'sidecar-raced.db')
    const sidecar = `${destination}-journal`
    const racingStore = {
      ...fixture.store,
      async fetchToFile(key: string, target: string) {
        const stored = await fixture.store.fetchToFile(key, target)
        writeFileSync(sidecar, 'owned by another process')
        return stored
      },
    }

    await assert.rejects(
      () => restoreBackup({
        store: racingStore,
        artifactId: result.artifactId,
        destinationPath: destination,
      }),
      (error: unknown) => error instanceof RecoveryError
        && error.code === 'RESTORE_DESTINATION_ACTIVE')
    assert.equal(existsSync(destination), false)
    assert.equal(readFileSync(sidecar, 'utf8'), 'owned by another process')
    assertNoRestoreTemps(join(destination, '..'))
  })

  test('a path replacement after exclusive create is preserved and never overwritten', async () => {
    const fixture = seededDatabase('restore-post-reservation-race')
    const result = await createBackup(backupOptions(fixture))
    const destination = join(fixture.storeRoot, '..', 'post-reservation-raced.db')

    await assert.rejects(
      () => restoreBackup({
        store: fixture.store,
        artifactId: result.artifactId,
        destinationPath: destination,
        afterDestinationReserved: () => {
          rmSync(destination)
          writeFileSync(destination, 'replacement owned by another process')
        },
      }),
      (error: unknown) => error instanceof RecoveryError
        && error.code === 'RESTORE_DESTINATION_RACED')
    assert.equal(readFileSync(destination, 'utf8'), 'replacement owned by another process')
    assertNoRestoreTemps(join(destination, '..'))
  })
})

describe('recovery never runs implicitly', () => {
  test('starting the server and serving requests performs no integrity work', async () => {
    const server = await startTestServer({ label: 'no-recovery', verifier: stubVerifier({}) })
    try {
      // A running instance must leave no snapshot, manifest or work directory
      // beside its database, and must not create an artifact store.
      await server.fetchJson('/api/live')
      await server.fetchJson('/api/ready')
      await server.fetchJson('/api/version')

      const dbPath = server.database.path
      for (const sidecar of ['-wal', '-shm', '.pre-delete-mode.bak']) {
        assert.ok(!existsSync(`${dbPath}${sidecar}`), `${sidecar} must not be created`)
      }
      assert.ok(!existsSync(join(dbPath, '..', '.recovery-work')))
    } finally {
      await server.close()
    }
  })
})
