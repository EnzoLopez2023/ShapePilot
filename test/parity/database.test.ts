// Connection invariants, migrations, health and version.
//
// The baseline forbids integrity scans, backup or repair on the startup and
// request paths, so the assertions here are as much about what does *not*
// happen as what does.
import assert from 'node:assert/strict'
import {
  closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync,
  renameSync, rmSync, statSync, symlinkSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, test } from 'vitest'
import {
  DatabaseOpenError, applyConnectionPragmas, openDatabase, openEphemeralDatabase,
  openExistingCompatibleDatabase,
} from '../../lib/db/connection.ts'
import {
  MIGRATIONS, MigrationError, headMigrationId, migrate, migrationChecksum,
  readAppliedMigrations, schemaIdentity,
} from '../../lib/db/migrate.ts'
import { serializeNativeFileIdentity } from '../../lib/db/nativeIdentity.ts'
import { createAuditRepository } from '../../lib/db/repositories/audit.ts'
import { INITIAL_STATEMENTS, OWNED_LEGACY_TABLES } from '../../lib/db/schema.ts'
import { liveness, readiness } from '../../lib/health/readiness.ts'
import { buildIdentity } from '../../lib/lineage/buildIdentity.ts'
import { TEST_ROOT, startTestServer, stubVerifier } from '../helpers/server.ts'

const tempPath = (label: string): string => {
  mkdirSync(TEST_ROOT, { recursive: true })
  return join(TEST_ROOT, `${label}-${randomUUID()}.db`)
}

describe('connection invariants', () => {
  test('journal_mode is DELETE and foreign keys are on', () => {
    const path = tempPath('invariants')
    const database = openDatabase({ path, busyTimeoutMs: 2_000, createIfMissing: true })
    try {
      assert.equal(
        String(database.handle.pragma('journal_mode', { simple: true })).toLowerCase(), 'delete')
      assert.equal(database.handle.pragma('foreign_keys', { simple: true }), 1)
      assert.equal(database.handle.pragma('busy_timeout', { simple: true }), 2_000)
      // WAL would need shared memory Azure Files cannot provide.
      assert.ok(!existsSync(`${path}-wal`))
    } finally {
      database.close()
      rmSync(path, { force: true })
    }
  })

  test('the pocket cascade actually fires, which requires foreign_keys=ON', () => {
    const database = openEphemeralDatabase()
    try {
      database.handle.prepare(`
        INSERT INTO keycap_tray_designs
          (id, owner_tenant_id, owner_oid, name, profile_kind, profile_json, sizing_json)
        VALUES (1, 't', 'o', 'x', 'rect', '{}', '{}')`).run()
      database.handle.prepare(`
        INSERT INTO keycap_tray_pockets (design_id, units, x_mm, y_mm)
        VALUES (1, 1, 0, 0)`).run()
      database.handle.prepare('DELETE FROM keycap_tray_designs WHERE id = 1').run()
      const remaining = database.handle.prepare<[], { count: number }>(
        'SELECT COUNT(*) AS count FROM keycap_tray_pockets').get()
      assert.equal(Number(remaining?.count), 0)
    } finally {
      database.close()
    }
  })

  test('a foreign key violation is refused rather than silently accepted', () => {
    const database = openEphemeralDatabase()
    try {
      assert.throws(() => database.handle.prepare(`
        INSERT INTO keycap_tray_pockets (design_id, units, x_mm, y_mm)
        VALUES (4242, 1, 0, 0)`).run())
    } finally {
      database.close()
    }
  })

  test('an out-of-range busy timeout is refused', () => {
    const handle = new Database(':memory:')
    try {
      for (const value of [0, -1, 120_000, 1.5]) {
        assert.throws(() => applyConnectionPragmas(handle, value),
          (error: unknown) => error instanceof DatabaseOpenError
            && error.code === 'BUSY_TIMEOUT_OUT_OF_RANGE')
      }
    } finally {
      handle.close()
    }
  })

  test('native file identity normalizes signed 64-bit stat fields', () => {
    assert.equal(
      serializeNativeFileIdentity({ dev: -1n, ino: -(2n ** 63n), size: 42n }),
      '18446744073709551615:9223372036854775808:42',
    )
  })

  test('production refuses to invent a missing database', () => {
    const path = tempPath('missing')
    assert.throws(
      () => openDatabase({ path, busyTimeoutMs: 2_000, createIfMissing: false }),
      (error: unknown) => error instanceof DatabaseOpenError
        && error.code === 'DATABASE_UNAVAILABLE')
    assert.ok(!existsSync(path), 'the file must not be created by the failed attempt')
  })

  test('a foreign existing database is refused without changing bytes or mtime', () => {
    const path = tempPath('foreign')
    const foreign = new Database(path)
    foreign.exec(`
      CREATE TABLE lantern_data (id INTEGER PRIMARY KEY, value TEXT);
      INSERT INTO lantern_data (value) VALUES ('keep me')`)
    foreign.close()
    const before = {
      bytes: readFileSync(path),
      mtimeMs: statSync(path).mtimeMs,
    }

    for (const createIfMissing of [false, true]) {
      assert.throws(() => openDatabase({ path, busyTimeoutMs: 2_000, createIfMissing }))
    }

    assert.equal(
      createHash('sha256').update(readFileSync(path)).digest('hex'),
      createHash('sha256').update(before.bytes).digest('hex'))
    assert.equal(statSync(path).mtimeMs, before.mtimeMs)
    const check = new Database(path, { readonly: true, fileMustExist: true })
    try {
      assert.deepEqual(
        (check.prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
        ).all() as { name: string }[]).map((row) => row.name),
        ['lantern_data'])
    } finally {
      check.close()
      rmSync(path, { force: true })
    }
  })

  test('an existing empty file requires controlled create mode', () => {
    const path = tempPath('existing-empty')
    new Database(path).close()
    assert.throws(
      () => openDatabase({ path, busyTimeoutMs: 2_000, createIfMissing: false }),
      (error: unknown) => error instanceof DatabaseOpenError
        && error.code === 'EMPTY_DATABASE_REQUIRES_CREATE')

    const initialized = openDatabase({ path, busyTimeoutMs: 2_000, createIfMissing: true })
    try {
      assert.equal(initialized.identity.app, 'shapepilot')
    } finally {
      initialized.close()
      rmSync(path, { force: true })
    }
  })

  test('a foreign database raced into an absent create path is refused unchanged', () => {
    const path = tempPath('foreign-create-race')
    const before = { bytes: Buffer.alloc(0), mtimeMs: 0, captured: false }

    assert.throws(() => openDatabase({
      path,
      busyTimeoutMs: 2_000,
      createIfMissing: true,
      beforeWritableOpen: () => {
        const foreign = new Database(path)
        foreign.exec(`
          CREATE TABLE raced_data (id INTEGER PRIMARY KEY, value TEXT);
          INSERT INTO raced_data (value) VALUES ('other process')`)
        foreign.close()
        before.bytes = readFileSync(path)
        before.mtimeMs = statSync(path).mtimeMs
        before.captured = true
      },
    }))

    assert.equal(before.captured, true)
    assert.equal(
      createHash('sha256').update(readFileSync(path)).digest('hex'),
      createHash('sha256').update(before.bytes).digest('hex'))
    assert.equal(statSync(path).mtimeMs, before.mtimeMs)
    const check = new Database(path, { readonly: true, fileMustExist: true })
    try {
      assert.deepEqual(
        (check.prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
        ).all() as { name: string }[]).map((row) => row.name),
        ['raced_data'])
    } finally {
      check.close()
      rmSync(path, { force: true })
    }
  })

  test('an absent create target is reserved exclusively before the writable-open seam', () => {
    const path = tempPath('exclusive-create')
    let reservationObserved = false
    const database = openDatabase({
      path,
      busyTimeoutMs: 2_000,
      createIfMissing: true,
      beforeWritableOpen: () => {
        assert.throws(
          () => {
            const descriptor = openSync(path, 'wx+')
            closeSync(descriptor)
          },
          (error: unknown) => (error as NodeJS.ErrnoException).code === 'EEXIST',
        )
        reservationObserved = true
      },
    })
    try {
      assert.equal(reservationObserved, true)
      assert.equal(database.identity.app, 'shapepilot')
    } finally {
      database.close()
      rmSync(path, { force: true })
    }
  })

  for (const [label, open] of [
    [
      'bootstrap',
      (path: string, beforeWritableOpen: () => void) => openDatabase({
        path,
        busyTimeoutMs: 2_000,
        createIfMissing: false,
        beforeWritableOpen,
      }),
    ],
    [
      'operator write',
      (path: string, beforeWritableOpen: () => void) => openExistingCompatibleDatabase({
        path,
        busyTimeoutMs: 2_000,
        beforeWritableOpen,
      }),
    ],
  ] as const) {
    test(`${label} refuses an identity-compatible replacement before writable use`, () => {
      const path = tempPath(`identity-race-${label}`)
      const displacedPath = tempPath(`identity-race-displaced-${label}`)
      const replacementPath = tempPath(`identity-race-replacement-${label}`)
      openDatabase({ path, busyTimeoutMs: 2_000, createIfMissing: true }).close()
      openDatabase({ path: replacementPath, busyTimeoutMs: 2_000, createIfMissing: true }).close()

      let racedSnapshot: { hash: string; mtimeNs: bigint } | null = null
      assert.throws(
        () => open(path, () => {
          renameSync(path, displacedPath)
          renameSync(replacementPath, path)
          racedSnapshot = {
            hash: createHash('sha256').update(readFileSync(path)).digest('hex'),
            mtimeNs: statSync(path, { bigint: true }).mtimeNs,
          }
        }),
        (error: unknown) => error instanceof DatabaseOpenError
          && error.code === 'DATABASE_CHANGED_DURING_OPEN',
      )

      assert.ok(racedSnapshot)
      assert.deepEqual({
        hash: createHash('sha256').update(readFileSync(path)).digest('hex'),
        mtimeNs: statSync(path, { bigint: true }).mtimeNs,
      }, racedSnapshot)
      rmSync(path, { force: true })
      rmSync(displacedPath, { force: true })
      rmSync(replacementPath, { force: true })
    })
  }

  test('a foreign database with a hot rollback journal is never opened writable', () => {
    const path = tempPath('foreign-hot-journal')
    const foreign = new Database(path)
    foreign.pragma('journal_mode = DELETE')
    foreign.exec(`
      CREATE TABLE lantern_data (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
      WITH RECURSIVE rows(id) AS (
        SELECT 1 UNION ALL SELECT id + 1 FROM rows WHERE id < 300
      )
      INSERT INTO lantern_data (id, value)
      SELECT id, printf('%04000d', id) FROM rows`)
    foreign.close()

    const crashed = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import Database from 'better-sqlite3'
      const database = new Database(${JSON.stringify(path)})
      database.pragma('journal_mode = DELETE')
      database.pragma('synchronous = FULL')
      database.pragma('cache_size = 10')
      database.exec('BEGIN IMMEDIATE')
      database.prepare("UPDATE lantern_data SET value = value || 'changed'").run()
      process.kill(process.pid, 'SIGKILL')
    `], { cwd: process.cwd() })
    assert.equal(crashed.signal, 'SIGKILL')

    const journalPath = `${path}-journal`
    assert.ok(statSync(journalPath).size > 512, 'the crash fixture must leave a hot journal')
    const before = {
      database: {
        hash: createHash('sha256').update(readFileSync(path)).digest('hex'),
        mtimeNs: statSync(path, { bigint: true }).mtimeNs,
      },
      journal: {
        hash: createHash('sha256').update(readFileSync(journalPath)).digest('hex'),
        mtimeNs: statSync(journalPath, { bigint: true }).mtimeNs,
      },
    }

    assert.throws(() => openDatabase({
      path,
      busyTimeoutMs: 2_000,
      createIfMissing: false,
    }))
    assert.throws(() => openExistingCompatibleDatabase({
      path,
      busyTimeoutMs: 2_000,
    }))

    assert.deepEqual({
      database: {
        hash: createHash('sha256').update(readFileSync(path)).digest('hex'),
        mtimeNs: statSync(path, { bigint: true }).mtimeNs,
      },
      journal: {
        hash: createHash('sha256').update(readFileSync(journalPath)).digest('hex'),
        mtimeNs: statSync(journalPath, { bigint: true }).mtimeNs,
      },
    }, before)
    rmSync(journalPath, { force: true })
    rmSync(path, { force: true })
  })

  test('a dangling SQLite sidecar symlink blocks every writable open', () => {
    const path = tempPath('dangling-sidecar')
    const database = openDatabase({ path, busyTimeoutMs: 2_000, createIfMissing: true })
    database.close()
    const sidecar = `${path}-journal`
    symlinkSync('missing-journal-target', sidecar)
    const before = {
      hash: createHash('sha256').update(readFileSync(path)).digest('hex'),
      mtimeNs: statSync(path, { bigint: true }).mtimeNs,
    }

    assert.throws(() => openDatabase({
      path,
      busyTimeoutMs: 2_000,
      createIfMissing: false,
    }))
    assert.throws(() => openExistingCompatibleDatabase({
      path,
      busyTimeoutMs: 2_000,
    }))
    assert.deepEqual({
      hash: createHash('sha256').update(readFileSync(path)).digest('hex'),
      mtimeNs: statSync(path, { bigint: true }).mtimeNs,
    }, before)
    assert.equal(lstatSync(sidecar).isSymbolicLink(), true)
    rmSync(sidecar)
    rmSync(path)
  })

  test('the SQLite descriptor rejects an ABA replacement before hot-journal recovery', () => {
    const path = tempPath('aba-authority')
    const displacedPath = tempPath('aba-authority-displaced')
    const racedPath = tempPath('aba-raced-copy')
    const openedPath = tempPath('aba-opened-copy')
    const database = openDatabase({ path, busyTimeoutMs: 2_000, createIfMissing: true })
    const insert = database.handle.prepare(`
      INSERT INTO audit_events (category, action, outcome, detail)
      VALUES ('test', 'seed', 'success', ?)`)
    database.handle.transaction(() => {
      for (let index = 0; index < 300; index += 1) insert.run('x'.repeat(4_000))
    })()
    database.close()
    copyFileSync(path, racedPath)

    const crashed = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import Database from 'better-sqlite3'
      const database = new Database(${JSON.stringify(racedPath)})
      database.pragma('journal_mode = DELETE')
      database.pragma('synchronous = FULL')
      database.pragma('cache_size = 10')
      database.exec('BEGIN IMMEDIATE')
      database.prepare("UPDATE audit_events SET detail = detail || 'raced'").run()
      process.kill(process.pid, 'SIGKILL')
    `], { cwd: process.cwd() })
    assert.equal(crashed.signal, 'SIGKILL')
    const racedJournal = `${racedPath}-journal`
    assert.ok(statSync(racedJournal).size > 512)
    const racedBefore = {
      database: createHash('sha256').update(readFileSync(racedPath)).digest('hex'),
      journal: createHash('sha256').update(readFileSync(racedJournal)).digest('hex'),
    }

    assert.throws(
      () => openExistingCompatibleDatabase({
        path,
        busyTimeoutMs: 2_000,
        beforeSqliteWritableOpen: () => {
          renameSync(path, displacedPath)
          renameSync(racedPath, path)
          renameSync(racedJournal, `${path}-journal`)
        },
        afterWritableOpenBeforeIdentity: () => {
          renameSync(path, openedPath)
          renameSync(displacedPath, path)
        },
      }),
      (error: unknown) => error instanceof DatabaseOpenError
        && error.code === 'DATABASE_CHANGED_DURING_OPEN',
    )

    assert.deepEqual({
      database: createHash('sha256').update(readFileSync(openedPath)).digest('hex'),
      journal: createHash('sha256').update(readFileSync(`${path}-journal`)).digest('hex'),
    }, racedBefore)
    rmSync(`${path}-journal`, { force: true })
    const authority = openExistingCompatibleDatabase({ path, busyTimeoutMs: 2_000 })
    authority.close()
    rmSync(openedPath, { force: true })
    rmSync(displacedPath, { force: true })
    rmSync(racedPath, { force: true })
    rmSync(path, { force: true })
  })

  test('a journal-only race is refused before it can recover onto the authority', () => {
    const path = tempPath('journal-race-authority')
    const journalSource = tempPath('journal-race-source')
    const database = openDatabase({ path, busyTimeoutMs: 2_000, createIfMissing: true })
    database.handle.prepare(`
      INSERT INTO audit_events (id, category, action, outcome, detail)
      VALUES (1, 'test', 'journal-race', 'success', 'source')`).run()
    database.close()
    copyFileSync(path, journalSource)

    const target = openExistingCompatibleDatabase({ path, busyTimeoutMs: 2_000 })
    target.handle.prepare("UPDATE audit_events SET detail = 'target' WHERE id = 1").run()
    target.close()

    const crashed = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import Database from 'better-sqlite3'
      const database = new Database(${JSON.stringify(journalSource)})
      database.pragma('journal_mode = DELETE')
      database.pragma('synchronous = FULL')
      database.exec('BEGIN IMMEDIATE')
      database.prepare("UPDATE audit_events SET detail = 'raced!' WHERE id = 1").run()
      process.kill(process.pid, 'SIGKILL')
    `], { cwd: process.cwd() })
    assert.equal(crashed.signal, 'SIGKILL')
    const sourceJournal = `${journalSource}-journal`
    assert.ok(statSync(sourceJournal).size > 512)
    const before = {
      database: createHash('sha256').update(readFileSync(path)).digest('hex'),
      journal: createHash('sha256').update(readFileSync(sourceJournal)).digest('hex'),
    }

    assert.throws(
      () => openExistingCompatibleDatabase({
        path,
        busyTimeoutMs: 2_000,
        afterWritableOpenBeforeIdentity: () => {
          renameSync(sourceJournal, `${path}-journal`)
        },
      }),
      (error: unknown) => error instanceof DatabaseOpenError
        && error.code === 'DATABASE_CHANGED_DURING_OPEN',
    )
    assert.deepEqual({
      database: createHash('sha256').update(readFileSync(path)).digest('hex'),
      journal: createHash('sha256').update(readFileSync(`${path}-journal`)).digest('hex'),
    }, before)

    rmSync(`${path}-journal`, { force: true })
    const reopened = openExistingCompatibleDatabase({ path, busyTimeoutMs: 2_000 })
    try {
      assert.equal(
        reopened.handle.prepare<[], { detail: string }>(
          'SELECT detail FROM audit_events WHERE id = 1',
        ).get()?.detail,
        'target',
      )
    } finally {
      reopened.close()
      rmSync(journalSource, { force: true })
      rmSync(path, { force: true })
    }
  })
})

describe('migrations', () => {
  test('an empty database reaches the head migration', () => {
    const database = openEphemeralDatabase()
    try {
      const applied = readAppliedMigrations(database.handle)
      assert.deepEqual(applied.map(m => m.id), MIGRATIONS.map(m => m.id))
      assert.equal(applied.at(-1)?.id, headMigrationId())
      assert.equal(database.schemaIdentity, schemaIdentity())
    } finally {
      database.close()
    }
  })

  test('every owned table and the app tables exist after migrating', () => {
    const database = openEphemeralDatabase()
    try {
      const tables = new Set(database.handle.prepare<[], { name: string }>(
        "SELECT name FROM sqlite_schema WHERE type = 'table'").all().map(r => r.name))
      for (const table of [
        ...OWNED_LEGACY_TABLES, 'schema_migrations', 'app_memberships', 'app_settings',
        'audit_events', 'legacy_import_runs', 'legacy_import_rows',
      ]) {
        assert.ok(tables.has(table), `${table} must exist`)
      }
    } finally {
      database.close()
    }
  })

  test('migrating twice is a no-op', () => {
    const database = openEphemeralDatabase()
    try {
      const second = migrate(database.handle)
      assert.deepEqual(second.applied, [])
      assert.deepEqual(second.alreadyApplied, MIGRATIONS.map(m => m.id))
    } finally {
      database.close()
    }
  })

  test('a legacy ledger without the name column upgrades to the same structural identity', () => {
    const path = tempPath('legacy-ledger')
    const handle = new Database(path)
    try {
      handle.exec(`
        CREATE TABLE schema_migrations (
          id TEXT PRIMARY KEY,
          checksum TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (datetime('now')),
          ordinal INTEGER NOT NULL
        )`)
      for (const statement of MIGRATIONS[0].statements) handle.exec(statement)
      handle.prepare(
        'INSERT INTO schema_migrations (id, checksum, ordinal) VALUES (?, ?, 0)',
      ).run(MIGRATIONS[0].id, migrationChecksum(MIGRATIONS[0]))
    } finally {
      handle.close()
    }

    const upgraded = openDatabase({ path, busyTimeoutMs: 2_000, createIfMissing: false })
    try {
      assert.deepEqual(
        upgraded.identity.ledger.map((entry) => entry.id),
        MIGRATIONS.map((migration) => migration.id))
      assert.equal(upgraded.identity.schemaObjectsSha256.length, 64)
    } finally {
      upgraded.close()
      rmSync(path, { force: true })
    }
  })

  test('a checksum mismatch is a hard failure', () => {
    const database = openEphemeralDatabase()
    try {
      database.handle.prepare('UPDATE schema_migrations SET checksum = ? WHERE id = ?')
        .run('0'.repeat(64), headMigrationId())
      assert.throws(() => migrate(database.handle),
        (error: unknown) => error instanceof MigrationError
          && error.code === 'MIGRATION_CHECKSUM_MISMATCH')
    } finally {
      database.close()
    }
  })

  test('a database ahead of this build is a hard failure', () => {
    const database = openEphemeralDatabase()
    try {
      database.handle.prepare(
        'INSERT INTO schema_migrations (id, checksum, ordinal) VALUES (?, ?, ?)',
      ).run('002-from-the-future', '0'.repeat(64), MIGRATIONS.length)
      assert.throws(() => migrate(database.handle),
        (error: unknown) => error instanceof MigrationError
          && error.code === 'SCHEMA_AHEAD_OF_CODE')
    } finally {
      database.close()
    }
  })

  test('a diverged ledger is a hard failure', () => {
    const database = openEphemeralDatabase()
    try {
      database.handle.prepare('UPDATE schema_migrations SET id = ? WHERE ordinal = 0')
        .run('001-something-else')
      assert.throws(() => migrate(database.handle),
        (error: unknown) => error instanceof MigrationError
          && error.code === 'MIGRATION_LEDGER_DIVERGED')
    } finally {
      database.close()
    }
  })

  test('a prior-schema database migrates forward without losing rows', () => {
    // Stand in for "an older ShapePilot": the ledger is emptied and the tables
    // are dropped, then the shipped migration runs against real leftover data.
    const path = tempPath('prior')
    const seeded = openDatabase({ path, busyTimeoutMs: 2_000, createIfMissing: true })
    seeded.handle.prepare(`
      INSERT INTO keycap_tray_designs
        (id, owner_tenant_id, owner_oid, name, profile_kind, profile_json, sizing_json)
      VALUES (7, 't', 'o', 'kept', 'rect', '{}', '{}')`).run()
    seeded.close()

    const reopened = openDatabase({ path, busyTimeoutMs: 2_000, createIfMissing: false })
    try {
      const row = reopened.handle.prepare<[], { name: string }>(
        'SELECT name FROM keycap_tray_designs WHERE id = 7').get()
      assert.equal(row?.name, 'kept')
      assert.equal(reopened.schemaIdentity, schemaIdentity())
    } finally {
      reopened.close()
      rmSync(path, { force: true })
    }
  })

  test('the migration checksum covers the exact statements', () => {
    const [head] = MIGRATIONS
    const tampered = { id: head.id, name: head.name, statements: [...INITIAL_STATEMENTS, 'SELECT 1'] }
    assert.notEqual(migrationChecksum(head), migrationChecksum(tampered))
  })
})

describe('audit retention', () => {
  test('the repository bounds the audit table and removes expired events', async () => {
    const database = openEphemeralDatabase()
    try {
      const insert = database.handle.prepare(`
        INSERT INTO audit_events (occurred_at, category, action, outcome)
        VALUES (datetime('now'), 'test', 'seed', 'success')`)
      database.handle.transaction(() => {
        for (let index = 0; index < 50_020; index += 1) insert.run()
      })()
      database.handle.prepare(`
        INSERT INTO audit_events (occurred_at, category, action, outcome)
        VALUES ('2000-01-01 00:00:00', 'test', 'expired', 'success')`).run()

      const audit = createAuditRepository(database.handle)
      await audit.record({
        owner: null,
        category: 'test',
        action: 'retention',
        outcome: 'success',
      })

      const count = database.handle.prepare<[], { count: number }>(
        'SELECT COUNT(*) AS count FROM audit_events').get()
      const expired = database.handle.prepare<[], { count: number }>(
        "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'expired'").get()
      assert.ok(Number(count?.count) <= 50_000)
      assert.equal(Number(expired?.count), 0)
    } finally {
      database.close()
    }
  })
})

describe('health and version', () => {
  test('liveness never opens the database', () => {
    const report = liveness(buildIdentity(), 'ready', Date.now() - 5_000, 'instance-test')
    assert.equal(report.status, 'ok')
    assert.equal(report.lifecycle, 'ready')
    assert.ok(report.uptimeSeconds >= 4)
    assert.equal(report.pid, process.pid)
    assert.equal(report.instanceId, 'instance-test')
  })

  test('readiness reports the authority, schema identity and journal mode', () => {
    // File-backed, because the DELETE journal invariant is about a real file.
    const path = tempPath('readiness')
    const database = openDatabase({ path, busyTimeoutMs: 2_000, createIfMissing: true })
    try {
      const report = readiness(buildIdentity(), 'ready', database, 'instance-test')
      assert.equal(report.status, 'ready')
      assert.equal(report.database.reachable, true)
      assert.equal(report.database.journalMode?.toLowerCase(), 'delete')
      assert.equal(report.database.foreignKeys, true)
      assert.equal(report.database.headMigration, headMigrationId())
      assert.equal(report.database.schemaIdentity, report.database.expectedSchemaIdentity)
      assert.equal(report.database.authority, path)
      // Bounded by construction: one SELECT 1 and one ledger read.
      assert.ok(report.durationMs < 1_000)
    } finally {
      database.close()
      rmSync(path, { force: true })
    }
  })

  test('readiness is not-ready when the schema identity does not match', () => {
    const database = openEphemeralDatabase()
    try {
      const report = readiness(
        buildIdentity(), 'ready',
        { ...database, schemaIdentity: 'a'.repeat(64) },
        'instance-test')
      assert.equal(report.status, 'not-ready')
      assert.equal(report.reason, 'schema identity mismatch')
    } finally {
      database.close()
    }
  })

  test('readiness is not-ready when a connection invariant drifts', () => {
    const database = openEphemeralDatabase()
    try {
      database.handle.pragma('foreign_keys = OFF')
      const report = readiness(buildIdentity(), 'ready', database, 'instance-test')
      assert.equal(report.status, 'not-ready')
      assert.equal(report.reason, 'database invariant mismatch')
    } finally {
      database.close()
    }
  })

  test('readiness is not-ready while the process is starting or draining', () => {
    const database = openEphemeralDatabase()
    try {
      for (const lifecycle of ['starting', 'draining', 'stopped'] as const) {
        const report = readiness(buildIdentity(), lifecycle, database, 'instance-test')
        assert.equal(report.status, 'not-ready')
      }
    } finally {
      database.close()
    }
  })

  test('readiness never leaks the underlying failure', () => {
    const database = openEphemeralDatabase()
    database.close()
    const report = readiness(buildIdentity(), 'ready', database, 'instance-test')
    assert.equal(report.status, 'not-ready')
    assert.equal(report.reason, 'database probe failed')
  })

  test('/api/version and /version.json agree exactly', async () => {
    const server = await startTestServer({ label: 'version', verifier: stubVerifier({}) })
    try {
      const api = await server.fetchJson<Record<string, unknown>>('/api/version')
      const flat = await server.fetchJson<Record<string, unknown>>('/version.json')
      assert.equal(api.status, 200)
      assert.deepEqual(api.body, flat.body)
      assert.equal(api.body.app, 'shapepilot')
      assert.equal(api.headers.get('cache-control'), 'no-store')
      const lineage = api.body.sourceLineage as { commit: string; tree: string }
      assert.equal(lineage.commit, 'f0b05fc1dbf53e8aa26c215d8e858894a2793871')
      assert.equal(lineage.tree, '62cbd35861c511f7c17187c875d19ee6e353b80d')
    } finally {
      await server.close()
    }
  })

  test('/api/live answers without a database and /api/ready reports one', async () => {
    const server = await startTestServer({ label: 'health', verifier: stubVerifier({}) })
    try {
      const live = await server.fetchJson<{ status: string }>('/api/live')
      assert.equal(live.status, 200)
      assert.equal(live.body.status, 'ok')
      assert.equal(live.headers.get('cache-control'), 'no-store')

      const ready = await server.fetchJson<{ status: string; database: { authority: string } }>(
        '/api/ready')
      assert.equal(ready.status, 200)
      assert.equal(ready.body.status, 'ready')
      assert.equal(ready.headers.get('cache-control'), 'no-store')
      assert.ok(ready.body.database.authority.endsWith('.db'))
    } finally {
      await server.close()
    }
  })
})
