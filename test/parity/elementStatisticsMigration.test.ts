import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  rmSync, statSync, symlinkSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, test } from 'vitest'
import { applyConnectionPragmas, openDatabase, openEphemeralDatabase } from '../../lib/db/connection.ts'
import { IdentityError } from '../../lib/db/identity.ts'
import {
  MIGRATIONS, MigrationError, codeIdentity, codeLedger, headMigrationId, migrate,
  migrationChecksum, readAppliedMigrations, schemaIdentity,
} from '../../lib/db/migrate.ts'
import { migration012 } from '../../lib/db/migrations/012-element-statistics.ts'
import { canonicalTableHashFromDatabase } from '../../lib/legacy/canonicalTable.ts'
import { TEST_ROOT } from '../helpers/server.ts'

// This suite pins migration 012 in its own place in the ledger, not at the head
// of it -- later migrations are appended after 012 and must not be able to
// change what 012 did. So every hash below is taken at a fixed DEPTH, and the
// assertions about the *current* head derive from the migration list rather
// than naming 012. Anything about table contents is compared at 012's depth
// too, since a later migration may alter an older table on purpose.
const PRIOR_DEPTH = 11
const DEPTH = 12
const PRIOR_SCHEMA_MARKER = 'c30b97aae3301d399298ab392ab03756ebf569a5336b12a79086b0a7b882ad30'
const PRIOR_SCHEMA_OBJECTS = '1e376a0e2e9aa01d7744bfa754fb2743fef5e3c0bb55e09818b05e26afb116ac'
const SCHEMA_MARKER_AT_012 = '13efbd91dd3c4a739aba623d9591ce275ee13c85efbe4090f78616e24331191b'
const SCHEMA_OBJECTS_AT_012 = '7a55db069f509a97c5c7a8e63f7803de8e92958a08b520a8afe944109ebaa819'
/** Every migration up to and including 012, whatever has been appended since. */
const THROUGH_012 = () => MIGRATIONS.slice(0, DEPTH)
const MIGRATION_CHECKSUM = 'a365f8e40ade0f91a49b3248fe3f478a3d66c7cb24dd45e6af6c838a30d1318c'
const EMPTY_TABLE_HASHES = {
  element_statistics_connections: '9ca718f052347c31f15fc0d8990ac6d7cb3e77a16330006714d68dc2ca15f07a',
  element_statistics_settings: 'ee2fb823bc71011f83d8b15b211eceeca9f77331655b6bbc109308b6e785ee47',
  element_statistics_sync_state: '5684f078c53ec8a4cc5857ff43defd4acdfc1e21b7edb5c55ee970447bdd48eb',
  element_statistics_jobs: '17c6d9c98520e0e8be8b552ed13f915bea4f4d03c3b905afbdc53a5757a7483b',
  element_statistics_telemetry: '05e6909cd5beacecd8c1a6eff2c7b980db0bdd64b595714f1053db7ad8b67288',
  element_statistics_events: 'c64d2343394c83e1c7c28f055af875b07d6719dbf1ba6bd3e6bf725f9507390b',
}

const paths: string[] = []
const fixturePath = (): string => {
  mkdirSync(TEST_ROOT, { recursive: true })
  const path = join(TEST_ROOT, `element-migration-${randomUUID()}.db`)
  paths.push(path)
  return path
}
afterEach(() => {
  for (const path of paths.splice(0)) {
    for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true })
  }
})

function seedPriorDomainRows(database: Database.Database): void {
  database.exec(`
    INSERT INTO app_memberships (tenant_id, oid, role, display_name)
      VALUES ('fixture-tenant', 'fixture-owner', 'admin', 'Previous release fixture');
    INSERT INTO app_settings (tenant_id, oid, settings_json)
      VALUES ('fixture-tenant', 'fixture-owner', '{"themeMode":"dark"}');
    INSERT INTO audit_events (category, action, outcome)
      VALUES ('fixture', 'create', 'success');
    INSERT INTO keycap_tray_designs
      (id, owner_tenant_id, owner_oid, name, profile_kind, profile_json, sizing_json)
      VALUES (7, 'fixture-tenant', 'fixture-owner', 'Original keycap tray', 'rect', '{}', '{}');
    INSERT INTO keycap_tray_pockets (design_id, units, x_mm, y_mm)
      VALUES (7, 1, 10, 20);
    INSERT INTO filament_inventory (owner_tenant_id, owner_oid, filament_key, variant)
      VALUES ('fixture-tenant', 'fixture-owner', 'fixture-filament', 'spool');
    INSERT INTO switch_tray_designs
      (owner_tenant_id, owner_oid, name, profile_kind, profile_json, switch_json, plate_json, fill_json)
      VALUES ('fixture-tenant', 'fixture-owner', 'Original switch tray', 'rect', '{}', '{}', '{}', '{}');
    INSERT INTO tool_tray_designs
      (owner_tenant_id, owner_oid, name, profile_kind, profile_json, height_mm,
       layer_height_mm, min_floor_mm, pockets_json, pocket_count)
      VALUES ('fixture-tenant', 'fixture-owner', 'Original tool tray', 'rect', '{}', 30, 0.2, 2, '[]', 0);
  `)
}

const domainHashes = (database: Database.Database) =>
  database.prepare<[], { name: string }>(`
    SELECT name FROM sqlite_schema
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'
    ORDER BY name`).all().map(({ name }) => ({
      name, ...canonicalTableHashFromDatabase(database, name),
    }))

describe('012 EL-ement append-only migration', () => {
  test('the production-image diagnostic uses disposable temp storage, not the read-only application tree', () => {
    mkdirSync(TEST_ROOT, { recursive: true })
    const root = mkdtempSync(join(TEST_ROOT, 'element-diagnostic-'))
    const imageRoot = join(root, 'app')
    const scratch = join(root, 'scratch')
    const sourceRoot = resolve(import.meta.dirname, '../..')
    try {
      mkdirSync(imageRoot)
      mkdirSync(scratch)
      for (const directory of ['lib', 'server', 'scripts', 'native/build']) {
        cpSync(join(sourceRoot, directory), join(imageRoot, directory), { recursive: true })
      }
      cpSync(join(sourceRoot, 'package.json'), join(imageRoot, 'package.json'))
      symlinkSync(join(sourceRoot, 'node_modules'), join(imageRoot, 'node_modules'), 'dir')
      chmodSync(imageRoot, 0o555)
      const result = spawnSync(process.execPath, [
        join(imageRoot, 'scripts/check-deploy-migration.ts'), '--profile', 'sqlite-one-worker',
      ], {
        cwd: imageRoot,
        env: { ...process.env, NODE_ENV: 'production', TMPDIR: scratch },
        encoding: 'utf8',
        timeout: 20_000,
      })
      assert.ifError(result.error)
      assert.equal(result.status, 0, result.stderr)
      const report = JSON.parse(result.stdout) as { status: string; snapshotGuardArmed: boolean }
      assert.equal(report.status, 'ok')
      assert.equal(report.snapshotGuardArmed, true)
      assert.equal(existsSync(join(imageRoot, 'test')), false)
      assert.deepEqual(readdirSync(scratch), [])
    } finally {
      if (existsSync(imageRoot)) chmodSync(imageRoot, 0o755)
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('pins the previous lineage, appended migration, catalog and empty domain table hashes', () => {
    assert.ok(MIGRATIONS.length >= DEPTH)
    assert.equal(MIGRATIONS[DEPTH - 1], migration012)
    assert.deepEqual(codeLedger(THROUGH_012()).at(-1), {
      ordinal: 11, id: '012-element-statistics', name: 'EL-ement statistics', checksum: MIGRATION_CHECKSUM,
    })
    // 012 stays ordinal 11 in the full ledger too: appending never reorders.
    assert.deepEqual(codeLedger()[DEPTH - 1], codeLedger(THROUGH_012()).at(-1))
    assert.equal(schemaIdentity(MIGRATIONS.slice(0, PRIOR_DEPTH)), PRIOR_SCHEMA_MARKER)
    assert.equal(codeIdentity(MIGRATIONS.slice(0, PRIOR_DEPTH)).schemaObjectsSha256, PRIOR_SCHEMA_OBJECTS)
    assert.equal(schemaIdentity(THROUGH_012()), SCHEMA_MARKER_AT_012)
    assert.equal(codeIdentity(THROUGH_012()).schemaObjectsSha256, SCHEMA_OBJECTS_AT_012)
    const database = openEphemeralDatabase()
    try {
      for (const [table, expected] of Object.entries(EMPTY_TABLE_HASHES)) {
        const actual = canonicalTableHashFromDatabase(database.handle, table)
        assert.equal(actual.rowCount, 0, `${table} must have no initial row`)
        assert.equal(actual.hash, expected, `${table} keeps its canonical empty-table contract`)
      }
      assert.equal(database.handle.pragma('integrity_check', { simple: true }), 'ok')
      assert.deepEqual(database.handle.pragma('foreign_key_check'), [])
    } finally {
      database.close()
    }
  })

  test('an actual 011 database upgrades and reopens with every older row and schema object intact', () => {
    const path = fixturePath()
    const prior = new Database(path)
    let hashes: ReturnType<typeof domainHashes>
    let ledger: ReturnType<typeof readAppliedMigrations>
    let objects: { type: string; name: string; sql: string | null }[]
    try {
      applyConnectionPragmas(prior, 2_000, path)
      migrate(prior, MIGRATIONS.slice(0, PRIOR_DEPTH))
      seedPriorDomainRows(prior)
      hashes = domainHashes(prior)
      ledger = readAppliedMigrations(prior)
      objects = prior.prepare<[], { type: string; name: string; sql: string | null }>(`
        SELECT type, name, sql FROM sqlite_schema
        WHERE name NOT LIKE 'sqlite_%' ORDER BY name`).all()
    } finally {
      prior.close()
    }
    // Applying 012 alone must leave every older table and schema object exactly
    // as it was. Asserted at 012's depth, because later migrations are free to
    // change older tables on purpose (014 adds a column to filament_inventory)
    // and that is not something 012 did.
    const through012 = new Database(path)
    try {
      applyConnectionPragmas(through012, 2_000, path)
      assert.deepEqual(migrate(through012, THROUGH_012()).applied, ['012-element-statistics'])
      assert.deepEqual(readAppliedMigrations(through012).slice(0, PRIOR_DEPTH), ledger)
      for (const expected of hashes) {
        assert.deepEqual({
          name: expected.name, ...canonicalTableHashFromDatabase(through012, expected.name),
        }, expected, `${expected.name} data and declared columns are unchanged`)
      }
      const selectObject = through012.prepare<[string], { type: string; name: string; sql: string | null }>(
        'SELECT type, name, sql FROM sqlite_schema WHERE name = ?')
      for (const expected of objects) assert.deepEqual(selectObject.get(expected.name), expected)
    } finally {
      through012.close()
    }

    // Then the production open path carries it the rest of the way to the head
    // without losing a row.
    const upgraded = openDatabase({ path, busyTimeoutMs: 2_000, createIfMissing: false })
    try {
      assert.equal(upgraded.identity.headMigration, headMigrationId())
      // 012 is applied, and sits where it always sat.
      assert.equal(readAppliedMigrations(upgraded.handle)[DEPTH - 1].id, '012-element-statistics')
      assert.deepEqual(readAppliedMigrations(upgraded.handle).slice(0, PRIOR_DEPTH), ledger)
      for (const expected of hashes) {
        assert.equal(canonicalTableHashFromDatabase(upgraded.handle, expected.name).rowCount,
          expected.rowCount, `${expected.name} keeps every row`)
      }
      assert.equal(upgraded.handle.prepare<[], { name: string }>(
        'SELECT name FROM keycap_tray_designs WHERE id = 7').get()?.name, 'Original keycap tray')
      assert.equal(upgraded.handle.pragma('journal_mode', { simple: true }), 'delete')
      assert.deepEqual(upgraded.handle.pragma('foreign_key_check'), [])
    } finally {
      upgraded.close()
    }
    const reopened = openDatabase({ path, busyTimeoutMs: 2_000, createIfMissing: false })
    try {
      assert.equal(reopened.identity.schemaMarker, schemaIdentity())
      assert.deepEqual(migrate(reopened.handle).applied, [])
      assert.equal(reopened.handle.prepare<[], { name: string }>(
        'SELECT name FROM tool_tray_designs').get()?.name, 'Original tool tray')
    } finally {
      reopened.close()
    }
  })

  test('a failing new DDL statement rolls back the entire migration, not earlier data or ledger', () => {
    const path = fixturePath()
    const database = new Database(path)
    try {
      applyConnectionPragmas(database, 2_000, path)
      migrate(database, MIGRATIONS.slice(0, PRIOR_DEPTH))
      seedPriorDomainRows(database)
      const hashes = domainHashes(database)
      const ledger = readAppliedMigrations(database)
      assert.throws(() => migrate(database, [
        ...MIGRATIONS.slice(0, PRIOR_DEPTH),
        { ...migration012, statements: [...migration012.statements, 'CREATE TABLE deliberately_invalid ('] },
      ]))
      assert.deepEqual(readAppliedMigrations(database), ledger)
      assert.deepEqual(domainHashes(database), hashes)
      assert.equal(database.prepare<[], { count: number }>(`
        SELECT COUNT(*) AS count FROM sqlite_schema WHERE name LIKE 'element_statistics_%'`).get()?.count, 0)
      assert.deepEqual(
        migrate(database).applied,
        MIGRATIONS.slice(PRIOR_DEPTH).map(migration => migration.id))
    } finally {
      database.close()
    }
  })

  test('edited 012 statements and an old image are rejected rather than bypassing compatibility safeguards', () => {
    // Against a database that stops at 012, so the checksum mismatch is what
    // refuses the edit. On a database carrying later migrations the shorter
    // list would be refused as schema-ahead-of-code first, and this test would
    // stop proving anything about editing 012 itself.
    const path = fixturePath()
    const database = new Database(path)
    try {
      applyConnectionPragmas(database, 2_000, path)
      migrate(database, THROUGH_012())

      const edited = { ...migration012, statements: [...migration012.statements, 'SELECT 1'] }
      assert.notEqual(migrationChecksum(edited), MIGRATION_CHECKSUM)
      assert.throws(() => migrate(database, [...MIGRATIONS.slice(0, PRIOR_DEPTH), edited]),
        (error: unknown) => error instanceof MigrationError && error.code === 'MIGRATION_CHECKSUM_MISMATCH')
      assert.throws(() => migrate(database, MIGRATIONS.slice(0, PRIOR_DEPTH)),
        (error: unknown) => error instanceof MigrationError && error.code === 'SCHEMA_AHEAD_OF_CODE')
    } finally {
      database.close()
    }

    // And an image shipping the whole lineage still recognises it as its own.
    const current = openEphemeralDatabase()
    try {
      assert.equal(current.identity.schemaMarker, schemaIdentity())
    } finally {
      current.close()
    }
  })

  test('a tampered 012 checksum on disk is refused before any writable mutation', () => {
    const path = fixturePath()
    const database = openDatabase({ path, busyTimeoutMs: 2_000, createIfMissing: true })
    try {
      database.handle.prepare('UPDATE schema_migrations SET checksum = ? WHERE id = ?')
        .run('0'.repeat(64), '012-element-statistics')
    } finally {
      database.close()
    }
    const bytes = readFileSync(path)
    const mtime = statSync(path).mtimeMs
    assert.throws(() => openDatabase({ path, busyTimeoutMs: 2_000, createIfMissing: false }),
      (error: unknown) => error instanceof IdentityError && error.code === 'SCHEMA_IDENTITY_MISMATCH')
    assert.deepEqual(readFileSync(path), bytes)
    assert.equal(statSync(path).mtimeMs, mtime)
  })
})
