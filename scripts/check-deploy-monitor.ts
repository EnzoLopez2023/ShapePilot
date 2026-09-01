import { execFileSync } from 'node:child_process'

const RESOURCE_GROUP = 'rg-personal-apps-prod'
const WEBAPP = 'app-shapepilot-prod-lwxhu7jxlrbtu'
const PRODUCTION_URL = `https://${WEBAPP}.azurewebsites.net`
const ALERT_RESOURCE_TYPES = [
  'Microsoft.Insights/metricAlerts',
  'Microsoft.Insights/scheduledQueryRules',
  'microsoft.alertsmanagement/smartDetectorAlertRules',
] as const
const METRIC_ALERT_RESOURCE_TYPE = ALERT_RESOURCE_TYPES[0]
const SHAPEPILOT_RESOURCE_PATH =
  `/resourcegroups/${RESOURCE_GROUP}/providers/microsoft.web/sites/${WEBAPP}`.toLowerCase()
const RESOURCE_CRITERIA_KEYS = new Set([
  '_resourceid',
  'appname',
  'resource',
  'resourceid',
  'resourcename',
  'resourceuri',
  'sitename',
  'webappname',
])
const ALLOWED_PHASES = new Set([
  'image-publication',
  'predeploy',
  'postdeploy',
  'rollback',
  'initial-predeploy',
  'initial-postdeploy',
])

interface Arguments {
  phase: string
  resourceGroup: string
  webapp: string
  baseUrl: string
}

function parseArguments(args: string[]): Arguments {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!flag?.startsWith('--') || value == null || value.startsWith('--')) {
      throw new Error(`invalid argument near ${flag ?? '<end>'}`)
    }
    const key = flag.slice(2)
    if (values.has(key)) throw new Error(`duplicate argument ${flag}`)
    values.set(key, value)
  }
  const allowed = new Set(['phase', 'resource-group', 'webapp', 'base-url'])
  for (const key of values.keys()) {
    if (!allowed.has(key)) throw new Error(`unknown argument --${key}`)
  }
  const phase = values.get('phase') ?? ''
  if (!ALLOWED_PHASES.has(phase)) throw new Error(`unsupported monitoring phase: ${phase}`)
  const resourceGroup = values.get('resource-group')
  const webapp = values.get('webapp')
  const baseUrl = values.get('base-url')
  if (!resourceGroup || !webapp || !baseUrl) {
    throw new Error('--resource-group, --webapp and --base-url are required')
  }
  if (resourceGroup !== RESOURCE_GROUP || webapp !== WEBAPP || baseUrl !== PRODUCTION_URL) {
    throw new Error('deployment check is scoped only to the declared ShapePilot resources')
  }
  const parsedUrl = new URL(baseUrl)
  if (parsedUrl.protocol !== 'https:'
    || parsedUrl.hostname !== `${WEBAPP}.azurewebsites.net`
    || parsedUrl.origin !== baseUrl) {
    throw new Error('deployment checks must use the direct Azure HTTPS origin')
  }
  return { phase, resourceGroup, webapp, baseUrl }
}

function azJson(args: string[]): unknown {
  const output = execFileSync('az', [...args, '--output', 'json'], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return JSON.parse(output) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function targetsShapePilotResource(value: string): boolean {
  const normalized = value.toLowerCase().replace(/\/+$/, '')
  return normalized === WEBAPP.toLowerCase()
    || normalized.endsWith(SHAPEPILOT_RESOURCE_PATH)
    || normalized.includes(`${SHAPEPILOT_RESOURCE_PATH}/`)
}

function criteriaTargetsShapePilot(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(criteriaTargetsShapePilot)
  }
  if (!isRecord(value)) return false

  if ('values' in value) {
    if (typeof value.name !== 'string'
      || typeof value.operator !== 'string'
      || !Array.isArray(value.values)
      || !value.values.every((candidate) => typeof candidate === 'string')) {
      throw new Error('Azure CLI returned a metric alert with invalid criteria dimensions')
    }
    const operator = value.operator.toLowerCase()
    if (operator !== 'include' && operator !== 'exclude') {
      throw new Error('Azure CLI returned a metric alert with an invalid dimension operator')
    }
    if (operator === 'include' && value.values.some(targetsShapePilotResource)) return true
  }

  return Object.entries(value).some(([key, candidate]) => {
    if (RESOURCE_CRITERIA_KEYS.has(key.toLowerCase())) {
      if (typeof candidate === 'string') return targetsShapePilotResource(candidate)
      if (Array.isArray(candidate)) {
        return candidate.some(
          (entry) => typeof entry === 'string' && targetsShapePilotResource(entry),
        )
      }
    }
    return criteriaTargetsShapePilot(candidate)
  })
}

function validateMetricCriterion(value: unknown): void {
  if (!isRecord(value)
    || typeof value.metricName !== 'string'
    || value.metricName.length === 0
    || typeof value.operator !== 'string'
    || value.operator.length === 0
    || typeof value.timeAggregation !== 'string'
    || value.timeAggregation.length === 0) {
    throw new Error('Azure CLI returned an invalid metric alert criterion')
  }
  if ('dimensions' in value) {
    if (!Array.isArray(value.dimensions)
      || !value.dimensions.every((dimension) =>
        isRecord(dimension)
        && typeof dimension.name === 'string'
        && typeof dimension.operator === 'string'
        && Array.isArray(dimension.values)
        && dimension.values.every((candidate) => typeof candidate === 'string'))) {
      throw new Error('Azure CLI returned a metric alert with invalid criteria dimensions')
    }
  }
}

function metricAlertTargetsShapePilot(resource: unknown): boolean {
  if (!isRecord(resource) || !isRecord(resource.properties)) {
    throw new Error('Azure CLI returned an invalid Microsoft.Insights/metricAlerts resource')
  }
  const { criteria, scopes } = resource.properties
  if (!Array.isArray(scopes)
    || scopes.length === 0
    || !scopes.every((scope) => typeof scope === 'string' && scope.length > 0)) {
    throw new Error('Azure CLI returned a metric alert with invalid scopes')
  }
  if (!isRecord(criteria)) {
    throw new Error('Azure CLI returned a metric alert with invalid criteria')
  }
  let hasMetricCriteria = false
  if ('allOf' in criteria) {
    if (!Array.isArray(criteria.allOf) || criteria.allOf.length === 0) {
      throw new Error('Azure CLI returned a metric alert with invalid criteria')
    }
    criteria.allOf.forEach(validateMetricCriterion)
    hasMetricCriteria = true
  }
  const hasWebTestCriteria =
    typeof criteria.componentId === 'string' && typeof criteria.webTestId === 'string'
  if (!hasMetricCriteria && !hasWebTestCriteria) {
    throw new Error('Azure CLI returned a metric alert with unsupported criteria')
  }
  return scopes.some(targetsShapePilotResource) || criteriaTargetsShapePilot(criteria)
}

function metricAlertDetails(resource: unknown): unknown {
  if (!isRecord(resource) || typeof resource.id !== 'string' || resource.id.length === 0) {
    throw new Error('Azure CLI returned a metric alert without a resource ID')
  }
  return azJson(['resource', 'show', '--ids', resource.id])
}

function alertCounts(resourceGroup: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const resourceType of ALERT_RESOURCE_TYPES) {
    const resources = azJson([
      'resource', 'list',
      '--resource-group', resourceGroup,
      '--resource-type', resourceType,
    ])
    if (!Array.isArray(resources)) {
      throw new Error(`Azure CLI returned invalid ${resourceType} resources`)
    }
    counts[resourceType] = resources.length
    const ownedResourceCount = resourceType === METRIC_ALERT_RESOURCE_TYPE
      ? resources.map(metricAlertDetails).filter(metricAlertTargetsShapePilot).length
      : resources.length
    if (ownedResourceCount !== 0) {
      throw new Error(`owner invariant requires zero ${resourceType} resources`)
    }
  }
  return counts
}

try {
  const options = parseArguments(process.argv.slice(2))
  console.log(JSON.stringify({
    status: 'ok',
    phase: options.phase,
    directHttpsOrigin: options.baseUrl,
    endpointAgreement: [
      '/version.json',
      '/api/version',
      '/api/live',
      '/api/ready',
    ],
    alertCounts: alertCounts(options.resourceGroup),
  }))
} catch (error) {
  console.error(
    `Deployment safety check failed: ${error instanceof Error ? error.message : error}`,
  )
  process.exitCode = 1
}
