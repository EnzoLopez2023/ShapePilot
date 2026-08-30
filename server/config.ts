// Validated startup configuration.
//
// Everything the process needs is read once, validated once, and frozen. There
// is no dotenv: App Service (and `node --env-file` locally) already supply the
// environment, and a missing required value must stop the process rather than
// be defaulted into something insecure.
import { dirname, isAbsolute, join, resolve } from 'node:path'

export type NodeEnvironment = 'development' | 'test' | 'production'

export interface AuthConfig {
  /** Entra tenant the app accepts tokens from. */
  tenantId: string
  /** Expected access-token `aud` claim (the API client id for Entra v2). */
  audience: string
  /** Delegated scope the SPA must present. */
  requiredScope: string
  /** Additional accepted issuers, derived from the tenant. */
  issuers: string[]
  jwksUri: string
  /** OIDs granted `admin` the first time they sign in. */
  bootstrapAdminOids: string[]
  /**
   * Development-only bypass. Never reachable in production: the constructor
   * throws if it is requested there.
   */
  devBypass: {
    enabled: boolean
    tenantId: string
    oid: string
    name: string
    email: string
    role: 'user' | 'admin'
  }
}

export interface AppConfig {
  nodeEnv: NodeEnvironment
  port: number
  database: {
    path: string
    busyTimeoutMs: number
    createIfMissing: boolean
    initializeEmptySeed: boolean
    emptySeedMarkerPath: string
  }
  auth: AuthConfig
  /** External filesystem destination for backup bundles and export artifacts. */
  artifactStoreDir: string | null
  /** Bounded scratch space used only by explicit recovery commands. */
  recoveryWorkDir: string | null
  /** Serve the built SPA from this directory when it exists. */
  clientDir: string
  ai: AiConfig
  /**
   * Where imported design assets live. Derived from the database's own
   * directory rather than configured, deliberately: it needs no new App Service
   * setting, and the deploy job asserts that settings map exactly.
   */
  assetStoreDir: string
}

/**
 * The dedicated Azure AI Foundry resource. Absent configuration disables the AI
 * routes rather than failing startup: the designers work without them, and a
 * missing model deployment should not take the whole app down.
 */
export interface AiConfig {
  enabled: boolean
  /** Base URL including the /openai/v1/ route, which uses implicit versioning. */
  endpoint: string | null
  /** Deployment name, passed as `model`. Pinning the deployment rather than the
   *  model means the model can be swapped in Azure with no code change. */
  deployment: string | null
  /** Development only. Production authenticates with the managed identity. */
  apiKey: string | null
}

export class ConfigError extends Error {
  readonly code: string
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ConfigError'
    this.code = code
  }
}

const GUID_TEXT = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const GUID = new RegExp(`^${GUID_TEXT}$`, 'i')
const API_CLIENT_ID_URI = new RegExp(`^api://(${GUID_TEXT})$`, 'i')

const required = (env: NodeJS.ProcessEnv, key: string): string => {
  const value = env[key]?.trim()
  if (!value) throw new ConfigError('CONFIG_MISSING', `${key} is required`)
  return value
}

const bool = (value: string | undefined): boolean =>
  value != null && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())

const aliased = (
  env: NodeJS.ProcessEnv,
  canonical: string,
  compatibility: string,
): string | undefined => {
  const canonicalValue = env[canonical]?.trim()
  const compatibilityValue = env[compatibility]?.trim()
  if (canonicalValue && compatibilityValue && canonicalValue !== compatibilityValue) {
    throw new ConfigError(
      'CONFIG_CONFLICT',
      `${canonical} and ${compatibility} must match when both are set`,
    )
  }
  return canonicalValue || compatibilityValue
}

/**
 * Foundry configuration. Both values are non-secret, so they are plain app
 * settings; the credential is a managed-identity token acquired at call time.
 * AZURE_OPENAI_API_KEY stays supported as a local-development fallback only.
 */
/**
 * App Service passes a Key Vault reference through verbatim when it cannot
 * resolve it, so an unresolved secret arrives looking exactly like a value.
 * Treating that as a credential produces a 401 on every call and a confusing
 * one, because the setting looks populated.
 */
const KEY_VAULT_REFERENCE = /^@Microsoft\.KeyVault\(/i

/**
 * The key path is a local-development convenience and nothing more. Production
 * authenticates with the Web App's managed identity, which is what
 * .env.example promises and what the Foundry guidance recommends; honouring a
 * key there would silently downgrade to a long-lived credential that grants
 * full access to the resource and has to be rotated by hand.
 */
function developmentApiKey(env: NodeJS.ProcessEnv, isProduction: boolean): string | null {
  const raw = env.AZURE_OPENAI_API_KEY?.trim()
  if (!raw || isProduction) return null
  return KEY_VAULT_REFERENCE.test(raw) ? null : raw
}

function aiConfig(env: NodeJS.ProcessEnv, isProduction: boolean): AiConfig {
  const endpoint = env.AZURE_AI_FOUNDRY_ENDPOINT?.trim() || null
  const deployment = env.AZURE_AI_FOUNDRY_DEPLOYMENT?.trim() || null
  if (endpoint && !/^https:\/\/[^\s]+$/.test(endpoint)) {
    throw new ConfigError('CONFIG_INVALID', 'AZURE_AI_FOUNDRY_ENDPOINT must be an https URL')
  }
  // Half-configured is a mistake worth catching, unlike not configured at all.
  if (Boolean(endpoint) !== Boolean(deployment)) {
    throw new ConfigError(
      'CONFIG_CONFLICT',
      'AZURE_AI_FOUNDRY_ENDPOINT and AZURE_AI_FOUNDRY_DEPLOYMENT must be set together',
    )
  }
  return {
    enabled: Boolean(endpoint && deployment),
    endpoint,
    deployment,
    apiKey: developmentApiKey(env, isProduction),
  }
}

const absolutePath = (
  raw: string,
  key: string,
  cwd: string,
  requireAbsolute: boolean,
): string => {
  if (requireAbsolute && !isAbsolute(raw)) {
    throw new ConfigError('CONFIG_INVALID', `${key} must be an absolute path in production`)
  }
  return isAbsolute(raw) ? raw : resolve(cwd, raw)
}

const intInRange = (
  raw: string | undefined, fallback: number, min: number, max: number, key: string,
): number => {
  if (raw == null || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConfigError('CONFIG_INVALID', `${key} must be an integer between ${min} and ${max}`)
  }
  return parsed
}

const normalizeEnv = (raw: string | undefined): NodeEnvironment => {
  if (raw == null || raw.trim() === '') {
    throw new ConfigError(
      'CONFIG_MISSING',
      'NODE_ENV is required; use npm start for production or set development/test explicitly',
    )
  }
  const value = raw.trim().toLowerCase()
  if (value === 'production' || value === 'test' || value === 'development') return value
  throw new ConfigError('CONFIG_INVALID', `NODE_ENV must be development, test or production`)
}

const DEV_TENANT = '00000000-0000-0000-0000-000000000000'
const DEV_OID = '11111111-1111-1111-1111-111111111111'

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): AppConfig {
  const nodeEnv = normalizeEnv(env.NODE_ENV)
  const isProduction = nodeEnv === 'production'

  const devBypassRequested = bool(env.SHAPEPILOT_DEV_AUTH)
  if (devBypassRequested && isProduction) {
    // Fail closed. A production process must never accept an unsigned identity.
    throw new ConfigError(
      'DEV_AUTH_FORBIDDEN_IN_PRODUCTION',
      'SHAPEPILOT_DEV_AUTH cannot be enabled when NODE_ENV=production',
    )
  }
  if (isProduction) {
    for (const key of [
      'PORT',
      'DB_PATH',
      'SQLITE_JOURNAL_MODE',
      'BACKUP_ROOT',
      'RECOVERY_WORK_ROOT',
      'AAD_TENANT_ID',
      'SHAPEPILOT_ENTRA_TENANT_ID',
      'SHAPEPILOT_API_AUDIENCE',
    ]) {
      required(env, key)
    }
  }

  const configuredTenantId = aliased(env, 'AAD_TENANT_ID', 'SHAPEPILOT_ENTRA_TENANT_ID')
  const tenantId = isProduction || !devBypassRequested
    ? (configuredTenantId || required(env, 'SHAPEPILOT_ENTRA_TENANT_ID'))
    : (configuredTenantId || DEV_TENANT)
  const configuredAudience = isProduction || !devBypassRequested
    ? required(env, 'SHAPEPILOT_API_AUDIENCE')
    : (env.SHAPEPILOT_API_AUDIENCE?.trim() || 'api://shapepilot-dev')
  const clientId = env.VITE_AZURE_CLIENT_ID?.trim()
  if (clientId && !GUID.test(clientId)) {
    throw new ConfigError('CONFIG_INVALID', 'VITE_AZURE_CLIENT_ID must be a GUID')
  }
  // Scopes use the App ID URI, but a v2 access token's aud claim is the bare
  // API application (client) ID.
  const resourceClientId = API_CLIENT_ID_URI.exec(configuredAudience)?.[1]
  const directClientId = GUID.test(configuredAudience) ? configuredAudience : undefined
  const audience = (resourceClientId ?? directClientId)?.toLowerCase() ?? configuredAudience
  if (isProduction && clientId && audience.toLowerCase() !== clientId.toLowerCase()) {
    throw new ConfigError(
      'CONFIG_CONFLICT',
      'SHAPEPILOT_API_AUDIENCE must identify the configured ShapePilot client ID',
    )
  }

  const dbPathRaw = aliased(env, 'DB_PATH', 'SHAPEPILOT_DB_PATH')
    || (isProduction ? required(env, 'DB_PATH') : 'data/shapepilot.db')
  const initializeEmptySeedValue = env.SHAPEPILOT_INITIALIZE_EMPTY_DB?.trim()
  if (initializeEmptySeedValue && (!isProduction || initializeEmptySeedValue !== '1')) {
    throw new ConfigError(
      'CONFIG_INVALID',
      'SHAPEPILOT_INITIALIZE_EMPTY_DB is permitted only as exact value 1 in production',
    )
  }
  const journalMode = env.SQLITE_JOURNAL_MODE?.trim()
  if (isProduction && journalMode !== 'DELETE') {
    throw new ConfigError(
      journalMode ? 'CONFIG_INVALID' : 'CONFIG_MISSING',
      'SQLITE_JOURNAL_MODE=DELETE is required in production',
    )
  }
  if (isProduction && bool(env.SHAPEPILOT_DB_ALLOW_CREATE)) {
    throw new ConfigError(
      'CONFIG_INVALID',
      'SHAPEPILOT_DB_ALLOW_CREATE cannot be enabled in production',
    )
  }

  const bootstrapAdminOids = (env.SHAPEPILOT_ADMIN_OIDS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  for (const oid of bootstrapAdminOids) {
    if (!GUID.test(oid)) {
      throw new ConfigError('CONFIG_INVALID', 'SHAPEPILOT_ADMIN_OIDS must contain GUIDs only')
    }
  }

  const devRole: 'user' | 'admin' = env.SHAPEPILOT_DEV_AUTH_ROLE?.trim() === 'user' ? 'user' : 'admin'
  const devOid = (env.SHAPEPILOT_DEV_AUTH_OID?.trim() || DEV_OID).toLowerCase()
  if (devBypassRequested && !GUID.test(devOid)) {
    throw new ConfigError('CONFIG_INVALID', 'SHAPEPILOT_DEV_AUTH_OID must be a GUID')
  }

  const artifactStoreRaw = aliased(
    env,
    'BACKUP_ROOT',
    'SHAPEPILOT_ARTIFACT_STORE_DIR',
  ) || (isProduction ? required(env, 'BACKUP_ROOT') : undefined)
  const artifactStoreDir = artifactStoreRaw
    ? absolutePath(artifactStoreRaw, 'BACKUP_ROOT', cwd, isProduction)
    : null
  const recoveryWorkRaw = aliased(
    env,
    'RECOVERY_WORK_ROOT',
    'SHAPEPILOT_RECOVERY_WORK_DIR',
  )
  const recoveryWorkDir = recoveryWorkRaw
    ? absolutePath(recoveryWorkRaw, 'RECOVERY_WORK_ROOT', cwd, isProduction)
    : !isProduction && artifactStoreDir
      ? join(artifactStoreDir, '.work')
      : null

  const databasePath = absolutePath(dbPathRaw, 'DB_PATH', cwd, isProduction)
  return Object.freeze({
    nodeEnv,
    port: intInRange(
      isProduction ? required(env, 'PORT') : env.PORT,
      8080,
      1,
      65_535,
      'PORT',
    ),
    database: {
      path: databasePath,
      busyTimeoutMs: intInRange(
        env.SHAPEPILOT_DB_BUSY_TIMEOUT_MS, 5_000, 100, 60_000, 'SHAPEPILOT_DB_BUSY_TIMEOUT_MS'),
      // An absent file in production means the volume did not mount.
      createIfMissing: !isProduction,
      initializeEmptySeed: initializeEmptySeedValue === '1',
      emptySeedMarkerPath: join(dirname(databasePath), '.shapepilot-empty-seed.json'),
    },
    auth: {
      tenantId,
      audience,
      requiredScope: env.SHAPEPILOT_API_SCOPE?.trim() || 'access_as_user',
      issuers: [
        `https://login.microsoftonline.com/${tenantId}/v2.0`,
        `https://sts.windows.net/${tenantId}/`,
      ],
      jwksUri: env.SHAPEPILOT_JWKS_URI?.trim()
        || `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
      bootstrapAdminOids,
      devBypass: {
        enabled: devBypassRequested,
        tenantId: (env.SHAPEPILOT_DEV_AUTH_TENANT_ID?.trim() || tenantId).toLowerCase(),
        oid: devOid,
        name: env.SHAPEPILOT_DEV_AUTH_NAME?.trim() || 'Local Developer',
        email: env.SHAPEPILOT_DEV_AUTH_EMAIL?.trim() || 'developer@localhost',
        role: devRole,
      },
    },
    artifactStoreDir,
    recoveryWorkDir,
    clientDir: resolve(cwd, env.SHAPEPILOT_CLIENT_DIR?.trim() || 'dist/client'),
    ai: aiConfig(env, isProduction),
    assetStoreDir: env.SHAPEPILOT_ASSET_DIR?.trim()
      ? absolutePath(env.SHAPEPILOT_ASSET_DIR.trim(), 'SHAPEPILOT_ASSET_DIR', cwd, isProduction)
      : join(dirname(databasePath), 'assets'),
  })
}
