import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, test } from 'vitest'
import {
  assertProductionBuildIdentity,
  buildIdentity,
} from '../../lib/lineage/buildIdentity.ts'
import { ConfigError, loadConfig } from '../../server/config.ts'
import { validateProductionStorage } from '../../server/storage.ts'
import { TEST_AUDIENCE, TEST_TENANT } from '../helpers/server.ts'

const roots: string[] = []
const TEST_CLIENT_ID = '11112222-3333-4444-5555-666677778888'
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const productionEnv = (root: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  PORT: '3000',
  DB_PATH: join(root, 'shapepilot.db'),
  SQLITE_JOURNAL_MODE: 'DELETE',
  BACKUP_ROOT: join(root, 'backups'),
  RECOVERY_WORK_ROOT: join(root, 'recovery'),
  AAD_TENANT_ID: TEST_TENANT,
  SHAPEPILOT_ENTRA_TENANT_ID: TEST_TENANT,
  SHAPEPILOT_API_AUDIENCE: TEST_AUDIENCE,
  ...overrides,
})

describe('production deployment configuration', () => {
  test('requires explicit absolute persistent paths and DELETE journal mode', () => {
    const root = mkdtempSync(join(tmpdir(), 'shapepilot-config-'))
    roots.push(root)
    const config = loadConfig(productionEnv(root))
    assert.equal(config.port, 3000)
    assert.equal(config.database.path, join(root, 'shapepilot.db'))
    assert.equal(config.database.createIfMissing, false)
    assert.equal(config.database.initializeEmptySeed, false)
    assert.equal(
      config.database.emptySeedMarkerPath,
      join(root, '.shapepilot-empty-seed.json'),
    )
    assert.equal(config.artifactStoreDir, join(root, 'backups'))
    assert.equal(config.recoveryWorkDir, join(root, 'recovery'))

    for (const key of [
      'PORT',
      'DB_PATH',
      'SQLITE_JOURNAL_MODE',
      'BACKUP_ROOT',
      'RECOVERY_WORK_ROOT',
      'AAD_TENANT_ID',
      'SHAPEPILOT_ENTRA_TENANT_ID',
      'SHAPEPILOT_API_AUDIENCE',
    ]) {
      const invalid = productionEnv(root)
      delete invalid[key]
      assert.throws(
        () => loadConfig(invalid),
        (error: unknown) => error instanceof ConfigError,
        `${key} must be mandatory`,
      )
    }
    assert.throws(
      () => loadConfig(productionEnv(root, { DB_PATH: 'relative.db' })),
      (error: unknown) => error instanceof ConfigError && error.code === 'CONFIG_INVALID',
    )
    assert.throws(
      () => loadConfig(productionEnv(root, { SQLITE_JOURNAL_MODE: 'WAL' })),
      (error: unknown) => error instanceof ConfigError && error.code === 'CONFIG_INVALID',
    )
    assert.throws(
      () => loadConfig(productionEnv(root, { SHAPEPILOT_DB_ALLOW_CREATE: 'true' })),
      (error: unknown) => error instanceof ConfigError && error.code === 'CONFIG_INVALID',
    )
    assert.equal(
      loadConfig(productionEnv(root, { SHAPEPILOT_INITIALIZE_EMPTY_DB: '1' }))
        .database.initializeEmptySeed,
      true,
    )
    assert.throws(
      () => loadConfig(productionEnv(root, { SHAPEPILOT_INITIALIZE_EMPTY_DB: '0' })),
      (error: unknown) => error instanceof ConfigError && error.code === 'CONFIG_INVALID',
    )
  })

  test('rejects canonical and compatibility aliases that disagree', () => {
    const root = mkdtempSync(join(tmpdir(), 'shapepilot-alias-'))
    roots.push(root)
    assert.throws(
      () => loadConfig(productionEnv(root, {
        SHAPEPILOT_DB_PATH: join(root, 'different.db'),
      })),
      (error: unknown) => error instanceof ConfigError && error.code === 'CONFIG_CONFLICT',
    )
  })

  test('validates the Entra v2 token audience as the API client id', () => {
    const root = mkdtempSync(join(tmpdir(), 'shapepilot-audience-'))
    roots.push(root)
    const config = loadConfig(productionEnv(root, {
      SHAPEPILOT_API_AUDIENCE: `api://${TEST_CLIENT_ID}`,
      VITE_AZURE_CLIENT_ID: TEST_CLIENT_ID,
    }))
    assert.equal(config.auth.audience, TEST_CLIENT_ID)

    assert.throws(
      () => loadConfig(productionEnv(root, {
        SHAPEPILOT_API_AUDIENCE: `api://${TEST_CLIENT_ID}`,
        VITE_AZURE_CLIENT_ID: 'not-a-guid',
      })),
      (error: unknown) => error instanceof ConfigError && error.code === 'CONFIG_INVALID',
    )
    assert.throws(
      () => loadConfig(productionEnv(root, {
        SHAPEPILOT_API_AUDIENCE: `api://${TEST_CLIENT_ID}`,
        VITE_AZURE_CLIENT_ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      })),
      (error: unknown) => error instanceof ConfigError && error.code === 'CONFIG_CONFLICT',
    )
  })

  test('creates and verifies only bounded backup and recovery directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'shapepilot-storage-'))
    roots.push(root)
    const config = loadConfig(productionEnv(root, {
      RECOVERY_WORK_ROOT: join(root, 'recovery'),
    }))
    validateProductionStorage(config)
    assert.equal(existsSync(config.artifactStoreDir as string), true)
    assert.equal(existsSync(config.recoveryWorkDir as string), true)
    assert.equal(existsSync(config.database.path), false)
  })

  test('rejects a development identity as a production release', () => {
    assert.throws(
      () => assertProductionBuildIdentity(buildIdentity()),
      /production build identity commit/,
    )
  })
})
