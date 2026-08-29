import { randomUUID } from 'node:crypto'

const INTEGER = /^[1-9][0-9]*$/
const SHA = /^[0-9a-f]{40}$/
const BUILD_ID = /^[0-9]+-[0-9]+$/
const INSTANCE_ID = /^[A-Za-z0-9._:-]+$/
const PRODUCTION_HOST = 'app-shapepilot-prod-lwxhu7jxlrbtu.azurewebsites.net'

const fail = (message) => {
  throw new Error(message)
}

export function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value == null || value.startsWith('--')) {
      fail(`invalid argument near ${key ?? '<end>'}`)
    }
    if (values.has(key)) fail(`duplicate argument ${key}`)
    values.set(key, value)
  }

  const required = (key) => {
    const value = values.get(key)
    if (!value) fail(`${key} is required`)
    return value
  }
  const integer = (key, maximum) => {
    const value = required(key)
    if (!INTEGER.test(value) || Number(value) > maximum) {
      fail(`${key} must be an integer between 1 and ${maximum}`)
    }
    return Number(value)
  }

  const baseUrl = new URL(required('--base-url'))
  if (baseUrl.protocol !== 'https:'
    && !(baseUrl.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(baseUrl.hostname))) {
    fail('--base-url must use HTTPS, except for localhost smoke tests')
  }
  if (baseUrl.protocol === 'https:' && baseUrl.hostname !== PRODUCTION_HOST) {
    fail(`--base-url must use the direct production host ${PRODUCTION_HOST}`)
  }
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    fail('--base-url must be an origin without credentials, query, or fragment')
  }

  const profile = required('--profile')
  if (profile !== 'sqlite-one-worker') fail('ShapePilot requires --profile sqlite-one-worker')
  const expectedSha = required('--expected-sha')
  if (!SHA.test(expectedSha)) fail('--expected-sha must be a full lowercase Git SHA')
  const expectedBuildId = required('--expected-build-id')
  if (!BUILD_ID.test(expectedBuildId)) fail('--expected-build-id must be <run-id>-<run-attempt>')

  const confirmations = integer('--confirmations', 10)
  if (confirmations < 3) fail('--confirmations must be at least 3')
  const attempts = integer('--attempts', 120)
  if (attempts < confirmations) fail('--attempts cannot be less than --confirmations')

  const allowed = new Set([
    '--base-url', '--live-path', '--ready-path', '--profile', '--expected-sha',
    '--expected-build-id', '--attempts', '--confirmations', '--interval-ms',
    '--request-timeout-ms', '--run-token', '--previous-instance-id',
  ])
  for (const key of values.keys()) {
    if (!allowed.has(key)) fail(`unknown argument ${key}`)
  }

  return {
    baseUrl,
    livePath: pathArgument(required('--live-path'), '--live-path'),
    readyPath: pathArgument(required('--ready-path'), '--ready-path'),
    expectedSha,
    expectedBuildId,
    attempts,
    confirmations,
    intervalMs: integer('--interval-ms', 30_000),
    requestTimeoutMs: integer('--request-timeout-ms', 30_000),
    runToken: tokenArgument(required('--run-token'), '--run-token'),
    previousInstanceId: optionalInstance(values.get('--previous-instance-id')),
  }
}

function pathArgument(value, name) {
  if (!value.startsWith('/') || value.includes('?') || value.includes('#')) {
    fail(`${name} must be an absolute URL path without query or fragment`)
  }
  return value
}

function tokenArgument(value, name) {
  if (!INSTANCE_ID.test(value)) fail(`${name} has invalid characters`)
  return value
}

function optionalInstance(value) {
  if (value == null) return null
  return tokenArgument(value, '--previous-instance-id')
}

const release = (body) => ({
  sha: body.sha ?? body.commit,
  buildId: body.buildId ?? body.build,
})

async function getJson(url, timeoutMs) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) fail(`${url.pathname} returned HTTP ${response.status}`)
  const cacheControl = response.headers.get('cache-control') ?? ''
  if (!cacheControl.toLowerCase().split(',').map((value) => value.trim()).includes('no-store')) {
    fail(`${url.pathname} did not return Cache-Control: no-store`)
  }
  const body = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail(`${url.pathname} did not return a JSON object`)
  }
  return body
}

function endpointUrl(baseUrl, path, runToken, attempt) {
  const url = new URL(path, baseUrl)
  url.searchParams.set('deployment', runToken)
  url.searchParams.set('attempt', String(attempt))
  url.searchParams.set('nonce', randomUUID())
  return url
}

function validateRound(options, staticVersion, version, live, ready) {
  for (const [name, body] of [
    ['version.json', staticVersion],
    ['version', version],
    ['live', live],
    ['ready', ready],
  ]) {
    if (body.app !== 'shapepilot') fail(`${name} reported the wrong app identity`)
    const identity = release(body)
    if (identity.sha !== options.expectedSha || identity.buildId !== options.expectedBuildId) {
      fail(`${name} reported an unexpected release identity`)
    }
  }
  if (live.status !== 'ok' || live.lifecycle !== 'ready') {
    fail('liveness did not report a ready process')
  }
  if (ready.status !== 'ready' || ready.lifecycle !== 'ready') {
    fail('readiness did not report ready')
  }
  if (live.instanceId !== ready.instanceId || !INSTANCE_ID.test(live.instanceId ?? '')) {
    fail('liveness and readiness did not agree on a valid process identity')
  }
  if (options.previousInstanceId && live.instanceId === options.previousInstanceId) {
    fail('the prior process instance is still serving')
  }
  if (ready.database?.reachable !== true
    || String(ready.database?.journalMode).toLowerCase() !== 'delete'
    || ready.database?.foreignKeys !== true
    || ready.database?.schemaIdentity !== ready.database?.expectedSchemaIdentity
    || ready.database?.headMigration !== ready.database?.expectedHeadMigration) {
    fail('readiness did not prove the SQLite authority invariants')
  }
  return live.instanceId
}

export async function verifyDeployment(options) {
  let consecutive = 0
  let lastError = null
  let confirmedInstance = null

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const [staticVersion, version, live, ready] = await Promise.all([
        getJson(endpointUrl(options.baseUrl, '/version.json', options.runToken, attempt),
          options.requestTimeoutMs),
        getJson(endpointUrl(options.baseUrl, '/api/version', options.runToken, attempt),
          options.requestTimeoutMs),
        getJson(endpointUrl(options.baseUrl, options.livePath, options.runToken, attempt),
          options.requestTimeoutMs),
        getJson(endpointUrl(options.baseUrl, options.readyPath, options.runToken, attempt),
          options.requestTimeoutMs),
      ])
      const instanceId = validateRound(options, staticVersion, version, live, ready)
      if (confirmedInstance && confirmedInstance !== instanceId) {
        fail('process identity changed during confirmation')
      }
      confirmedInstance = instanceId
      consecutive += 1
      console.log(`deployment confirmation ${consecutive}/${options.confirmations}`)
      if (consecutive >= options.confirmations) {
        return { instanceId, confirmations: consecutive }
      }
      lastError = null
    } catch (error) {
      consecutive = 0
      confirmedInstance = null
      lastError = error
      console.log(`deployment attempt ${attempt}/${options.attempts} not ready`)
    }
    if (attempt < options.attempts) {
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs))
    }
  }
  fail(
    `deployment did not produce ${options.confirmations} consecutive confirmations`
    + (lastError instanceof Error ? `: ${lastError.message}` : ''),
  )
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    const result = await verifyDeployment(parseArguments(process.argv.slice(2)))
    console.log(JSON.stringify({ ok: true, ...result }))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
