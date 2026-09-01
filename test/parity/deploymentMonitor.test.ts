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
if (args[0] !== 'resource' || !['list', 'show'].includes(args[1])) {
  throw new Error('unexpected az command: ' + args.join(' '))
}
const metricAlerts = (process.env.FAKE_ALERT_JSON
  ? JSON.parse(process.env.FAKE_ALERT_JSON)
  : []
).map((alert, index) => ({
  id: '/subscriptions/test/resourceGroups/rg-personal-apps-prod/providers/Microsoft.Insights/metricAlerts/fake-' + index,
  ...alert,
}))
if (args[1] === 'show') {
  const id = args[args.indexOf('--ids') + 1]
  const alert = metricAlerts.find((candidate) => candidate.id === id)
  if (!alert) throw new Error('unknown metric alert: ' + id)
  process.stdout.write(JSON.stringify(alert))
} else {
  const type = args[args.indexOf('--resource-type') + 1]
  const alerts = type === 'Microsoft.Insights/metricAlerts'
    ? metricAlerts
    : process.env.FAKE_ALERT === type ? [{}] : []
  process.stdout.write(JSON.stringify(alerts))
}
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
  test('accepts the direct HTTPS origin when every alert count is zero', () => {
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

  test('accepts metric alerts owned by other apps in the shared resource group', () => {
    const result = run(baseArgs, {
      FAKE_ALERT_JSON: JSON.stringify([
        {
          properties: {
            scopes: [
              '/subscriptions/test/resourceGroups/rg-personal-apps-prod/providers/Microsoft.Web/sites/app-cairn-prod',
            ],
            criteria: {
              allOf: [{
                metricName: 'Http5xx',
                operator: 'GreaterThan',
                timeAggregation: 'Total',
                dimensions: [{
                  name: 'ResourceId',
                  operator: 'Include',
                  values: [
                    '/subscriptions/test/resourceGroups/rg-personal-apps-prod/providers/Microsoft.Web/sites/app-cairn-prod',
                  ],
                }],
              }],
            },
          },
        },
      ]),
    })

    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout) as {
      alertCounts: Record<string, number>
    }
    assert.equal(report.alertCounts['Microsoft.Insights/metricAlerts'], 1)
  })

  test('rejects a metric alert scoped to the ShapePilot web app', () => {
    const result = run(baseArgs, {
      FAKE_ALERT_JSON: JSON.stringify([
        {
          properties: {
            scopes: [
              '/subscriptions/test/resourceGroups/rg-personal-apps-prod/providers/Microsoft.Web/sites/app-shapepilot-prod-lwxhu7jxlrbtu',
            ],
            criteria: {
              allOf: [{
                metricName: 'Http5xx',
                operator: 'GreaterThan',
                timeAggregation: 'Total',
                threshold: 0,
              }],
            },
          },
        },
      ]),
    })

    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /owner invariant requires zero Microsoft\.Insights\/metricAlerts resources/,
    )
  })

  test('rejects a metric alert whose criteria target the ShapePilot web app', () => {
    const result = run(baseArgs, {
      FAKE_ALERT_JSON: JSON.stringify([
        {
          properties: {
            scopes: [
              '/subscriptions/test/resourceGroups/rg-personal-apps-prod',
            ],
            criteria: {
              allOf: [{
                metricName: 'Http5xx',
                operator: 'GreaterThan',
                timeAggregation: 'Total',
                dimensions: [{
                  name: 'cloud_RoleName',
                  operator: 'Include',
                  values: ['app-shapepilot-prod-lwxhu7jxlrbtu'],
                }],
              }],
            },
          },
        },
      ]),
    })

    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /owner invariant requires zero Microsoft\.Insights\/metricAlerts resources/,
    )
  })

  test('fails closed when a metric alert cannot be classified safely', () => {
    const result = run(baseArgs, {
      FAKE_ALERT_JSON: JSON.stringify([
        {
          properties: {
            scopes: [
              '/subscriptions/test/resourceGroups/rg-personal-apps-prod/providers/Microsoft.Web/sites/app-cairn-prod',
            ],
            criteria: { allOf: [{}] },
          },
        },
      ]),
    })

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /invalid metric alert criterion/)
  })

  test('preserves the zero-alert invariant for query and smart-detector alerts', () => {
    for (const resourceType of [
      'Microsoft.Insights/scheduledQueryRules',
      'microsoft.alertsmanagement/smartDetectorAlertRules',
    ]) {
      const result = run(baseArgs, { FAKE_ALERT: resourceType })
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /owner invariant requires zero/)
    }
  })
})
