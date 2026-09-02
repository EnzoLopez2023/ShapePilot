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
const resources = Object.values(JSON.parse(process.env.FAKE_ALERTS_JSON || '{}')).flat()
if (args[1] === 'show') {
  const id = args[args.indexOf('--ids') + 1]
  const resource = resources.find((candidate) => candidate.id === id)
  if (!resource) throw new Error('unknown alert: ' + id)
  process.stdout.write(JSON.stringify(resource))
} else {
  const type = args[args.indexOf('--resource-type') + 1]
  const summaries = resources
    .filter((resource) =>
      (resource.listType || resource.type).toLowerCase() === type.toLowerCase())
    .map((resource) => ({ id: resource.id, type: resource.listType || resource.type }))
  process.stdout.write(JSON.stringify(summaries))
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
const resourceGroupId = '/subscriptions/test/resourceGroups/rg-personal-apps-prod'
const shapePilotWebAppId =
  `${resourceGroupId}/providers/Microsoft.Web/sites/app-shapepilot-prod-lwxhu7jxlrbtu`
const foreignWebAppId =
  `${resourceGroupId}/providers/Microsoft.Web/sites/app-cairn-prod`
const foreignComponentId =
  `${resourceGroupId}/providers/Microsoft.Insights/components/app-cairn-prod`
const foreignWorkspaceId =
  `${resourceGroupId}/providers/Microsoft.OperationalInsights/workspaces/ws-cairn-prod`
const actionGroupId =
  `${resourceGroupId}/providers/Microsoft.Insights/actionGroups/ag-shared-prod`
const alertTypes = [
  'Microsoft.Insights/metricAlerts',
  'Microsoft.Insights/scheduledQueryRules',
  'microsoft.alertsmanagement/smartDetectorAlertRules',
] as const

type AlertType = typeof alertTypes[number]

interface FakeAlert {
  id: string
  location: string
  name: string
  type: AlertType
  properties: Record<string, unknown>
}

function alert(type: AlertType, properties: Record<string, unknown>): FakeAlert {
  const name = type.split('/').at(-1)?.toLowerCase()
  const requiredProperties: Record<AlertType, Record<string, unknown>> = {
    'Microsoft.Insights/metricAlerts': {
      enabled: true,
      evaluationFrequency: 'PT1M',
      severity: 2,
      windowSize: 'PT5M',
    },
    'Microsoft.Insights/scheduledQueryRules': {
      enabled: true,
      evaluationFrequency: 'PT5M',
      severity: 2,
      windowSize: 'PT5M',
    },
    'microsoft.alertsmanagement/smartDetectorAlertRules': {
      frequency: 'PT5M',
      severity: 'Sev2',
      state: 'Enabled',
    },
  }
  return {
    id: `${resourceGroupId}/providers/${type}/foreign-${name}`,
    name: `foreign-${name}`,
    location: type.toLowerCase().includes('smartdetector') ? 'global' : 'eastus',
    type,
    properties: {
      ...requiredProperties[type],
      ...properties,
    },
  }
}

const foreignAlerts: Record<AlertType, FakeAlert> = {
  'Microsoft.Insights/metricAlerts': alert(
    'Microsoft.Insights/metricAlerts',
    {
      scopes: [foreignWebAppId],
      criteria: {
        'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria',
        allOf: [{
          name: 'Http5xx',
          criterionType: 'StaticThresholdCriterion',
          metricName: 'Http5xx',
          operator: 'GreaterThan',
          threshold: 0,
          timeAggregation: 'Total',
          dimensions: [{
            name: 'ResourceId',
            operator: 'Include',
            values: [foreignWebAppId],
          }],
        }],
      },
    },
  ),
  'Microsoft.Insights/scheduledQueryRules': alert(
    'Microsoft.Insights/scheduledQueryRules',
    {
      scopes: [foreignWorkspaceId],
      criteria: {
        allOf: [{
          query: 'AppRequests | where AppRoleName == "app-cairn-prod"',
          operator: 'GreaterThan',
          threshold: 0,
          timeAggregation: 'Count',
        }],
      },
      targetResourceTypes: ['Microsoft.Web/sites'],
    },
  ),
  'microsoft.alertsmanagement/smartDetectorAlertRules': alert(
    'microsoft.alertsmanagement/smartDetectorAlertRules',
    {
      scope: [foreignComponentId],
      detector: { id: 'FailureAnomaliesDetector' },
      actionGroups: { groupIds: [actionGroupId] },
    },
  ),
}

const ownedAlerts: Record<AlertType, FakeAlert> = {
  'Microsoft.Insights/metricAlerts': alert(
    'Microsoft.Insights/metricAlerts',
    {
      scopes: [shapePilotWebAppId],
      criteria: {
        'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria',
        allOf: [{
          name: 'Http5xx',
          criterionType: 'StaticThresholdCriterion',
          metricName: 'Http5xx',
          operator: 'GreaterThan',
          threshold: 0,
          timeAggregation: 'Total',
        }],
      },
    },
  ),
  'Microsoft.Insights/scheduledQueryRules': alert(
    'Microsoft.Insights/scheduledQueryRules',
    {
      scopes: [foreignWorkspaceId],
      criteria: {
        allOf: [{
          query:
            'AppRequests | where AppRoleName == "app-shapepilot-prod-lwxhu7jxlrbtu"',
          operator: 'GreaterThan',
          threshold: 0,
          timeAggregation: 'Count',
        }],
      },
    },
  ),
  'microsoft.alertsmanagement/smartDetectorAlertRules': alert(
    'microsoft.alertsmanagement/smartDetectorAlertRules',
    {
      scope: [
        `${resourceGroupId}/providers/Microsoft.Insights/components/app-shapepilot-prod`,
      ],
      detector: { id: 'FailureAnomaliesDetector' },
      actionGroups: { groupIds: [actionGroupId] },
    },
  ),
}

const nestedOwnedAlerts: Record<AlertType, FakeAlert> = {
  'Microsoft.Insights/metricAlerts': alert(
    'Microsoft.Insights/metricAlerts',
    {
      scopes: [foreignWebAppId],
      criteria: {
        'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria',
        allOf: [{
          name: 'Http5xx',
          criterionType: 'StaticThresholdCriterion',
          metricName: 'Http5xx',
          operator: 'GreaterThan',
          threshold: 0,
          timeAggregation: 'Total',
          dimensions: [{
            name: 'ResourceId',
            operator: 'Include',
            values: [shapePilotWebAppId],
          }],
        }],
      },
    },
  ),
  'Microsoft.Insights/scheduledQueryRules': alert(
    'Microsoft.Insights/scheduledQueryRules',
    {
      enabled: 'true',
      source: {
        dataSourceId: foreignWorkspaceId,
        authorizedResources: [shapePilotWebAppId],
        query: 'requests | where cloud_RoleName == "app-cairn-prod"',
      },
      action: {
        'odata.type':
          'Microsoft.WindowsAzure.Management.Monitoring.Alerts.Models.Microsoft.AppInsights.Nexus.DataContracts.Resources.ScheduledQueryRules.AlertingAction',
        severity: '2',
        trigger: {
          threshold: 0,
          thresholdOperator: 'GreaterThan',
        },
      },
      schedule: {
        frequencyInMinutes: 5,
        timeWindowInMinutes: 5,
      },
    },
  ),
  'microsoft.alertsmanagement/smartDetectorAlertRules': alert(
    'microsoft.alertsmanagement/smartDetectorAlertRules',
    {
      scope: [foreignComponentId],
      detector: {
        id: 'FailureAnomaliesDetector',
        parameters: { targetResourceId: shapePilotWebAppId },
      },
      actionGroups: { groupIds: [actionGroupId] },
    },
  ),
}

const malformedAlerts: Record<AlertType, FakeAlert> = {
  'Microsoft.Insights/metricAlerts': alert(
    'Microsoft.Insights/metricAlerts',
    {
      scopes: [foreignWebAppId],
      criteria: {
        'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria',
        allOf: [{}],
      },
    },
  ),
  'Microsoft.Insights/scheduledQueryRules': alert(
    'Microsoft.Insights/scheduledQueryRules',
    {
      scopes: [foreignWorkspaceId],
      criteria: { allOf: [{}] },
    },
  ),
  'microsoft.alertsmanagement/smartDetectorAlertRules': alert(
    'microsoft.alertsmanagement/smartDetectorAlertRules',
    {
      scope: [foreignComponentId],
      detector: {},
      actionGroups: { groupIds: [actionGroupId] },
    },
  ),
}

const run = (args = baseArgs, alerts: unknown[] = []) =>
  spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      FAKE_ALERTS_JSON: JSON.stringify({ alerts }),
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

  test.each(alertTypes)('accepts a foreign %s resource', (resourceType) => {
    const result = run(baseArgs, [foreignAlerts[resourceType]])
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout) as {
      alertCounts: Record<string, number>
    }
    assert.equal(report.alertCounts[resourceType], 1)
  })

  test('accepts a foreign legacy scheduled-query source', () => {
    const result = run(baseArgs, [
      alert('Microsoft.Insights/scheduledQueryRules', {
        enabled: 'true',
        source: {
          dataSourceId: foreignWorkspaceId,
          authorizedResources: [foreignWebAppId],
          query: 'requests | where cloud_RoleName == "app-cairn-prod"',
        },
        action: {
          'odata.type':
            'Microsoft.WindowsAzure.Management.Monitoring.Alerts.Models.Microsoft.AppInsights.Nexus.DataContracts.Resources.ScheduledQueryRules.AlertingAction',
          severity: '2',
          trigger: {
            threshold: 0,
            thresholdOperator: 'GreaterThan',
          },
        },
        schedule: {
          frequencyInMinutes: 5,
          timeWindowInMinutes: 5,
        },
      }),
    ])
    assert.equal(result.status, 0, result.stderr)
  })

  test('accepts a foreign legacy log-to-metric rule without a source query', () => {
    const result = run(baseArgs, [
      alert('Microsoft.Insights/scheduledQueryRules', {
        enabled: 'true',
        source: {
          dataSourceId: foreignWorkspaceId,
          authorizedResources: [foreignWebAppId],
        },
        action: {
          'odata.type':
            'Microsoft.WindowsAzure.Management.Monitoring.Alerts.Models.Microsoft.AppInsights.Nexus.DataContracts.Resources.ScheduledQueryRules.LogToMetricAction',
          criteria: [{ metricName: 'ForeignRequestCount' }],
        },
      }),
    ])
    assert.equal(result.status, 0, result.stderr)
  })

  test.each(alertTypes)('rejects an owned %s resource', (resourceType) => {
    const result = run(baseArgs, [ownedAlerts[resourceType]])
    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      new RegExp(
        `owner invariant requires zero ${resourceType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} resources`,
      ),
    )
  })

  test.each(alertTypes)(
    'rejects nested ShapePilot ownership in a %s resource',
    (resourceType) => {
      const result = run(baseArgs, [nestedOwnedAlerts[resourceType]])
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /owner invariant requires zero/)
    },
  )

  test.each(alertTypes)(
    'fails closed for a shared-resource-group %s scope',
    (resourceType) => {
      const broadAlert = structuredClone(foreignAlerts[resourceType])
      if ('scopes' in broadAlert.properties) {
        broadAlert.properties.scopes = [resourceGroupId]
      } else {
        broadAlert.properties.scope = [resourceGroupId]
      }
      const result = run(baseArgs, [broadAlert])
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /owner invariant requires zero/)
    },
  )

  test('rejects a top-level embedded ShapePilot resource ID', () => {
    const topLevelReference = {
      ...foreignAlerts['Microsoft.Insights/metricAlerts'],
      identity: {
        type: 'UserAssigned',
        userAssignedIdentities: {
          [`${resourceGroupId}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-shapepilot-prod`]:
            {},
        },
      },
    }
    const result = run(baseArgs, [topLevelReference])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /owner invariant requires zero/)
  })

  test('rejects an embedded shared-resource-group ID as ambiguous ownership', () => {
    const embeddedBroadScope = structuredClone(
      foreignAlerts['Microsoft.Insights/scheduledQueryRules'],
    )
    const criteria = embeddedBroadScope.properties.criteria as {
      allOf: Array<{ query: string }>
    }
    criteria.allOf[0].query =
      `AppRequests | where _ResourceId startswith "${resourceGroupId}"`
    const result = run(baseArgs, [embeddedBroadScope])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /owner invariant requires zero/)
  })

  test('fails closed when hydrated details omit their resource type', () => {
    const { type, ...missingType } = foreignAlerts['Microsoft.Insights/metricAlerts']
    const result = run(baseArgs, [{ ...missingType, listType: type }])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /invalid Microsoft\.Insights\/metricAlerts resource/)
  })

  test('accepts foreign PromQL metric criteria', () => {
    const result = run(baseArgs, [
      alert('Microsoft.Insights/metricAlerts', {
        scopes: [foreignWorkspaceId],
        criteria: {
          'odata.type': 'Microsoft.Azure.Monitor.PromQLCriteria',
          allOf: [{
            name: 'ForeignRequestRate',
            query: 'sum(rate(http_requests_total{app="cairn"}[5m]))',
            criterionType: 'StaticThresholdCriterion',
          }],
        },
      }),
    ])
    assert.equal(result.status, 0, result.stderr)
  })

  test.each([
    ['Microsoft.Insights/metricAlerts', 'enabled'],
    ['Microsoft.Insights/scheduledQueryRules', 'enabled'],
    ['microsoft.alertsmanagement/smartDetectorAlertRules', 'frequency'],
  ] as const)(
    'fails closed when %s omits required %s details',
    (resourceType, requiredProperty) => {
      const partialAlert = structuredClone(foreignAlerts[resourceType])
      delete partialAlert.properties[requiredProperty]
      const result = run(baseArgs, [partialAlert])
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /Azure CLI returned/)
    },
  )

  test.each(alertTypes)('fails closed for malformed %s details', (resourceType) => {
    const result = run(baseArgs, [malformedAlerts[resourceType]])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Azure CLI returned/)
  })
})
