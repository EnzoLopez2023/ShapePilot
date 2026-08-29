import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, test } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const fakeBin = mkdtempSync(join(tmpdir(), 'shapepilot-rbac-'))
const fakeAz = join(fakeBin, 'az')
writeFileSync(fakeAz, `#!/usr/bin/env node
const args = process.argv.slice(2)
const subscription = '1cf02211-8d77-4658-bb6a-0f83ec831c3b'
const rg = '/subscriptions/' + subscription + '/resourceGroups/rg-personal-apps-prod'
const acr = rg + '/providers/Microsoft.ContainerRegistry/registries/acrenzolopez01'
const web = rg + '/providers/Microsoft.Web/sites/app-shapepilot-prod-lwxhu7jxlrbtu'
const role = (id) =>
  '/subscriptions/' + subscription + '/providers/Microsoft.Authorization/roleDefinitions/' + id
const assignment = (scope, id) => ({
  scope,
  roleDefinitionId: role(id),
  principalType: 'ServicePrincipal',
})
const assignments = [
  assignment(rg, 'acdd72a7-3385-48ef-bd42-f606fba81ae7'),
  assignment(acr, '8311e382-0749-4cb8-b61a-304f252e45ec'),
  assignment(acr, 'c2f4ef07-c644-48eb-af81-4b1b4947fb11'),
]
if (process.env.FAKE_WEB_ROLE !== 'absent') {
  assignments.push(assignment(web, 'de139f84-1756-47ae-9be6-808fbbe84772'))
}
if (process.env.FAKE_EXTRA_ROLE === 'true') {
  assignments.push(assignment(acr, 'acdd72a7-3385-48ef-bd42-f606fba81ae7'))
}
if (args[0] === 'account' && args[1] === 'get-access-token') {
  const claims = Buffer.from(JSON.stringify({
    oid: '22222222-2222-4222-8222-222222222222',
    appid: process.env.FAKE_CLIENT_ID || '11111111-1111-1111-1111-111111111111',
    tid: 'de625678-c55b-4494-9558-14946cbb6133',
  })).toString('base64url')
  process.stdout.write(JSON.stringify({ accessToken: 'header.' + claims + '.signature' }))
} else {
  if (process.env.FAKE_WRONG_SCOPE === 'true') {
    assignments[1].scope = rg
  }
  if (args.includes('--all') || !args.includes('--scope')) {
    throw new Error('role assignments must be queried at an authorized exact scope')
  }
  const scope = args[args.indexOf('--scope') + 1].toLowerCase()
  process.stdout.write(JSON.stringify(assignments.filter((item) => {
    const assignmentScope = item.scope.toLowerCase()
    return scope === assignmentScope || scope.startsWith(assignmentScope + '/')
  })))
}
`)
chmodSync(fakeAz, 0o755)

afterAll(() => rmSync(fakeBin, { recursive: true, force: true }))

const baseArgs = [
  'scripts/check-deploy-rbac.ts',
  '--client-id', '11111111-1111-1111-1111-111111111111',
  '--tenant-id', 'de625678-c55b-4494-9558-14946cbb6133',
  '--subscription-id', '1cf02211-8d77-4658-bb6a-0f83ec831c3b',
  '--resource-group', 'rg-personal-apps-prod',
  '--registry', 'acrenzolopez01',
  '--web-app', 'app-shapepilot-prod-lwxhu7jxlrbtu',
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

describe('deployment OIDC RBAC contract', () => {
  test('allows Stage A without the not-yet-created Web App grant', () => {
    const result = run([], { FAKE_WEB_ROLE: 'absent' })
    assert.equal(result.status, 0, result.stderr)
  })

  test('requires the exact Web App grant before deployment', () => {
    const result = run(['--require-web-app-role'], { FAKE_WEB_ROLE: 'absent' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /role assignment count is invalid/)
  })

  test('accepts the complete exact deployment assignment set', () => {
    const result = run(['--require-web-app-role'])
    assert.equal(result.status, 0, result.stderr)
  })

  test('rejects a redundant ACR Reader or wrong role scope', () => {
    const redundant = run([], { FAKE_EXTRA_ROLE: 'true' })
    assert.notEqual(redundant.status, 0)
    assert.match(redundant.stderr, /unapproved role assignment/)

    const wrongScope = run([], { FAKE_WRONG_SCOPE: 'true' })
    assert.notEqual(wrongScope.status, 0)
    assert.match(wrongScope.stderr, /unapproved role assignment/)
  })

  test('rejects a login from another application', () => {
    const result = run([], { FAKE_CLIENT_ID: '33333333-3333-4333-8333-333333333333' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /outside the approved OIDC contract/)
  })
})
