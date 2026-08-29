import { execFileSync } from 'node:child_process'

interface Arguments {
  clientId: string
  tenantId: string
  subscriptionId: string
  resourceGroup: string
  registry: string
  webApp: string
  requireWebAppRole: boolean
}

interface ExpectedAssignment {
  roleDefinitionId: string
  scope: string
  required: boolean
}

const ROLE_IDS = {
  reader: 'acdd72a7-3385-48ef-bd42-f606fba81ae7',
  acrPush: '8311e382-0749-4cb8-b61a-304f252e45ec',
  acrDelete: 'c2f4ef07-c644-48eb-af81-4b1b4947fb11',
  websiteContributor: 'de139f84-1756-47ae-9be6-808fbbe84772',
} as const

const object = (value: unknown, description: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Azure CLI returned invalid ${description}`)
  }
  return value as Record<string, unknown>
}

function parseArguments(args: string[]): Arguments {
  const values = new Map<string, string>()
  let requireWebAppRole = false
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === '--require-web-app-role') {
      if (requireWebAppRole) throw new Error(`duplicate argument ${flag}`)
      requireWebAppRole = true
      continue
    }
    const value = args[index + 1]
    if (!flag?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`invalid argument near ${flag ?? '<end>'}`)
    }
    const key = flag.slice(2)
    if (values.has(key)) throw new Error(`duplicate argument ${flag}`)
    values.set(key, value)
    index += 1
  }
  const allowed = new Set([
    'client-id',
    'tenant-id',
    'subscription-id',
    'resource-group',
    'registry',
    'web-app',
  ])
  for (const key of values.keys()) {
    if (!allowed.has(key)) throw new Error(`unknown argument --${key}`)
  }
  const required = (key: string): string => {
    const value = values.get(key)
    if (!value) throw new Error(`--${key} is required`)
    return value
  }
  return {
    clientId: required('client-id'),
    tenantId: required('tenant-id'),
    subscriptionId: required('subscription-id'),
    resourceGroup: required('resource-group'),
    registry: required('registry'),
    webApp: required('web-app'),
    requireWebAppRole,
  }
}

function azJson(args: string[]): unknown {
  const output = execFileSync(
    'az',
    [...args, '--only-show-errors', '--output', 'json'],
    {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  return JSON.parse(output) as unknown
}

const normalize = (value: string): string => value.toLowerCase().replace(/\/+$/, '')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function deploymentPrincipal(options: Arguments): string {
  const tokenResponse = object(azJson([
    'account', 'get-access-token',
    '--resource', 'https://management.azure.com/',
  ]), 'ARM access token')
  if (typeof tokenResponse.accessToken !== 'string') {
    throw new Error('Azure CLI did not return an ARM access token')
  }
  const segments = tokenResponse.accessToken.split('.')
  if (segments.length !== 3) throw new Error('Azure CLI returned an invalid ARM access token')
  let claims: Record<string, unknown>
  try {
    claims = object(
      JSON.parse(Buffer.from(segments[1]!, 'base64url').toString('utf8')) as unknown,
      'ARM access token claims',
    )
  } catch {
    throw new Error('Azure CLI returned invalid ARM access token claims')
  }
  const principalId = claims.oid
  const clientId = claims.appid ?? claims.azp
  if (
    typeof principalId !== 'string'
    || !UUID.test(principalId)
    || normalize(String(clientId)) !== normalize(options.clientId)
    || normalize(String(claims.tid)) !== normalize(options.tenantId)
  ) {
    throw new Error('Azure login identity is outside the approved OIDC contract')
  }
  return principalId
}

function expectedAssignments(options: Arguments): ExpectedAssignment[] {
  const resourceGroupScope =
    `/subscriptions/${options.subscriptionId}/resourceGroups/${options.resourceGroup}`
  const registryScope =
    `${resourceGroupScope}/providers/Microsoft.ContainerRegistry/registries/${options.registry}`
  const webAppScope =
    `${resourceGroupScope}/providers/Microsoft.Web/sites/${options.webApp}`
  const roleDefinition = (roleId: string): string =>
    `/subscriptions/${options.subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleId}`

  return [
    {
      roleDefinitionId: roleDefinition(ROLE_IDS.reader),
      scope: resourceGroupScope,
      required: true,
    },
    {
      roleDefinitionId: roleDefinition(ROLE_IDS.acrPush),
      scope: registryScope,
      required: true,
    },
    {
      roleDefinitionId: roleDefinition(ROLE_IDS.acrDelete),
      scope: registryScope,
      required: true,
    },
    {
      roleDefinitionId: roleDefinition(ROLE_IDS.websiteContributor),
      scope: webAppScope,
      required: options.requireWebAppRole,
    },
  ]
}

try {
  const options = parseArguments(process.argv.slice(2))
  const principalId = deploymentPrincipal(options)
  const expected = expectedAssignments(options)
  const scopes = [
    expected[0]!.scope,
    expected[1]!.scope,
    ...(options.requireWebAppRole ? [expected[3]!.scope] : []),
  ]
  const rawAssignments: unknown[] = []
  for (const scope of scopes) {
    const rawAtScope = azJson([
      'role', 'assignment', 'list',
      '--assignee-object-id', principalId,
      '--scope', scope,
      '--include-inherited',
    ])
    if (!Array.isArray(rawAtScope)) {
      throw new Error(`Azure CLI returned invalid role assignments at ${scope}`)
    }
    rawAssignments.push(...rawAtScope)
  }

  const observedByContract = new Map<string, {
    scope: string
    roleDefinitionId: string
  }>()
  rawAssignments.forEach((raw, index) => {
    const assignment = object(raw, `role assignment ${index}`)
    if (
      typeof assignment.scope !== 'string'
      || typeof assignment.roleDefinitionId !== 'string'
      || assignment.principalType !== 'ServicePrincipal'
    ) {
      throw new Error(`Azure CLI returned an invalid role assignment ${index}`)
    }
    const normalized = {
      scope: normalize(assignment.scope),
      roleDefinitionId: normalize(assignment.roleDefinitionId),
    }
    observedByContract.set(`${normalized.scope}|${normalized.roleDefinitionId}`, normalized)
  })
  const observed = [...observedByContract.values()]

  for (const assignment of observed) {
    if (!expected.some((candidate) =>
      normalize(candidate.scope) === assignment.scope
      && normalize(candidate.roleDefinitionId) === assignment.roleDefinitionId)) {
      throw new Error(
        `deploy identity has an unapproved role assignment at ${assignment.scope}`,
      )
    }
  }
  for (const candidate of expected) {
    const count = observed.filter((assignment) =>
      assignment.scope === normalize(candidate.scope)
      && assignment.roleDefinitionId === normalize(candidate.roleDefinitionId)).length
    if (count > 1 || (candidate.required && count !== 1)) {
      throw new Error(`deploy identity role assignment count is invalid at ${candidate.scope}`)
    }
  }

  console.log(JSON.stringify({
    status: 'ok',
    assignments: observed.length,
    webAppRoleRequired: options.requireWebAppRole,
  }))
} catch (error) {
  console.error(
    `Deployment RBAC contract check failed: ${error instanceof Error ? error.message : error}`,
  )
  process.exitCode = 1
}
