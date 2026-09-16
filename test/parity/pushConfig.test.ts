// VAPID configuration: all three settings or none, keys of the right size, and
// an unresolved Key Vault reference read as "off" rather than as a key.
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { loadConfig } from '../../server/config.ts'
import { testEnv } from '../helpers/server.ts'

const PUBLIC_KEY = Buffer.alloc(65, 4).toString('base64url')
const PRIVATE_KEY = Buffer.alloc(32, 9).toString('base64url')
const SUBJECT = 'mailto:owner@example.invalid'

const push = (env: NodeJS.ProcessEnv) => loadConfig(testEnv(env)).push

test('absent settings leave push off without failing startup', () => {
  assert.deepEqual(push({}), {
    enabled: false, publicKey: null, privateKey: null, subject: null, unresolvedSecret: false,
  })
})

test('all three settings turn it on', () => {
  const config = push({
    SHAPEPILOT_VAPID_PUBLIC_KEY: PUBLIC_KEY,
    SHAPEPILOT_VAPID_PRIVATE_KEY: PRIVATE_KEY,
    SHAPEPILOT_VAPID_SUBJECT: SUBJECT,
  })
  assert.equal(config.enabled, true)
})

test('half a configuration, a wrong-sized key, or a bad subject is refused at startup', () => {
  for (const env of [
    { SHAPEPILOT_VAPID_PUBLIC_KEY: PUBLIC_KEY },
    { SHAPEPILOT_VAPID_PUBLIC_KEY: PUBLIC_KEY, SHAPEPILOT_VAPID_PRIVATE_KEY: PRIVATE_KEY },
    { SHAPEPILOT_VAPID_PUBLIC_KEY: PRIVATE_KEY, SHAPEPILOT_VAPID_PRIVATE_KEY: PRIVATE_KEY, SHAPEPILOT_VAPID_SUBJECT: SUBJECT },
    { SHAPEPILOT_VAPID_PUBLIC_KEY: PUBLIC_KEY, SHAPEPILOT_VAPID_PRIVATE_KEY: PUBLIC_KEY, SHAPEPILOT_VAPID_SUBJECT: SUBJECT },
    { SHAPEPILOT_VAPID_PUBLIC_KEY: PUBLIC_KEY, SHAPEPILOT_VAPID_PRIVATE_KEY: PRIVATE_KEY, SHAPEPILOT_VAPID_SUBJECT: 'owner@example.invalid' },
  ]) {
    assert.throws(() => push(env), /SHAPEPILOT_VAPID/, JSON.stringify(Object.keys(env)))
  }
})

test('an unresolved Key Vault reference is reported and leaves push off', () => {
  const config = push({
    SHAPEPILOT_VAPID_PUBLIC_KEY: PUBLIC_KEY,
    SHAPEPILOT_VAPID_PRIVATE_KEY: '@Microsoft.KeyVault(SecretUri=https://kv-shapepilot-prod.vault.azure.net/secrets/VAPID-PRIVATE-KEY/)',
    SHAPEPILOT_VAPID_SUBJECT: SUBJECT,
  })
  assert.equal(config.enabled, false)
  assert.equal(config.privateKey, null)
  assert.equal(config.unresolvedSecret, true)
})
