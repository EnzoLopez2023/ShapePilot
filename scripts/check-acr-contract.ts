import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

interface Arguments {
  registry: string
  loginServer: string
  resourceGroup: string
  subscriptionId: string
  repository: string
  expectedSiblingFingerprint?: string
}

const object = (value: unknown, description: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Azure CLI returned invalid ${description}`)
  }
  return value as Record<string, unknown>
}

const required = (values: Map<string, string>, key: string): string => {
  const value = values.get(key)
  if (!value) throw new Error(`--${key} is required`)
  return value
}

function parseArguments(args: string[]): Arguments {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!flag?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`invalid argument near ${flag ?? '<end>'}`)
    }
    const key = flag.slice(2)
    if (values.has(key)) throw new Error(`duplicate argument ${flag}`)
    values.set(key, value)
  }
  const allowed = new Set([
    'registry',
    'login-server',
    'resource-group',
    'subscription-id',
    'repository',
    'expected-sibling-fingerprint',
  ])
  for (const key of values.keys()) {
    if (!allowed.has(key)) throw new Error(`unknown argument --${key}`)
  }
  const parsed: Arguments = {
    registry: required(values, 'registry'),
    loginServer: required(values, 'login-server'),
    resourceGroup: required(values, 'resource-group'),
    subscriptionId: required(values, 'subscription-id'),
    repository: required(values, 'repository'),
  }
  const expected = values.get('expected-sibling-fingerprint')
  if (expected) parsed.expectedSiblingFingerprint = expected
  return parsed
}

function azJson(args: string[]): unknown {
  const output = execFileSync(
    'az',
    [...args, '--only-show-errors', '--output', 'json'],
    {
      encoding: 'utf8',
      maxBuffer: 100 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  return JSON.parse(output) as unknown
}

const lower = (value: unknown): string => String(value ?? '').toLowerCase()
const DIGEST = /^sha256:[0-9a-f]{64}$/
const FINGERPRINT = /^[0-9a-f]{64}$/
const REPOSITORY = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/

function validateRegistry(registry: Record<string, unknown>, options: Arguments): void {
  const expectedId = [
    '',
    'subscriptions',
    options.subscriptionId,
    'resourceGroups',
    options.resourceGroup,
    'providers',
    'Microsoft.ContainerRegistry',
    'registries',
    options.registry,
  ].join('/')
  const sku = object(registry.sku, 'registry SKU')
  if (
    registry.name !== options.registry
    || registry.loginServer !== options.loginServer
    || registry.adminUserEnabled !== false
    || registry.publicNetworkAccess !== 'Enabled'
    || registry.roleAssignmentMode !== 'LegacyRegistryPermissions'
    || sku.name !== 'Basic'
    || lower(registry.id) !== expectedId.toLowerCase()
  ) {
    throw new Error('shared ACR is outside the approved immutable contract')
  }
}

function siblingFingerprint(options: Arguments): string {
  const rawRepositories = azJson([
    'acr', 'repository', 'list',
    '--name', options.registry,
  ])
  if (!Array.isArray(rawRepositories)
    || rawRepositories.some((value) => typeof value !== 'string')) {
    throw new Error('Azure CLI returned an invalid repository catalog')
  }
  const repositories = [...new Set(rawRepositories as string[])].sort()
  if (repositories.some((value) => !REPOSITORY.test(value))) {
    throw new Error('shared ACR returned an invalid repository name')
  }

  const catalog = repositories
    .filter((repository) => repository !== options.repository)
    .map((repository) => {
      const rawManifests = azJson([
        'acr', 'manifest', 'list-metadata',
        '--registry', options.registry,
        '--name', repository,
      ])
      if (!Array.isArray(rawManifests)) {
        throw new Error(`Azure CLI returned invalid manifests for ${repository}`)
      }
      const digests = rawManifests.map((manifest) => {
        const digest = object(manifest, `manifest for ${repository}`).digest
        if (typeof digest !== 'string' || !DIGEST.test(digest)) {
          throw new Error(`shared ACR returned an invalid digest for ${repository}`)
        }
        return digest
      })
      return { repository, digests: [...new Set(digests)].sort() }
    })

  return createHash('sha256').update(JSON.stringify(catalog)).digest('hex')
}

try {
  const options = parseArguments(process.argv.slice(2))
  if (!REPOSITORY.test(options.repository)) {
    throw new Error('--repository is not a valid lowercase ACR repository')
  }
  if (options.expectedSiblingFingerprint
    && !FINGERPRINT.test(options.expectedSiblingFingerprint)) {
    throw new Error('--expected-sibling-fingerprint must be a SHA-256 value')
  }
  const registry = object(azJson([
    'acr', 'show',
    '--resource-group', options.resourceGroup,
    '--name', options.registry,
  ]), 'registry')
  validateRegistry(registry, options)
  const fingerprint = siblingFingerprint(options)
  if (options.expectedSiblingFingerprint
    && fingerprint !== options.expectedSiblingFingerprint) {
    throw new Error('a sibling ACR repository name or digest changed during deployment')
  }
  console.log(JSON.stringify({
    status: 'ok',
    registry: options.registry,
    repository: options.repository,
    siblingFingerprint: fingerprint,
  }))
} catch (error) {
  console.error(
    `Shared ACR contract check failed: ${error instanceof Error ? error.message : error}`,
  )
  process.exitCode = 1
}
