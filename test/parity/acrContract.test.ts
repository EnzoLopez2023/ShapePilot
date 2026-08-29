import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, test } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const fakeBin = mkdtempSync(join(tmpdir(), 'shapepilot-acr-'))
const fakeAz = join(fakeBin, 'az')
writeFileSync(fakeAz, `#!/usr/bin/env node
const args = process.argv.slice(2)
const output = (value) => process.stdout.write(JSON.stringify(value))
if (args[0] === 'acr' && args[1] === 'show') {
  output({
    id: '/subscriptions/1cf02211-8d77-4658-bb6a-0f83ec831c3b/resourceGroups/rg-personal-apps-prod/providers/Microsoft.ContainerRegistry/registries/acrenzolopez01',
    name: 'acrenzolopez01',
    loginServer: 'acrenzolopez01.azurecr.io',
    adminUserEnabled: process.env.FAKE_ADMIN === 'true',
    publicNetworkAccess: 'Enabled',
    roleAssignmentMode: 'LegacyRegistryPermissions',
    sku: { name: 'Basic' },
  })
} else if (args[0] === 'acr' && args[1] === 'repository' && args[2] === 'list') {
  output(['shapepilot', 'shopkeep', 'hearth'])
} else if (args[0] === 'acr' && args[1] === 'manifest' && args[2] === 'list-metadata') {
  const repository = args[args.indexOf('--name') + 1]
  if (repository === 'shapepilot') {
    throw new Error('the owned repository must be excluded from the sibling fingerprint')
  }
  const digest = repository === 'hearth'
    ? 'sha256:' + '1'.repeat(64)
    : process.env.FAKE_SIBLING_DIGEST || 'sha256:' + '2'.repeat(64)
  output([{ digest }])
} else {
  throw new Error('unexpected az command: ' + args.join(' '))
}
`)
chmodSync(fakeAz, 0o755)

afterAll(() => rmSync(fakeBin, { recursive: true, force: true }))

const baseArgs = [
  'scripts/check-acr-contract.ts',
  '--registry', 'acrenzolopez01',
  '--login-server', 'acrenzolopez01.azurecr.io',
  '--resource-group', 'rg-personal-apps-prod',
  '--subscription-id', '1cf02211-8d77-4658-bb6a-0f83ec831c3b',
  '--repository', 'shapepilot',
]

const run = (extraArgs: string[] = [], extraEnv: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, [...baseArgs, ...extraArgs], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnv,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
    },
  })

describe('shared ACR deployment contract', () => {
  test('fingerprints sibling names and digests while excluding ShapePilot', () => {
    const result = run()
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout) as Record<string, unknown>
    assert.equal(report.status, 'ok')
    assert.match(String(report.siblingFingerprint), /^[0-9a-f]{64}$/)
  })

  test('fails when a sibling digest changes', () => {
    const baseline = JSON.parse(run().stdout) as { siblingFingerprint: string }
    const result = run(
      ['--expected-sibling-fingerprint', baseline.siblingFingerprint],
      { FAKE_SIBLING_DIGEST: `sha256:${'3'.repeat(64)}` },
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /sibling ACR repository name or digest changed/)
  })

  test('fails when shared registry properties drift', () => {
    const result = run([], { FAKE_ADMIN: 'true' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /outside the approved immutable contract/)
  })
})
