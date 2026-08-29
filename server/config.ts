// Validated startup configuration.
//
// Everything the process needs is read once, validated once, and frozen. There
// is no dotenv: App Service (and `node --env-file` locally) already supply the
// environment, and a missing required value must stop the process rather than
// be defaulted into something insecure.
import { isAbsolute, resolve } from 'node:path'

export type NodeEnvironment = 'development' | 'test' | 'production'

export interface AuthConfig {
  /** Entra tenant the app accepts tokens from. */
  tenantId: string
  /** ShapePilot's own API audience (`api://<id>` or the API app's client id). */
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
  }
  auth: AuthConfig
  /** External filesystem destination for backup bundles and export artifacts. */
  artifactStoreDir: string | null
  /** Serve the built SPA from this directory when it exists. */
  clientDir: string
}

export class ConfigError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ConfigError'
    this.code = code
  }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const required = (env: NodeJS.ProcessEnv, key: string): string => {
  const value = env[key]?.trim()
  if (!value) throw new ConfigError('CONFIG_MISSING', `${key} is required`)
  return value
}

const bool = (value: string | undefined): boolean =>
  value != null && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())

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

  const tenantId = isProduction || !devBypassRequested
    ? required(env, 'SHAPEPILOT_ENTRA_TENANT_ID')
    : (env.SHAPEPILOT_ENTRA_TENANT_ID?.trim() || DEV_TENANT)
  const audience = isProduction || !devBypassRequested
    ? required(env, 'SHAPEPILOT_API_AUDIENCE')
    : (env.SHAPEPILOT_API_AUDIENCE?.trim() || 'api://shapepilot-dev')

  const dbPathRaw = env.SHAPEPILOT_DB_PATH?.trim()
    || (isProduction ? '/home/data/shapepilot.db' : 'data/shapepilot.db')

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

  const artifactStoreDir = env.SHAPEPILOT_ARTIFACT_STORE_DIR?.trim()

  return Object.freeze({
    nodeEnv,
    port: intInRange(env.PORT, 8080, 1, 65_535, 'PORT'),
    database: {
      path: isAbsolute(dbPathRaw) ? dbPathRaw : resolve(cwd, dbPathRaw),
      busyTimeoutMs: intInRange(
        env.SHAPEPILOT_DB_BUSY_TIMEOUT_MS, 5_000, 100, 60_000, 'SHAPEPILOT_DB_BUSY_TIMEOUT_MS'),
      // An absent file in production means the volume did not mount.
      createIfMissing: !isProduction || bool(env.SHAPEPILOT_DB_ALLOW_CREATE),
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
    artifactStoreDir: artifactStoreDir ? resolve(cwd, artifactStoreDir) : null,
    clientDir: resolve(cwd, env.SHAPEPILOT_CLIENT_DIR?.trim() || 'dist/client'),
  })
}
