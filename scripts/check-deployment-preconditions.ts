import { AssertionError } from 'node:assert'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  parseArguments as parseMigrationArguments,
  runMigrationCheck,
} from './check-deploy-migration.ts'
import {
  parseArguments as parseMonitorArguments,
  runMonitorCheck,
} from './check-deploy-monitor.ts'
import {
  parseArguments as parseVerificationArguments,
  verifyDeployment,
} from './verify-deployment.mjs'

const execFile = promisify(execFileCallback)
const AZURE_TIMEOUT_MS = 30_000
const RESOURCE_GROUP = 'rg-personal-apps-prod'
const WEBAPP = 'app-shapepilot-prod-lwxhu7jxlrbtu'
const PRODUCTION_URL = `https://${WEBAPP}.azurewebsites.net`
const ACR_LOGIN_SERVER = 'acrenzolopez01.azurecr.io'
const IMAGE_REPOSITORY = 'shapepilot'
const USER_TENANT_ID = '52188f12-db6b-46c6-88ff-08c802f0ed3b'
const CLIENT_ID = '60b0b8cf-f1e2-4ba4-b89b-7d6dc3358251'

const EXPECTED_SETTINGS = Object.freeze({
  NODE_ENV: 'production',
  PORT: '3000',
  WEBSITES_PORT: '3000',
  WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'true',
  WEBSITES_CONTAINER_STOP_TIME_LIMIT: '60',
  DOCKER_REGISTRY_SERVER_URL: `https://${ACR_LOGIN_SERVER}`,
  KEY_VAULT_URI: 'https://kv-shapepilot-prod.vault.azure.net/',
  DB_PATH: '/home/data/shapepilot.db',
  SQLITE_JOURNAL_MODE: 'DELETE',
  SHAPEPILOT_DB_BUSY_TIMEOUT_MS: '5000',
  SHAPEPILOT_DB_ALLOW_CREATE: '0',
  BACKUP_ROOT: '/home/data/backups/shapepilot',
  RECOVERY_WORK_ROOT: '/home/data/recovery/shapepilot',
  BACKUP_RETENTION_COUNT: '14',
  BACKUP_INTERVAL_HOURS: '24',
  OFFHOST_BACKUP_ENABLED: 'false',
  OFFHOST_BACKUP_ACCOUNT: 'strecoverywkhiw2g4hwik4',
  OFFHOST_BACKUP_CONTAINER: 'shapepilot',
  OFFHOST_BACKUP_SCAN_INTERVAL_MINUTES: '60',
  OFFHOST_BACKUP_STALE_HOURS: '26',
  OFFHOST_BACKUP_HEALTH_LOOKBACK_HOURS: '2',
  OFFHOST_BACKUP_DAILY_HEALTH_MAX_SOURCE_AGE_HOURS: '23',
  OFFHOST_BACKUP_MONTHLY_STALE_DAYS: '35',
  OFFHOST_BACKUP_CLOCK_SKEW_MINUTES: '5',
  AAD_TENANT_ID: USER_TENANT_ID,
  SHAPEPILOT_ENTRA_TENANT_ID: USER_TENANT_ID,
  SHAPEPILOT_API_AUDIENCE: `api://${CLIENT_ID}`,
  SHAPEPILOT_API_SCOPE: 'access_as_user',
  VITE_AZURE_CLIENT_ID: CLIENT_ID,
  AZURE_OPENAI_API_KEY:
    '@Microsoft.KeyVault(SecretUri=https://kv-shapepilot-prod.vault.azure.net/secrets/AZURE-OPENAI-API-KEY/)',
  AZURE_AI_FOUNDRY_ENDPOINT:
    'https://aif-shapepilot-prod.openai.azure.com/openai/v1/',
  AZURE_AI_FOUNDRY_DEPLOYMENT: 'shapepilot-designer',
})

const EXPECTED_RECOVERY_SETTINGS = Object.freeze({
  BACKUP_ROOT: EXPECTED_SETTINGS.BACKUP_ROOT,
  RECOVERY_WORK_ROOT: EXPECTED_SETTINGS.RECOVERY_WORK_ROOT,
  BACKUP_RETENTION_COUNT: EXPECTED_SETTINGS.BACKUP_RETENTION_COUNT,
  BACKUP_INTERVAL_HOURS: EXPECTED_SETTINGS.BACKUP_INTERVAL_HOURS,
  OFFHOST_BACKUP_ENABLED: EXPECTED_SETTINGS.OFFHOST_BACKUP_ENABLED,
  OFFHOST_BACKUP_ACCOUNT: EXPECTED_SETTINGS.OFFHOST_BACKUP_ACCOUNT,
  OFFHOST_BACKUP_CONTAINER: EXPECTED_SETTINGS.OFFHOST_BACKUP_CONTAINER,
  OFFHOST_BACKUP_SCAN_INTERVAL_MINUTES:
    EXPECTED_SETTINGS.OFFHOST_BACKUP_SCAN_INTERVAL_MINUTES,
  OFFHOST_BACKUP_STALE_HOURS: EXPECTED_SETTINGS.OFFHOST_BACKUP_STALE_HOURS,
  OFFHOST_BACKUP_HEALTH_LOOKBACK_HOURS:
    EXPECTED_SETTINGS.OFFHOST_BACKUP_HEALTH_LOOKBACK_HOURS,
  OFFHOST_BACKUP_DAILY_HEALTH_MAX_SOURCE_AGE_HOURS:
    EXPECTED_SETTINGS.OFFHOST_BACKUP_DAILY_HEALTH_MAX_SOURCE_AGE_HOURS,
  OFFHOST_BACKUP_MONTHLY_STALE_DAYS:
    EXPECTED_SETTINGS.OFFHOST_BACKUP_MONTHLY_STALE_DAYS,
  OFFHOST_BACKUP_CLOCK_SKEW_MINUTES:
    EXPECTED_SETTINGS.OFFHOST_BACKUP_CLOCK_SKEW_MINUTES,
})

interface Options {
  [key: string]: string
}

export interface PrecheckReport {
  schema_version: '1.0'
  check: string
  ok: boolean
  detail: string
  [key: string]: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseOptions(args: string[]): Options {
  const options: Options = {}
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token?.startsWith('--')) throw new Error(`unexpected argument: ${token ?? '<end>'}`)
    const equals = token.indexOf('=')
    const key = token.slice(2, equals === -1 ? undefined : equals)
    const value = equals === -1 ? args[++index] : token.slice(equals + 1)
    if (!key || value == null || value === '') throw new Error(`missing value for --${key}`)
    if (key in options) throw new Error(`duplicate argument --${key}`)
    options[key] = value
  }
  return options
}

function requireOption(options: Options, key: string): string {
  const value = options[key]
  if (!value) throw new Error(`--${key} is required`)
  return value
}

function allowOnly(options: Options, keys: readonly string[]): void {
  const allowed = new Set(keys)
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw new Error(`unknown argument --${key}`)
  }
}

function exactTarget(options: Options): void {
  if (
    requireOption(options, 'resource-group') !== RESOURCE_GROUP
    || requireOption(options, 'webapp') !== WEBAPP
  ) {
    throw new Error('deployment precheck is scoped only to the declared ShapePilot resources')
  }
}

function settingsMap(value: unknown): Map<string, string> {
  if (!Array.isArray(value)) throw new Error('Azure CLI returned malformed app settings')
  const result = new Map<string, string>()
  for (const setting of value) {
    if (!isObject(setting) || typeof setting.name !== 'string'
      || typeof setting.value !== 'string' || result.has(setting.name)) {
      throw new Error('Azure CLI returned malformed app settings')
    }
    result.set(setting.name, setting.value)
  }
  return result
}

function mismatchNames(
  settings: Map<string, string>,
  expected: Readonly<Record<string, string>>,
): string[] {
  return Object.entries(expected)
    .filter(([name, value]) => settings.get(name) !== value)
    .map(([name]) => name)
    .sort()
}

export function evaluateProtectedConfiguration(
  rawSettings: unknown,
  rawSite: unknown,
): PrecheckReport {
  const settings = settingsMap(rawSettings)
  if (!isObject(rawSite)) throw new Error('Azure CLI returned malformed site configuration')
  const mismatchedSettingNames = mismatchNames(settings, EXPECTED_SETTINGS)
  if (settings.has('SHAPEPILOT_INITIALIZE_EMPTY_DB')) {
    mismatchedSettingNames.push('SHAPEPILOT_INITIALIZE_EMPTY_DB')
    mismatchedSettingNames.sort()
  }
  const image = typeof rawSite.linuxFxVersion === 'string' ? rawSite.linuxFxVersion : ''
  const invariants = {
    always_on: rawSite.alwaysOn === true,
    one_worker: rawSite.numberOfWorkers === 1,
    process_health_path: rawSite.healthCheckPath === '/api/live',
    managed_identity_acr_pull: rawSite.acrUseManagedIdentityCreds === true,
    immutable_image_reference: new RegExp(
      `^DOCKER\\|${ACR_LOGIN_SERVER}/${IMAGE_REPOSITORY}@sha256:[0-9a-f]{64}$`,
    ).test(image),
  }
  const ok = mismatchedSettingNames.length === 0 && Object.values(invariants).every(Boolean)
  return {
    schema_version: '1.0',
    check: 'protected-configuration-precheck',
    ok,
    detail: ok
      ? 'Required setting names and protected site invariants match the ShapePilot contract.'
      : 'One or more required setting names or protected site invariants do not match.',
    required_setting_names: Object.keys(EXPECTED_SETTINGS).sort(),
    mismatched_setting_names: mismatchedSettingNames,
    site_invariants: invariants,
  }
}

export function evaluateRecovery(
  rawSettings: unknown,
  rawReadiness: unknown,
): PrecheckReport {
  const settings = settingsMap(rawSettings)
  if (!isObject(rawReadiness)) throw new Error('readiness endpoint returned malformed JSON')
  const database = isObject(rawReadiness.database) ? rawReadiness.database : {}
  const configurationMismatches = mismatchNames(settings, EXPECTED_RECOVERY_SETTINGS)
  const runtime = {
    ready: rawReadiness.status === 'ready' && rawReadiness.lifecycle === 'ready',
    database_reachable: database.reachable === true,
    persistent_authority: database.authority === '/home/data/shapepilot.db',
    delete_journal: String(database.journalMode ?? '').toLowerCase() === 'delete',
    foreign_keys: database.foreignKeys === true,
    schema_identity_matches:
      typeof database.schemaIdentity === 'string'
      && database.schemaIdentity === database.expectedSchemaIdentity,
    head_migration_matches:
      typeof database.headMigration === 'string'
      && database.headMigration === database.expectedHeadMigration,
  }
  const durableRuntime = Object.values(runtime).every(Boolean)
  const backupFreshnessObservable = false
  const ok = configurationMismatches.length === 0
    && durableRuntime
    && backupFreshnessObservable
  return {
    schema_version: '1.0',
    check: 'recovery-precondition-precheck',
    ok,
    detail: !durableRuntime
      ? 'The current release does not prove the durable SQLite recovery prerequisites.'
      : configurationMismatches.length > 0
        ? 'One or more recovery setting names do not match the ShapePilot contract.'
        : 'Durable runtime checks pass, but off-host backup freshness is not observable.',
    required_setting_names: Object.keys(EXPECTED_RECOVERY_SETTINGS).sort(),
    mismatched_setting_names: configurationMismatches,
    durable_runtime: runtime,
    off_host_backup_freshness: 'not-observable',
  }
}

async function azJson(args: string[]): Promise<unknown> {
  const { stdout } = await execFile(
    'az',
    [...args, '--only-show-errors', '--output', 'json'],
    {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: AZURE_TIMEOUT_MS,
    },
  )
  try {
    return JSON.parse(stdout) as unknown
  } catch {
    throw new Error('Azure CLI returned malformed JSON')
  }
}

async function fetchReadiness(baseUrl: string): Promise<unknown> {
  if (baseUrl !== PRODUCTION_URL) {
    throw new Error('readiness precheck must use the direct ShapePilot production origin')
  }
  const url = new URL('/api/ready', baseUrl)
  url.searchParams.set('deployment-diagnostic', `${Date.now()}`)
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`readiness endpoint returned HTTP ${response.status}`)
  const cacheControl = response.headers.get('cache-control') ?? ''
  if (!cacheControl.toLowerCase().split(',').map((value) => value.trim()).includes('no-store')) {
    throw new Error('readiness endpoint did not return Cache-Control: no-store')
  }
  try {
    return await response.json() as unknown
  } catch {
    throw new Error('readiness endpoint returned malformed JSON')
  }
}

async function migrationReport(options: Options): Promise<PrecheckReport> {
  allowOnly(options, ['profile', 'initial', 'report'])
  const initial = requireOption(options, 'initial')
  if (!['true', 'false'].includes(initial)) throw new Error('--initial must be true or false')
  try {
    const result = await runMigrationCheck(parseMigrationArguments([
      '--profile', requireOption(options, 'profile'),
      ...(initial === 'true' ? ['--initial'] : []),
    ]))
    return {
      schema_version: '1.0',
      check: 'migration-compatibility-precheck',
      ok: true,
      detail: 'Candidate migrations preserve the checked rollback-readable lineage.',
      ...result,
    }
  } catch (error) {
    if (!(error instanceof AssertionError)) throw error
    return {
      schema_version: '1.0',
      check: 'migration-compatibility-precheck',
      ok: false,
      detail: 'Candidate migration compatibility did not pass.',
    }
  }
}

async function readinessReport(options: Options): Promise<PrecheckReport> {
  allowOnly(options, [
    'base-url',
    'expected-sha',
    'expected-build-id',
    'attempts',
    'confirmations',
    'interval-ms',
    'request-timeout-ms',
    'run-token',
    'report',
  ])
  const verificationOptions = parseVerificationArguments([
    '--base-url', requireOption(options, 'base-url'),
    '--live-path', '/api/live',
    '--ready-path', '/api/ready',
    '--profile', 'sqlite-one-worker',
    '--expected-sha', requireOption(options, 'expected-sha'),
    '--expected-build-id', requireOption(options, 'expected-build-id'),
    '--attempts', requireOption(options, 'attempts'),
    '--confirmations', requireOption(options, 'confirmations'),
    '--interval-ms', requireOption(options, 'interval-ms'),
    '--request-timeout-ms', requireOption(options, 'request-timeout-ms'),
    '--run-token', requireOption(options, 'run-token'),
  ])
  try {
    const result = await verifyDeployment(verificationOptions)
    return {
      schema_version: '1.0',
      check: 'readiness-precondition-precheck',
      ok: true,
      detail: 'The current production release passed consecutive readiness confirmations.',
      confirmations: result.confirmations,
      instance_id: result.instanceId,
    }
  } catch {
    return {
      schema_version: '1.0',
      check: 'readiness-precondition-precheck',
      ok: false,
      detail: 'The current production release did not pass the readiness precondition.',
    }
  }
}

async function recoveryReport(options: Options): Promise<PrecheckReport> {
  allowOnly(options, ['base-url', 'resource-group', 'webapp', 'report'])
  exactTarget(options)
  const [settings, readiness] = await Promise.all([
    azJson([
      'webapp', 'config', 'appsettings', 'list',
      '--resource-group', RESOURCE_GROUP,
      '--name', WEBAPP,
    ]),
    fetchReadiness(requireOption(options, 'base-url')),
  ])
  return evaluateRecovery(settings, readiness)
}

function monitoringReport(options: Options): PrecheckReport {
  allowOnly(options, ['phase', 'base-url', 'resource-group', 'webapp', 'report'])
  exactTarget(options)
  try {
    const result = runMonitorCheck(parseMonitorArguments([
      '--phase', requireOption(options, 'phase'),
      '--resource-group', RESOURCE_GROUP,
      '--webapp', WEBAPP,
      '--base-url', requireOption(options, 'base-url'),
    ]))
    return {
      schema_version: '1.0',
      check: 'monitoring-precheck',
      ok: true,
      detail: 'The ShapePilot-owned alert invariant remains at zero resources.',
      ...result,
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (/owner invariant requires zero/.test(detail)) {
      return {
        schema_version: '1.0',
        check: 'monitoring-precheck',
        ok: false,
        detail: 'A ShapePilot-owned monitoring resource violates the zero-alert invariant.',
      }
    }
    throw error
  }
}

async function protectedConfigurationReport(options: Options): Promise<PrecheckReport> {
  allowOnly(options, ['resource-group', 'webapp', 'report'])
  exactTarget(options)
  const [settings, site] = await Promise.all([
    azJson([
      'webapp', 'config', 'appsettings', 'list',
      '--resource-group', RESOURCE_GROUP,
      '--name', WEBAPP,
    ]),
    azJson([
      'webapp', 'config', 'show',
      '--resource-group', RESOURCE_GROUP,
      '--name', WEBAPP,
      '--query',
      '{alwaysOn:alwaysOn,numberOfWorkers:numberOfWorkers,healthCheckPath:healthCheckPath,acrUseManagedIdentityCreds:acrUseManagedIdentityCreds,linuxFxVersion:linuxFxVersion}',
    ]),
  ])
  return evaluateProtectedConfiguration(settings, site)
}

async function runCheck(command: string | undefined, options: Options): Promise<PrecheckReport> {
  switch (command) {
    case 'migration':
      return migrationReport(options)
    case 'readiness':
      return readinessReport(options)
    case 'recovery':
      return recoveryReport(options)
    case 'monitoring':
      return monitoringReport(options)
    case 'protected-configuration':
      return protectedConfigurationReport(options)
    default:
      throw new Error(`unknown deployment precheck: ${command ?? '<none>'}`)
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = args
  let reportPath: string | undefined
  try {
    const options = parseOptions(rest)
    reportPath = resolve(requireOption(options, 'report'))
    rmSync(reportPath, { force: true })
    const report = await runCheck(command, options)
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) console.error(report.detail)
    process.exitCode = report.ok ? 0 : 1
  } catch (error) {
    if (reportPath) rmSync(reportPath, { force: true })
    console.error(
      `Deployment precheck execution failed: ${error instanceof Error ? error.message : error}`,
    )
    process.exitCode = 2
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === new URL(process.argv[1], 'file:').href
if (invokedDirectly) {
  await main()
}
