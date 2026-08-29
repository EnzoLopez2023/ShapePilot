import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { afterEach, test } from 'vitest'
import {
  parseArguments,
  verifyDeployment,
} from '../../scripts/verify-deployment.mjs'

const SHA = 'a'.repeat(40)
const BUILD_ID = '12345-1'
const INSTANCE_ID = 'instance-fixture'
const servers = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise((resolve) => server.close(resolve))))
})

async function fixtureServer(overrides = {}) {
  const requests = []
  const server = createServer((request, response) => {
    requests.push(request.url)
    response.setHeader('content-type', 'application/json')
    response.setHeader('cache-control', overrides.cacheControl ?? 'no-store')
    const common = {
      app: 'shapepilot',
      sha: SHA,
      buildId: BUILD_ID,
      instanceId: overrides.instanceId ?? INSTANCE_ID,
      lifecycle: 'ready',
    }
    if (request.url.startsWith('/version.json')) {
      response.end(JSON.stringify({
        app: 'shapepilot',
        commit: overrides.staticVersionSha ?? SHA,
        build: BUILD_ID,
      }))
    } else if (request.url.startsWith('/api/version')) {
      response.end(JSON.stringify({
        app: 'shapepilot',
        sha: overrides.versionSha ?? SHA,
        buildId: BUILD_ID,
      }))
    } else if (request.url.startsWith('/api/live')) {
      response.end(JSON.stringify({ ...common, status: 'ok' }))
    } else if (request.url.startsWith('/api/ready')) {
      response.end(JSON.stringify({
        ...common,
        status: 'ready',
        database: {
          reachable: true,
          journalMode: 'delete',
          foreignKeys: true,
          schemaIdentity: 'schema',
          expectedSchemaIdentity: 'schema',
          headMigration: '002-app-identity',
          expectedHeadMigration: '002-app-identity',
        },
      }))
    } else {
      response.statusCode = 404
      response.end('{}')
    }
  })
  servers.push(server)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    requests,
    baseUrl: `http://127.0.0.1:${address.port}`,
  }
}

const optionsFor = (baseUrl, extra = []) => parseArguments([
  '--base-url', baseUrl,
  '--live-path', '/api/live',
  '--ready-path', '/api/ready',
  '--profile', 'sqlite-one-worker',
  '--expected-sha', SHA,
  '--expected-build-id', BUILD_ID,
  '--attempts', '3',
  '--confirmations', '3',
  '--interval-ms', '1',
  '--request-timeout-ms', '1000',
  '--run-token', 'test-run',
  ...extra,
])

test('requires three consecutive static/version/live/ready agreements', async () => {
  const fixture = await fixtureServer()
  const result = await verifyDeployment(optionsFor(fixture.baseUrl))
  assert.deepEqual(result, { instanceId: INSTANCE_ID, confirmations: 3 })
  assert.equal(fixture.requests.length, 12)
  assert.ok(fixture.requests.every((request) =>
    request.includes('deployment=test-run')
    && request.includes('attempt=')
    && request.includes('nonce=')))
})

test('refuses stale process identity and resets the confirmation streak', async () => {
  const fixture = await fixtureServer()
  await assert.rejects(
    verifyDeployment(optionsFor(fixture.baseUrl, [
      '--previous-instance-id', INSTANCE_ID,
    ])),
    /prior process instance is still serving/,
  )
})

test('refuses disagreement or cacheable health responses', async () => {
  const wrongVersion = await fixtureServer({ versionSha: 'b'.repeat(40) })
  await assert.rejects(
    verifyDeployment(optionsFor(wrongVersion.baseUrl)),
    /version reported an unexpected release identity/,
  )

  const staleStaticVersion = await fixtureServer({ staticVersionSha: 'b'.repeat(40) })
  await assert.rejects(
    verifyDeployment(optionsFor(staleStaticVersion.baseUrl)),
    /version\.json reported an unexpected release identity/,
  )

  const cacheable = await fixtureServer({ cacheControl: 'public, max-age=60' })
  await assert.rejects(
    verifyDeployment(optionsFor(cacheable.baseUrl)),
    /did not return Cache-Control: no-store/,
  )
})

test('requires the direct Azure default host for production TLS checks', () => {
  assert.throws(
    () => parseArguments([
      '--base-url', 'https://shapepilot.example.com',
      '--live-path', '/api/live',
      '--ready-path', '/api/ready',
      '--profile', 'sqlite-one-worker',
      '--expected-sha', SHA,
      '--expected-build-id', BUILD_ID,
      '--attempts', '3',
      '--confirmations', '3',
      '--interval-ms', '1',
      '--request-timeout-ms', '1000',
      '--run-token', 'test-run',
    ]),
    /direct production host/,
  )
})
