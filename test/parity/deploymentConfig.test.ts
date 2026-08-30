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

describe('AI configuration', () => {
  const FOUNDRY = {
    AZURE_AI_FOUNDRY_ENDPOINT: 'https://aif-shapepilot-prod.openai.azure.com/openai/v1/',
    AZURE_AI_FOUNDRY_DEPLOYMENT: 'shapepilot-designer',
  }
  // What App Service actually puts in the environment when a Key Vault
  // reference cannot be resolved: the reference itself, verbatim.
  const UNRESOLVED_REFERENCE =
    '@Microsoft.KeyVault(SecretUri=https://kv-shapepilot-prod.vault.azure.net/secrets/AZURE-OPENAI-API-KEY/)'

  // The documented local setup: the dev auth bypass, which is what makes the
  // tenant settings optional outside production.
  const developmentEnv = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
    NODE_ENV: 'development',
    SHAPEPILOT_DEV_AUTH: '1',
    ...FOUNDRY,
    ...overrides,
  })

  const withRoot = (overrides: NodeJS.ProcessEnv = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'shapepilot-ai-'))
    roots.push(root)
    return loadConfig(productionEnv(root, overrides))
  }

  test('production authenticates with the managed identity, never a key', () => {
    const config = withRoot({ ...FOUNDRY, AZURE_OPENAI_API_KEY: 'a-real-looking-key' })
    assert.equal(config.ai.enabled, true)
    // A key in production would silently downgrade to a long-lived credential
    // with full access to the resource. It is refused regardless of its value.
    assert.equal(config.ai.apiKey, null)
  })

  test('an unresolved Key Vault reference is not mistaken for a key', () => {
    // The bug this guards: the reference string is truthy, so it was used as a
    // bearer token and every call came back 401 while the setting looked fine.
    const production = withRoot({ ...FOUNDRY, AZURE_OPENAI_API_KEY: UNRESOLVED_REFERENCE })
    assert.equal(production.ai.apiKey, null)

    const development = loadConfig(developmentEnv({
      AZURE_OPENAI_API_KEY: UNRESOLVED_REFERENCE,
    }))
    assert.equal(development.ai.apiKey, null, 'also refused outside production')
  })

  test('a real key is honoured in development, where it is a convenience', () => {
    const config = loadConfig(developmentEnv({ AZURE_OPENAI_API_KEY: 'local-dev-key' }))
    assert.equal(config.ai.apiKey, 'local-dev-key')
  })

  test('no Foundry settings disables the assistant rather than failing startup', () => {
    const config = withRoot()
    assert.equal(config.ai.enabled, false)
    assert.equal(config.ai.endpoint, null)
    assert.equal(config.ai.deployment, null)
  })

  test('half-configured Foundry settings are a startup error', () => {
    for (const half of [
      { AZURE_AI_FOUNDRY_ENDPOINT: FOUNDRY.AZURE_AI_FOUNDRY_ENDPOINT },
      { AZURE_AI_FOUNDRY_DEPLOYMENT: FOUNDRY.AZURE_AI_FOUNDRY_DEPLOYMENT },
    ]) {
      assert.throws(() => withRoot(half), ConfigError)
    }
  })

  test('a non-https endpoint is refused', () => {
    assert.throws(
      () => withRoot({ ...FOUNDRY, AZURE_AI_FOUNDRY_ENDPOINT: 'http://insecure.example/' }),
      ConfigError,
    )
  })
})
