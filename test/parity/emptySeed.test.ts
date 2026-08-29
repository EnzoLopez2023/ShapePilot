import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, test } from 'vitest'
import type { BuildIdentity } from '../../lib/lineage/buildIdentity.ts'
import { openDatabase } from '../../lib/db/connection.ts'
import { loadConfig } from '../../server/config.ts'
import {
  EmptySeedError,
  ensureProductionEmptySeed,
} from '../../server/emptySeed.ts'
import { validateProductionStorage } from '../../server/storage.ts'
import { TEST_AUDIENCE, TEST_TENANT } from '../helpers/server.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const identity: BuildIdentity = {
  app: 'shapepilot',
  version: '0.1.0',
  build: '12345-1',
  commit: 'a'.repeat(40),
  builtAt: '2026-08-29T00:00:00.000Z',
  sourceLineage: {
    repository: 'EnzoLopez2023/Hearth',
    commit: 'b'.repeat(40),
    tree: 'c'.repeat(40),
    version: '2.13.2',
    build: 172,
    imageDigest: `sha256:${'d'.repeat(64)}`,
  },
}

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'shapepilot-empty-seed-'))
  roots.push(root)
  const config = loadConfig({
    NODE_ENV: 'production',
    PORT: '3000',
    DB_PATH: join(root, 'data', 'shapepilot.db'),
    SQLITE_JOURNAL_MODE: 'DELETE',
    BACKUP_ROOT: join(root, 'backups'),
    RECOVERY_WORK_ROOT: join(root, 'recovery'),
    AAD_TENANT_ID: TEST_TENANT,
    SHAPEPILOT_ENTRA_TENANT_ID: TEST_TENANT,
    SHAPEPILOT_API_AUDIENCE: TEST_AUDIENCE,
    SHAPEPILOT_INITIALIZE_EMPTY_DB: '1',
  }, root)
  validateProductionStorage(config)
  const rootStats = lstatSync(root)
  return {
    root,
    config,
    owner: { uid: rootStats.uid, gid: rootStats.gid },
  }
}

const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex')

describe('one-time production empty seed', () => {
  test('publishes a private zero-domain-row database and hash-pinned marker once', () => {
    const { config, owner } = fixture()
    ensureProductionEmptySeed(config, identity, owner)

    assert.equal(lstatSync(config.database.path).mode & 0o777, 0o600)
    assert.equal(lstatSync(config.database.emptySeedMarkerPath).mode & 0o777, 0o600)
    const marker = JSON.parse(
      readFileSync(config.database.emptySeedMarkerPath, 'utf8'),
    ) as Record<string, unknown>
    assert.equal(marker.databaseSha256, sha256(config.database.path))
    assert.equal(marker.sourceSha, identity.commit)
    assert.equal(marker.buildId, identity.build)

    const before = lstatSync(config.database.path)
    ensureProductionEmptySeed(config, identity, owner)
    const after = lstatSync(config.database.path)
    assert.equal(after.dev, before.dev)
    assert.equal(after.ino, before.ino)
    assert.equal(sha256(config.database.path), marker.databaseSha256)
  })

  test('refuses an existing database without its durable marker', () => {
    const { config, owner } = fixture()
    openDatabase({
      path: config.database.path,
      busyTimeoutMs: 2_000,
      createIfMissing: true,
    }).close()
    const before = sha256(config.database.path)
    assert.throws(
      () => ensureProductionEmptySeed(config, identity, owner),
      (error: unknown) =>
        error instanceof EmptySeedError && error.code === 'EMPTY_SEED_INCOMPLETE',
    )
    assert.equal(sha256(config.database.path), before)
  })

  test('refuses a marker whose database is missing', () => {
    const { config, owner } = fixture()
    writeFileSync(config.database.emptySeedMarkerPath, '{}', { mode: 0o600 })
    assert.throws(
      () => ensureProductionEmptySeed(config, identity, owner),
      (error: unknown) =>
        error instanceof EmptySeedError && error.code === 'EMPTY_SEED_INCOMPLETE',
    )
    assert.equal(existsSync(config.database.path), false)
  })

  test('refuses a dangling SQLite sidecar before creating either authority file', () => {
    const { config, owner } = fixture()
    writeFileSync(`${config.database.path}-wal`, 'stale')
    assert.throws(
      () => ensureProductionEmptySeed(config, identity, owner),
      (error: unknown) =>
        error instanceof EmptySeedError && error.code === 'EMPTY_SEED_SIDECAR',
    )
    assert.equal(existsSync(config.database.path), false)
    assert.equal(existsSync(config.database.emptySeedMarkerPath), false)
  })

  test('fails closed on a malformed durable marker without replacing the database', () => {
    const { config, owner } = fixture()
    ensureProductionEmptySeed(config, identity, owner)
    const before = sha256(config.database.path)
    writeFileSync(config.database.emptySeedMarkerPath, '{', { mode: 0o600 })

    assert.throws(
      () => ensureProductionEmptySeed(config, identity, owner),
      (error: unknown) =>
        error instanceof EmptySeedError && error.code === 'EMPTY_SEED_INVALID',
    )
    assert.equal(sha256(config.database.path), before)
  })

  test('refuses recreation after the initialized database gains domain rows', () => {
    const { config, owner } = fixture()
    ensureProductionEmptySeed(config, identity, owner)
    const database = new Database(config.database.path)
    database.prepare(`
      INSERT INTO app_settings (tenant_id, oid, settings_json)
      VALUES (?, ?, ?)
    `).run(TEST_TENANT, '11111111-1111-1111-1111-111111111111', '{}')
    database.close()

    assert.throws(
      () => ensureProductionEmptySeed(config, identity, owner),
      (error: unknown) =>
        error instanceof EmptySeedError && error.code === 'EMPTY_SEED_NOT_EMPTY',
    )
  })
})
