import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, test } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const fakeBin = mkdtempSync(join(tmpdir(), 'shapepilot-monitor-'))
const fakeAz = join(fakeBin, 'az')
writeFileSync(fakeAz, `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] !== 'resource' || args[1] !== 'list') {
  throw new Error('unexpected az command: ' + args.join(' '))
}
const type = args[args.indexOf('--resource-type') + 1]
process.stdout.write(JSON.stringify(process.env.FAKE_ALERT === type ? [{}] : []))
`)
chmodSync(fakeAz, 0o755)

afterAll(() => rmSync(fakeBin, { recursive: true, force: true }))

const baseArgs = [
  'scripts/check-deploy-monitor.ts',
  '--phase', 'postdeploy',
  '--resource-group', 'rg-personal-apps-prod',
  '--webapp', 'app-shapepilot-prod-lwxhu7jxlrbtu',
  '--base-url', 'https://app-shapepilot-prod-lwxhu7jxlrbtu.azurewebsites.net',
]

const run = (args = baseArgs, extraEnv: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnv,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
    },
  })

describe('direct deployment safety check', () => {
  test('accepts the direct HTTPS origin only when every alert count is zero', () => {
    const result = run()
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout) as {
      directHttpsOrigin: string
      endpointAgreement: string[]
      alertCounts: Record<string, number>
    }
    assert.equal(
      report.directHttpsOrigin,
      'https://app-shapepilot-prod-lwxhu7jxlrbtu.azurewebsites.net',
    )
    assert.deepEqual(report.endpointAgreement, [
      '/version.json',
      '/api/version',
      '/api/live',
      '/api/ready',
    ])
    assert.ok(Object.values(report.alertCounts).every((count) => count === 0))
  })

  test('rejects custom or non-TLS origins', () => {
    const result = run([
      ...baseArgs.slice(0, -1),
      'https://shapepilot.nintek.com',
    ])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /scoped only to the declared ShapePilot resources/)
  })

  test('rejects any metric, query, or smart-detector alert', () => {
    for (const resourceType of [
      'Microsoft.Insights/metricAlerts',
      'Microsoft.Insights/scheduledQueryRules',
      'microsoft.alertsmanagement/smartDetectorAlertRules',
    ]) {
      const result = run(baseArgs, { FAKE_ALERT: resourceType })
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /owner invariant requires zero/)
    }
  })
})
