// The dry run is strictly read-only.
//
// A dry run must be able to answer "what would this import do?" against a real
// target without leaving a trace: no directory, no file, no database, no
// persistent pragma, no migration, no sidecar, and not one byte changed.
//
// The command itself is spawned here, not just the library function, because
// the mutating `openDatabase` used to be reachable from the script and the
// point of the blocker is that it no longer is.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import Database from 'better-sqlite3'
import { afterEach, describe, test } from 'vitest'
import {
  openDatabase, openExistingCompatibleDatabase,
} from '../../lib/db/connection.ts'
import { openReadOnlyDatabase, ReadOnlyOpenError } from '../../lib/db/readonly.ts'
import { IdentityError } from '../../lib/db/identity.ts'
import { OWNED_LEGACY_TABLES } from '../../lib/db/schema.ts'
import { applyImport, planImport } from '../../lib/legacy/importLegacy.ts'
import { serializeCanonical } from '../../lib/legacy/canonical.ts'
import type { ApprovedSource } from '../../lib/legacy/approvedSource.ts'
import type { ExportBundle } from '../../lib/legacy/manifest.ts'
import {
  approvedSourceFor, bundleFor, createLegacyFixture,
} from '../helpers/legacyFixtures.ts'
import { OTHER_OID, TEST_OID, TEST_TENANT, TEST_ROOT, testEnv } from '../helpers/server.ts'

const run = promisify(execFile)

const owner = { tenantId: TEST_TENANT, oid: TEST_OID }
const otherOwner = { tenantId: TEST_TENANT, oid: OTHER_OID }

const scratch: string[] = []

const scratchPath = (name: string): string => {
  mkdirSync(TEST_ROOT, { recursive: true })
  const path = join(TEST_ROOT, `${name}-${randomUUID()}`)
  scratch.push(path)
  return path
}

afterEach(() => {
  while (scratch.length) {
    const path = scratch.pop() as string
    rmSync(path, { force: true, recursive: true })
    for (const sidecar of ['-journal', '-wal', '-shm']) {
      rmSync(`${path}${sidecar}`, { force: true })
    }
  }
})

interface Fingerprint {
  bytes: number
  sha256: string
  mtimeMs: number
  sidecars: string[]
  ledger: string
  counts: number[]
}

function fingerprint(path: string): Fingerprint {
  const stats = statSync(path)
  const sidecars = ['-journal', '-wal', '-shm']
    .filter((suffix) => existsSync(`${path}${suffix}`))
  const database = openReadOnlyDatabase({ path })
  try {
    return {
      bytes: stats.size,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      mtimeMs: stats.mtimeMs,
      sidecars,
      ledger: serializeCanonical(database.identity.ledger),
      counts: OWNED_LEGACY_TABLES.map((table) => Number(
        (database.handle.prepare(`SELECT COUNT(*) AS count FROM ${table}`)
          .get() as { count: number }).count)),
    }
  } finally {
    database.close()
  }
}

/** A migrated, compatible target with the fixture already imported into it. */
async function seededTarget(
  bundle: ExportBundle, approved: ApprovedSource, into = owner,
): Promise<string> {
  const path = scratchPath('dry-run-target.db')
  const database = openDatabase({ path, busyTimeoutMs: 2_000, createIfMissing: true })
  try {
    const plan = planImport({ db: database.handle, bundle, owner: into, approvedSource: approved })
    applyImport({
      db: database.handle, bundle, owner: into, approvedSource: approved,
      expectedReportHash: plan.reportHash,
    })
  } finally {
    database.close()
  }
  return path
}

async function withFixture<T>(
  body: (bundle: ExportBundle, approved: ApprovedSource) => Promise<T>,
): Promise<T> {
  const fixture = createLegacyFixture('valid')
  try {
    return await body(await bundleFor(fixture), await approvedSourceFor(fixture))
  } finally {
    fixture.cleanup()
  }
}

/** Spawn the real command, exactly as an operator would. */
async function dryRunCommand(databasePath: string, bundlePath: string): Promise<{
  code: number; stdout: string; stderr: string
}> {
  try {
    const result = await run('node', [
      'scripts/legacy-import.ts', '--dry-run',
      '--bundle', bundlePath,
      '--owner-tenant', TEST_TENANT,
      '--owner-oid', TEST_OID,
      '--database', databasePath,
    ], { cwd: resolve('.'), env: { ...process.env, ...testEnv() } as NodeJS.ProcessEnv })
    return { code: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

describe('legacy-import --dry-run touches nothing', () => {
  test('an absent target fails without creating a directory, file or database', async () => {
    await withFixture(async (bundle) => {
      const bundlePath = scratchPath('bundle.json')
      writeFileSync(bundlePath, serializeCanonical(bundle))

      const absentRoot = scratchPath('never-created')
      const absentDatabase = join(absentRoot, 'nested', 'shapepilot.db')

      const result = await dryRunCommand(absentDatabase, bundlePath)

      assert.notEqual(result.code, 0, 'the command must fail')
      assert.match(result.stderr, /TARGET_MISSING/)
      assert.match(result.stderr, /db:init/)
      assert.equal(existsSync(absentRoot), false, 'no directory may be created')
      assert.equal(existsSync(dirname(absentDatabase)), false)
      assert.equal(existsSync(absentDatabase), false, 'no database may be created')
      for (const sidecar of ['-journal', '-wal', '-shm']) {
        assert.equal(existsSync(`${absentDatabase}${sidecar}`), false)
      }
    })
  })

  test('a compatible target is byte-for-byte unchanged by the command', async () => {
    await withFixture(async (bundle, approved) => {
      const databasePath = await seededTarget(bundle, approved)
      const bundlePath = scratchPath('bundle.json')
      writeFileSync(bundlePath, serializeCanonical(bundle))

      const before = fingerprint(databasePath)
      await new Promise((done) => setTimeout(done, 15))
      const result = await dryRunCommand(databasePath, bundlePath)
      const after = fingerprint(databasePath)

      // The synthetic bundle is not the approved production source, so the
      // command fails at the gate — after opening the target read-only, which
      // is exactly the path that must leave no trace.
      assert.notEqual(result.code, 0)
      assert.match(result.stderr, /SOURCE_NOT_APPROVED/)
      assert.deepEqual(after, before)
      assert.deepEqual(after.sidecars, [])
    })
  })

  test('planning against a read-only handle leaves hash, mtime, ledger and counts alone',
    async () => {
      await withFixture(async (bundle, approved) => {
        const databasePath = await seededTarget(bundle, approved)
        const before = fingerprint(databasePath)
        await new Promise((done) => setTimeout(done, 15))

        const target = openReadOnlyDatabase({ path: databasePath })
        let replayHash: string
        try {
          const plan = planImport({
            db: target.handle, bundle, owner, approvedSource: approved,
          })
          replayHash = plan.reportHash
          // Every exact row is already there: a replay is a proven no-op.
          assert.equal(plan.report.totals.insert, 0)
          assert.equal(plan.report.totals.reject, 0)
          assert.equal(plan.report.totals.noop, 7)
          assert.equal(plan.report.ok, true)
        } finally {
          target.close()
        }

        const after = fingerprint(databasePath)
        assert.equal(after.sha256, before.sha256)
        assert.equal(after.bytes, before.bytes)
        assert.equal(after.mtimeMs, before.mtimeMs)
        assert.equal(after.ledger, before.ledger)
        assert.deepEqual(after.counts, before.counts)
        assert.deepEqual(after.sidecars, [])

        // Idempotent replay must still be possible afterwards.
        const database = openDatabase({
          path: databasePath, busyTimeoutMs: 2_000, createIfMissing: false,
        })
        try {
          const replay = applyImport({
            db: database.handle, bundle, owner, approvedSource: approved,
            expectedReportHash: replayHash,
          })
          assert.equal(replay.inserted, 0)
          assert.equal(replay.noop, 7)
          assert.equal(replay.runId, null)
        } finally {
          database.close()
        }
      })
    })

  test('collisions and rejections are reported from a read-only inspection', async () => {
    await withFixture(async (bundle, approved) => {
      const databasePath = await seededTarget(bundle, approved, otherOwner)
      const before = fingerprint(databasePath)

      const target = openReadOnlyDatabase({ path: databasePath })
      try {
        const plan = planImport({ db: target.handle, bundle, owner, approvedSource: approved })
        assert.equal(plan.report.ok, false)
        const designs = plan.report.tables.find((table) => table.name === 'keycap_tray_designs')
        assert.equal(designs?.reject[0].code, 'TARGET_COLLISION')
      } finally {
        target.close()
      }

      assert.deepEqual(fingerprint(databasePath), before)
    })
  })

  test('an empty compatible target plans inserts and still writes nothing', async () => {
    await withFixture(async (bundle, approved) => {
      const databasePath = scratchPath('empty-target.db')
      openDatabase({ path: databasePath, busyTimeoutMs: 2_000, createIfMissing: true }).close()
      const before = fingerprint(databasePath)

      const target = openReadOnlyDatabase({ path: databasePath })
      try {
        const plan = planImport({ db: target.handle, bundle, owner, approvedSource: approved })
        assert.equal(plan.report.totals.insert, 7)
        assert.equal(plan.report.totals.reject, 0)
      } finally {
        target.close()
      }

      assert.deepEqual(fingerprint(databasePath), before)
    })
  })
})

describe('read-only target inspection', () => {
  test('the connection is query_only and refuses writes', () => {
    const databasePath = scratchPath('query-only.db')
    openDatabase({ path: databasePath, busyTimeoutMs: 2_000, createIfMissing: true }).close()

    const target = openReadOnlyDatabase({ path: databasePath })
    try {
      assert.equal(target.handle.pragma('query_only', { simple: true }), 1)
      assert.throws(() => target.handle.prepare('CREATE TABLE intruder (a)').run())
      assert.throws(() => target.handle.prepare(
        "INSERT INTO app_identity (key, value) VALUES ('x', 'y')").run())
      assert.equal(target.identity.app, 'shapepilot')
    } finally {
      target.close()
    }
  })

  test('a database with a foreign app marker is refused', () => {
    const databasePath = scratchPath('foreign-app.db')
    const database = openDatabase({
      path: databasePath, busyTimeoutMs: 2_000, createIfMissing: true,
    })
    database.handle.prepare("UPDATE app_identity SET value = 'lantern' WHERE key = 'app'").run()
    database.close()

    assert.throws(
      () => openReadOnlyDatabase({ path: databasePath }),
      (error: unknown) => error instanceof IdentityError
        && error.code === 'SCHEMA_IDENTITY_MISMATCH')
  })

  test('a database with no identity at all is refused', () => {
    const databasePath = scratchPath('no-identity.db')
    const database = openDatabase({
      path: databasePath, busyTimeoutMs: 2_000, createIfMissing: true,
    })
    database.handle.prepare('DROP TABLE app_identity').run()
    database.close()

    assert.throws(
      () => openReadOnlyDatabase({ path: databasePath }),
      (error: unknown) => error instanceof IdentityError && error.code === 'APP_MARKER_MISSING')
  })

  test('a diverged migration ledger is refused even with the right head', () => {
    const databasePath = scratchPath('diverged-ledger.db')
    const database = openDatabase({
      path: databasePath, busyTimeoutMs: 2_000, createIfMissing: true,
    })
    // Same head migration, different history.
    database.handle.prepare(
      "UPDATE schema_migrations SET checksum = ? WHERE ordinal = 0").run('0'.repeat(64))
    database.close()

    assert.throws(
      () => openReadOnlyDatabase({ path: databasePath }),
      (error: unknown) => error instanceof IdentityError
        && error.code === 'SCHEMA_IDENTITY_MISMATCH')
  })

  test('a database with a matching ledger but altered sqlite_schema is refused', () => {
    const databasePath = scratchPath('diverged-schema.db')
    const database = openDatabase({
      path: databasePath, busyTimeoutMs: 2_000, createIfMissing: true,
    })
    database.handle.exec('DROP INDEX idx_keycap_designs_owner')
    database.close()

    assert.throws(
      () => openReadOnlyDatabase({ path: databasePath }),
      (error: unknown) => error instanceof IdentityError
        && error.code === 'SCHEMA_IDENTITY_MISMATCH'
        && error.message.includes('sqlite_schema'))
    assert.throws(
      () => openExistingCompatibleDatabase({ path: databasePath, busyTimeoutMs: 2_000 }),
      (error: unknown) => error instanceof IdentityError
        && error.code === 'SCHEMA_IDENTITY_MISMATCH')
    assert.throws(
      () => openDatabase({ path: databasePath, busyTimeoutMs: 2_000, createIfMissing: false }),
      (error: unknown) => error instanceof IdentityError
        && error.code === 'SCHEMA_IDENTITY_MISMATCH')
  })

  test('an absent target never creates anything', () => {
    const absent = join(scratchPath('absent-root'), 'shapepilot.db')
    assert.throws(
      () => openReadOnlyDatabase({ path: absent }),
      (error: unknown) => error instanceof ReadOnlyOpenError && error.code === 'TARGET_MISSING')
    assert.equal(existsSync(dirname(absent)), false)
    assert.equal(existsSync(absent), false)
  })

  test('the operator write path refuses a foreign database before modifying it', () => {
    const databasePath = scratchPath('foreign-write-target.db')
    const foreign = new Database(databasePath)
    foreign.exec('CREATE TABLE lantern_data (id INTEGER PRIMARY KEY, value TEXT)')
    foreign.close()
    const before = {
      bytes: statSync(databasePath).size,
      hash: createHash('sha256').update(readFileSync(databasePath)).digest('hex'),
      mtimeMs: statSync(databasePath).mtimeMs,
    }

    assert.throws(() => openExistingCompatibleDatabase({
      path: databasePath,
      busyTimeoutMs: 2_000,
    }))

    const after = {
      bytes: statSync(databasePath).size,
      hash: createHash('sha256').update(readFileSync(databasePath)).digest('hex'),
      mtimeMs: statSync(databasePath).mtimeMs,
    }
    assert.deepEqual(after, before)
    const check = new Database(databasePath, { readonly: true, fileMustExist: true })
    try {
      const tables = (check.prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
      ).all() as { name: string }[]).map((row) => row.name)
      assert.deepEqual(tables, ['lantern_data'])
    } finally {
      check.close()
    }
  })
})
