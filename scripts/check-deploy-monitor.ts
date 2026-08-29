import { execFileSync } from 'node:child_process'

const RESOURCE_GROUP = 'rg-personal-apps-prod'
const WEBAPP = 'app-shapepilot-prod-lwxhu7jxlrbtu'
const PRODUCTION_URL = `https://${WEBAPP}.azurewebsites.net`
const ALERT_RESOURCE_TYPES = [
  'Microsoft.Insights/metricAlerts',
  'Microsoft.Insights/scheduledQueryRules',
  'microsoft.alertsmanagement/smartDetectorAlertRules',
] as const
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
    if (resources.length !== 0) {
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
