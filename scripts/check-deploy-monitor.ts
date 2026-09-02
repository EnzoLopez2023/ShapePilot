import { execFileSync } from 'node:child_process'

const RESOURCE_GROUP = 'rg-personal-apps-prod'
const WEBAPP = 'app-shapepilot-prod-lwxhu7jxlrbtu'
const PRODUCTION_URL = `https://${WEBAPP}.azurewebsites.net`
const SHAPEPILOT_RESOURCE_NAME = 'shapepilot'
const SHAPEPILOT_RESOURCE_PATH =
  `/resourcegroups/${RESOURCE_GROUP}/providers/microsoft.web/sites/${WEBAPP}`.toLowerCase()
const OWNERSHIP_FIELD_PATTERN =
  /^(?:_?resource(?:id|ids|name|uri)?|appname|criteria?|scopes?|site(?:name)?|sources?|targets?|webappname)$/i
const ARM_RESOURCE_ID_PATTERN = /\/subscriptions\/[^\s"'|,)\]}]+/gi
const ALLOWED_PHASES = new Set([
  'image-publication',
  'predeploy',
  'postdeploy',
  'rollback',
  'initial-predeploy',
  'initial-postdeploy',
])

export interface Arguments {
  phase: string
  resourceGroup: string
  webapp: string
  baseUrl: string
}

export function parseArguments(args: string[]): Arguments {
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
  const nameTokens = normalized.split(/[^a-z0-9]+/)
  return normalized === WEBAPP.toLowerCase()
    || normalized.endsWith(SHAPEPILOT_RESOURCE_PATH)
    || normalized.includes(`${SHAPEPILOT_RESOURCE_PATH}/`)
    || nameTokens.includes(SHAPEPILOT_RESOURCE_NAME)
}

function encompassesShapePilotResource(value: string): boolean {
  const normalized = value.toLowerCase().replace(/\/+$/, '')
  return targetsShapePilotResource(normalized)
    || /^\/subscriptions\/[^/]+$/.test(normalized)
    || normalized.endsWith(`/resourcegroups/${RESOURCE_GROUP.toLowerCase()}`)
}

function requireNonEmptyString(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(message)
}

function requireBoolean(value: unknown, message: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new Error(message)
}

function requireSeverity(value: unknown, message: string): asserts value is number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 4) {
    throw new Error(message)
  }
}

function requireResourceIds(value: unknown, message: string): asserts value is string[] {
  if (!Array.isArray(value)
    || value.length === 0
    || !value.every((candidate) =>
      typeof candidate === 'string'
      && /^\/subscriptions\/[^/]+(?:\/resourcegroups\/[^/]+(?:\/providers\/.+)?)?$/i.test(candidate))) {
    throw new Error(message)
  }
}

function ownershipReferencesShapePilot(value: unknown, inspectAllStrings = false): boolean {
  if (Array.isArray(value)) {
    return value.some((candidate) =>
      ownershipReferencesShapePilot(candidate, inspectAllStrings))
  }
  if (typeof value === 'string') {
    if (inspectAllStrings && encompassesShapePilotResource(value)) return true
    const resourceIds = value.match(ARM_RESOURCE_ID_PATTERN) ?? []
    return resourceIds.some(encompassesShapePilotResource)
  }
  if (!isRecord(value)) return false

  return Object.entries(value).some(([key, candidate]) => {
    if (key.toLowerCase().startsWith('/subscriptions/')
      && encompassesShapePilotResource(key)) return true
    if (/^_?resource(?:id|ids|uri)$/i.test(key)
      && typeof candidate !== 'string'
      && !(Array.isArray(candidate)
        && candidate.every((entry) => typeof entry === 'string'))) {
      throw new Error('Azure CLI returned invalid monitoring ownership data')
    }
    return ownershipReferencesShapePilot(
      candidate,
      inspectAllStrings || OWNERSHIP_FIELD_PATTERN.test(key),
    )
  })
}

function validateDimensions(value: unknown, resourceType: string): void {
  if (!Array.isArray(value)
    || !value.every((dimension) =>
      isRecord(dimension)
      && typeof dimension.name === 'string'
      && dimension.name.length > 0
      && typeof dimension.operator === 'string'
      && ['include', 'exclude'].includes(dimension.operator.toLowerCase())
      && Array.isArray(dimension.values)
      && dimension.values.every((candidate) =>
        typeof candidate === 'string' && candidate.length > 0))) {
    throw new Error(`Azure CLI returned ${resourceType} with invalid criteria dimensions`)
  }
}

function validateMetricCriterion(value: unknown, resourceType: string): void {
  if (!isRecord(value)
    || typeof value.name !== 'string'
    || value.name.length === 0
    || !['StaticThresholdCriterion', 'DynamicThresholdCriterion'].includes(
      typeof value.criterionType === 'string' ? value.criterionType : '',
    )
    || typeof value.metricName !== 'string'
    || value.metricName.length === 0
    || typeof value.operator !== 'string'
    || value.operator.length === 0
    || typeof value.timeAggregation !== 'string'
    || value.timeAggregation.length === 0) {
    throw new Error(`Azure CLI returned ${resourceType} with an invalid metric criterion`)
  }
  if ('dimensions' in value) {
    validateDimensions(value.dimensions, resourceType)
  }
  if (value.criterionType === 'DynamicThresholdCriterion') {
    if (typeof value.alertSensitivity !== 'string' || !isRecord(value.failingPeriods)) {
      throw new Error(`Azure CLI returned ${resourceType} with an invalid dynamic criterion`)
    }
  } else if (typeof value.threshold !== 'number' || !Number.isFinite(value.threshold)) {
    throw new Error(`Azure CLI returned ${resourceType} with an invalid static criterion`)
  }
}

function validatePromQueryCriterion(value: unknown, resourceType: string): void {
  if (!isRecord(value)) {
    throw new Error(`Azure CLI returned ${resourceType} with an invalid query criterion`)
  }
  requireNonEmptyString(
    value.name,
    `Azure CLI returned ${resourceType} with an invalid query criterion`,
  )
  requireNonEmptyString(
    value.query,
    `Azure CLI returned ${resourceType} with an invalid query criterion`,
  )
  if (!['StaticThresholdCriterion', 'DynamicThresholdCriterion'].includes(
    typeof value.criterionType === 'string' ? value.criterionType : '',
  )) {
    throw new Error(`Azure CLI returned ${resourceType} with an invalid query criterion`)
  }
}

function validateMetricAlert(properties: Record<string, unknown>, resourceType: string): void {
  const { criteria, scopes } = properties
  requireResourceIds(scopes, `Azure CLI returned ${resourceType} with invalid scopes`)
  requireBoolean(properties.enabled, `Azure CLI returned ${resourceType} without enabled state`)
  requireSeverity(properties.severity, `Azure CLI returned ${resourceType} with invalid severity`)
  requireNonEmptyString(
    properties.evaluationFrequency,
    `Azure CLI returned ${resourceType} with invalid evaluation frequency`,
  )
  requireNonEmptyString(
    properties.windowSize,
    `Azure CLI returned ${resourceType} with invalid window size`,
  )
  if (!isRecord(criteria)) {
    throw new Error(`Azure CLI returned ${resourceType} with invalid criteria`)
  }
  requireNonEmptyString(
    criteria['odata.type'],
    `Azure CLI returned ${resourceType} with invalid criteria`,
  )
  const criteriaType = criteria['odata.type'].toLowerCase()
  if (criteriaType.endsWith('.promqlcriteria')) {
    if (!Array.isArray(criteria.allOf) || criteria.allOf.length === 0) {
      throw new Error(`Azure CLI returned ${resourceType} with invalid criteria`)
    }
    criteria.allOf.forEach((criterion) => validatePromQueryCriterion(criterion, resourceType))
    return
  }
  if (criteriaType.endsWith('.webtestlocationavailabilitycriteria')) {
    requireResourceIds(
      [criteria.componentId, criteria.webTestId],
      `Azure CLI returned ${resourceType} with invalid availability criteria`,
    )
    if (!Number.isInteger(criteria.failedLocationCount)
      || Number(criteria.failedLocationCount) < 1) {
      throw new Error(`Azure CLI returned ${resourceType} with invalid availability criteria`)
    }
    return
  }
  if (!criteriaType.endsWith('.multipleresourcemultiplemetriccriteria')
    && !criteriaType.endsWith('.singleresourcemultiplemetriccriteria')) {
    throw new Error(`Azure CLI returned ${resourceType} with unsupported criteria`)
  }
  if (!Array.isArray(criteria.allOf) || criteria.allOf.length === 0) {
    throw new Error(`Azure CLI returned ${resourceType} with invalid criteria`)
  }
  criteria.allOf.forEach((criterion) => validateMetricCriterion(criterion, resourceType))
}

function validateFailingPeriods(value: unknown, resourceType: string): void {
  if (!isRecord(value)
    || !Number.isInteger(value.minFailingPeriodsToAlert)
    || !Number.isInteger(value.numberOfEvaluationPeriods)
    || Number(value.minFailingPeriodsToAlert) < 1
    || Number(value.numberOfEvaluationPeriods) < Number(value.minFailingPeriodsToAlert)) {
    throw new Error(`Azure CLI returned ${resourceType} with invalid failing periods`)
  }
}

function validateScheduledQueryAlert(
  properties: Record<string, unknown>,
  resourceType: string,
): void {
  const hasCurrentSchema = 'scopes' in properties || 'criteria' in properties
  const hasLegacySchema = 'source' in properties || 'action' in properties
  if (hasCurrentSchema === hasLegacySchema) {
    throw new Error(`Azure CLI returned ${resourceType} with an ambiguous schema`)
  }

  if (hasCurrentSchema) {
    requireResourceIds(
      properties.scopes,
      `Azure CLI returned ${resourceType} with invalid scopes`,
    )
    requireBoolean(
      properties.enabled,
      `Azure CLI returned ${resourceType} without enabled state`,
    )
    if (!isRecord(properties.criteria)
      || !Array.isArray(properties.criteria.allOf)
      || properties.criteria.allOf.length === 0) {
      throw new Error(`Azure CLI returned ${resourceType} with invalid criteria`)
    }
    for (const criterion of properties.criteria.allOf) {
      if (!isRecord(criterion)) {
        throw new Error(`Azure CLI returned ${resourceType} with invalid criteria`)
      }
      requireNonEmptyString(
        criterion.query,
        `Azure CLI returned ${resourceType} with an invalid query`,
      )
      if ('dimensions' in criterion) validateDimensions(criterion.dimensions, resourceType)
      if (typeof criterion.metricName === 'string' && criterion.metricName.length > 0) {
        continue
      }
      if (Number.isInteger(criterion.minRecurrenceCount)
        && Number(criterion.minRecurrenceCount) > 0) {
        continue
      }
      requireNonEmptyString(
        criterion.operator,
        `Azure CLI returned ${resourceType} with an invalid operator`,
      )
      requireNonEmptyString(
        criterion.timeAggregation,
        `Azure CLI returned ${resourceType} with an invalid aggregation`,
      )
      if (criterion.criterionType === 'DynamicThresholdCriterion') {
        requireNonEmptyString(
          criterion.alertSensitivity,
          `Azure CLI returned ${resourceType} with invalid alert sensitivity`,
        )
        validateFailingPeriods(criterion.failingPeriods, resourceType)
      } else if (typeof criterion.threshold !== 'number'
        || !Number.isFinite(criterion.threshold)) {
        throw new Error(`Azure CLI returned ${resourceType} with an invalid threshold`)
      }
    }
    if ('targetResourceTypes' in properties
      && (!Array.isArray(properties.targetResourceTypes)
        || properties.targetResourceTypes.length === 0
        || !properties.targetResourceTypes.every((targetType) =>
          typeof targetType === 'string'
          && /^[^./\s]+\.[^/\s]+\/[^/\s]+(?:\/[^/\s]+)*$/.test(targetType)))) {
      throw new Error(`Azure CLI returned ${resourceType} with invalid target resource types`)
    }
    return
  }

  if (!isRecord(properties.source) || !isRecord(properties.action)) {
    throw new Error(`Azure CLI returned ${resourceType} with invalid legacy properties`)
  }
  requireNonEmptyString(
    properties.action['odata.type'],
    `Azure CLI returned ${resourceType} with an invalid action`,
  )
  if (!['true', 'false'].includes(properties.enabled as string)) {
    throw new Error(`Azure CLI returned ${resourceType} without enabled state`)
  }
  requireNonEmptyString(
    properties.source.dataSourceId,
    `Azure CLI returned ${resourceType} with an invalid source`,
  )
  requireResourceIds(
    [properties.source.dataSourceId],
    `Azure CLI returned ${resourceType} with an invalid source`,
  )
  if ('authorizedResources' in properties.source) {
    const { authorizedResources } = properties.source
    if (!Array.isArray(authorizedResources)
      || !authorizedResources.every((resourceId) =>
        typeof resourceId === 'string'
        && /^\/subscriptions\/[^/]+(?:\/resourcegroups\/[^/]+(?:\/providers\/.+)?)?$/i
          .test(resourceId))) {
      throw new Error(`Azure CLI returned ${resourceType} with invalid authorized resources`)
    }
  }

  const actionType = properties.action['odata.type'].toLowerCase()
  if (actionType.endsWith('.alertingaction')) {
    requireNonEmptyString(
      properties.source.query,
      `Azure CLI returned ${resourceType} with an invalid query`,
    )
    if (!isRecord(properties.action.trigger)
      || typeof properties.action.trigger.threshold !== 'number'
      || !Number.isFinite(properties.action.trigger.threshold)) {
      throw new Error(`Azure CLI returned ${resourceType} with an invalid trigger`)
    }
    requireNonEmptyString(
      properties.action.trigger.thresholdOperator,
      `Azure CLI returned ${resourceType} with an invalid trigger`,
    )
    requireNonEmptyString(
      properties.action.severity,
      `Azure CLI returned ${resourceType} with invalid severity`,
    )
    if (!isRecord(properties.schedule)
      || !Number.isInteger(properties.schedule.frequencyInMinutes)
      || Number(properties.schedule.frequencyInMinutes) < 1
      || !Number.isInteger(properties.schedule.timeWindowInMinutes)
      || Number(properties.schedule.timeWindowInMinutes)
        < Number(properties.schedule.frequencyInMinutes)) {
      throw new Error(`Azure CLI returned ${resourceType} with an invalid schedule`)
    }
    return
  }
  if (!actionType.endsWith('.logtometricaction')
    || !Array.isArray(properties.action.criteria)
    || properties.action.criteria.length === 0
    || !properties.action.criteria.every((criterion) =>
      isRecord(criterion)
      && typeof criterion.metricName === 'string'
      && criterion.metricName.length > 0)) {
    throw new Error(`Azure CLI returned ${resourceType} with an unsupported action`)
  }
}

function validateSmartDetectorAlert(
  properties: Record<string, unknown>,
  resourceType: string,
): void {
  requireResourceIds(properties.scope, `Azure CLI returned ${resourceType} with invalid scope`)
  requireNonEmptyString(
    properties.frequency,
    `Azure CLI returned ${resourceType} with invalid frequency`,
  )
  if (!['Sev0', 'Sev1', 'Sev2', 'Sev3', 'Sev4'].includes(properties.severity as string)) {
    throw new Error(`Azure CLI returned ${resourceType} with invalid severity`)
  }
  if (!['Enabled', 'Disabled'].includes(properties.state as string)) {
    throw new Error(`Azure CLI returned ${resourceType} with invalid state`)
  }
  if (!isRecord(properties.detector)) {
    throw new Error(`Azure CLI returned ${resourceType} with an invalid detector`)
  }
  requireNonEmptyString(
    properties.detector.id,
    `Azure CLI returned ${resourceType} with an invalid detector`,
  )
  if (!isRecord(properties.actionGroups)
    || !Array.isArray(properties.actionGroups.groupIds)
    || !properties.actionGroups.groupIds.every((resourceId) =>
      typeof resourceId === 'string'
      && /^\/subscriptions\/[^/]+\/resourcegroups\/[^/]+\/providers\/.+$/i.test(resourceId))) {
    throw new Error(`Azure CLI returned ${resourceType} with invalid action groups`)
  }
}

interface AlertResourceModel {
  resourceType: string
  validate: (properties: Record<string, unknown>, resourceType: string) => void
}

const ALERT_RESOURCE_MODELS: readonly AlertResourceModel[] = [
  {
    resourceType: 'Microsoft.Insights/metricAlerts',
    validate: validateMetricAlert,
  },
  {
    resourceType: 'Microsoft.Insights/scheduledQueryRules',
    validate: validateScheduledQueryAlert,
  },
  {
    resourceType: 'microsoft.alertsmanagement/smartDetectorAlertRules',
    validate: validateSmartDetectorAlert,
  },
]

function alertTargetsShapePilot(
  resource: unknown,
  model: AlertResourceModel,
  expectedId: string,
): boolean {
  if (!isRecord(resource)
    || typeof resource.id !== 'string'
    || resource.id.toLowerCase() !== expectedId.toLowerCase()
    || typeof resource.name !== 'string'
    || resource.name.length === 0
    || typeof resource.location !== 'string'
    || resource.location.length === 0
    || typeof resource.type !== 'string'
    || resource.type.toLowerCase() !== model.resourceType.toLowerCase()
    || !isRecord(resource.properties)) {
    throw new Error(`Azure CLI returned an invalid ${model.resourceType} resource`)
  }
  model.validate(resource.properties, model.resourceType)
  return ownershipReferencesShapePilot(resource)
}

function alertCounts(resourceGroup: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const model of ALERT_RESOURCE_MODELS) {
    const resources = azJson([
      'resource', 'list',
      '--resource-group', resourceGroup,
      '--resource-type', model.resourceType,
    ])
    if (!Array.isArray(resources)) {
      throw new Error(`Azure CLI returned invalid ${model.resourceType} resources`)
    }
    counts[model.resourceType] = resources.length
    const ownedResourceCount = resources.filter((resource) => {
      if (!isRecord(resource) || typeof resource.id !== 'string' || resource.id.length === 0) {
        throw new Error(`Azure CLI returned ${model.resourceType} without a resource ID`)
      }
      const details = azJson(['resource', 'show', '--ids', resource.id])
      return alertTargetsShapePilot(details, model, resource.id)
    }).length
    if (ownedResourceCount !== 0) {
      throw new Error(`owner invariant requires zero ${model.resourceType} resources`)
    }
  }
  return counts
}

export function runMonitorCheck(options: Arguments): Record<string, unknown> {
  return {
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
  }
}

export function main(args = process.argv.slice(2)): void {
  try {
    const options = parseArguments(args)
    console.log(JSON.stringify(runMonitorCheck(options)))
  } catch (error) {
    console.error(
      `Deployment safety check failed: ${error instanceof Error ? error.message : error}`,
    )
    process.exitCode = 1
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === new URL(process.argv[1], 'file:').href
if (invokedDirectly) {
  main()
}
