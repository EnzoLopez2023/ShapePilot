import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ElementMonitor } from '../../server/element/monitor.ts'
import type { ElementStatus } from '../../lib/contracts/elementStatistics.ts'
import type { DisplayGrant, DisplayPairing, DisplayStatus } from '../../lib/contracts/elementDisplay.ts'
import {
  OTHER_OID, startTestServer, stubVerifier, TEST_OID, TEST_TENANT, validClaims,
} from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'
import { syntheticElementConnection, syntheticElementSnapshot } from '../fixtures/elementStatistics.ts'

let server: TestServer
let status: ElementStatus
let clientDir: string
beforeEach(async () => {
  // sendFile refuses hidden parent paths; keep this disposable client outside test/.tmp.
  clientDir = mkdtempSync(join('test', 'element-display-client-'))
  writeFileSync(join(clientDir, 'index.html'), '<!DOCTYPE html><title>Synthetic app shell</title>')
  writeFileSync(join(clientDir, 'display.html'), '<!DOCTYPE html><title>Synthetic dedicated display</title>')
  status = {
    settings: { enabled: true, activeConnectionId: syntheticElementConnection.id, updatedAt: null },
    credential: { configured: true, region: 'global', expiresAt: null },
    connectionState: 'connected', problem: null,
    connections: [syntheticElementConnection], snapshot: syntheticElementSnapshot,
    snapshotConnectionId: syntheticElementConnection.id, freshness: 'fresh',
    syncing: false, coverage: [], events: [], checkedAt: new Date().toISOString(),
  }
  server = await startTestServer({
    label: 'element-display', env: { SHAPEPILOT_ADMIN_OIDS: TEST_OID, SHAPEPILOT_CLIENT_DIR: clientDir },
    verifier: stubVerifier({ admin: validClaims(), user: validClaims({ oid: OTHER_OID }) }),
    elementMonitorFactory: (repos, config) => {
      const monitor = new ElementMonitor({ repository: repos.elementStatistics, config: config.element, schedule: false })
      vi.spyOn(monitor, 'status').mockImplementation(async () => status)
      return monitor
    },
  })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await server.close()
  rmSync(clientDir, { recursive: true, force: true })
})

const start = () => server.fetchJson<DisplayPairing>('/api/element-display/pairings', { method: 'POST', body: '{}' })
const read = (credential: string) => server.fetchJson<DisplayStatus>('/api/element-display/status', {
  headers: { authorization: `Display ${credential}` },
})
const approve = (code: string, token = 'admin') => server.fetchJson('/api/admin/element-displays/approve', {
  token, method: 'POST', body: JSON.stringify({ code, label: 'Synthetic EDGE' }),
})

test('pairing is admin-approved, private, single-use and stores no raw credential', async () => {
  const pairing = await start()
  expect(pairing.status).toBe(201)
  expect(pairing.body.credential).toMatch(/^[a-f0-9]{64}$/)
  expect(pairing.body.code).toMatch(/^[A-F0-9]{10}$/)
  const pending = await read(pairing.body.credential)
  expect(pending.body.paired).toBe(false)
  expect(pending.body.snapshot).toBeNull()
  expect(await server.repos.elementDisplays.list({ tenantId: TEST_TENANT, oid: TEST_OID }, new Date().toISOString())).toEqual([])
  expect((await approve(pairing.body.code, 'user')).status).toBe(403)
  expect((await approve(pairing.body.code, '')).status).toBe(401)
  expect((await approve(pairing.body.code)).status).toBe(204)
  expect((await approve(pairing.body.code)).status).toBe(404)
  const live = await read(pairing.body.credential)
  expect(live.status).toBe(200)
  expect(live.headers.get('cache-control')).toBe('no-store')
  expect(live.body.paired).toBe(true)
  expect(live.body.snapshot?.progressPercent).toBe(42)
  expect(live.body.snapshot?.remainingMinutes).toBe(35)
  expect(Object.keys(live.body).sort()).toEqual(['connectionState', 'expiresAt', 'freshness', 'paired', 'printerName', 'snapshot'])
  expect(Object.keys(live.body.snapshot!).sort()).toEqual([
    'receivedAt', 'state', 'jobName', 'progressPercent', 'remainingMinutes', 'currentLayer',
    'totalLayers', 'nozzleActualC', 'nozzleTargetC', 'bedActualC', 'bedTargetC', 'printError', 'hms',
  ].sort())
  expect(JSON.stringify(live.body)).not.toMatch(/ams|accountId|printerId|credential|history|events|coverage|wifi|fieldUpdatedAt/)
  const listed = await server.fetchJson<DisplayGrant[]>('/api/admin/element-displays', { token: 'admin' })
  expect(listed.body).toHaveLength(1)
  expect(JSON.stringify(listed.body)).not.toContain(pairing.body.credential)
  expect(readFileSync(server.database.path).includes(Buffer.from(pairing.body.credential))).toBe(false)
  const audit = server.database.handle.prepare<[], { detail: string | null }>('SELECT detail FROM audit_events').all()
  expect(JSON.stringify(audit)).not.toContain(pairing.body.credential)
  expect(JSON.stringify(audit)).not.toContain(pairing.body.code)
})

test('display key cannot call app APIs or use query authentication', async () => {
  const { body } = await start()
  await approve(body.code)
  for (const path of ['/api/admin/element-statistics/status', '/api/admin/element-displays', '/api/settings', '/api/integrations/print-jobs']) {
    const response = await server.fetchJson(path, { headers: { authorization: `Display ${body.credential}` } })
    expect([401, 503]).toContain(response.status)
  }
  expect((await server.fetchJson(`/api/element-display/status?credential=${body.credential}`)).status).toBe(401)
  expect((await read('b'.repeat(64))).status).toBe(401)
  expect((await server.fetchJson('/api/element-display/status', {
    method: 'POST', headers: { authorization: `Display ${body.credential}` }, body: '{}',
  })).status).toBe(404)
})

test('revocation and administrator role removal immediately deny an already paired credential', async () => {
  const { body } = await start()
  await approve(body.code)
  const owner = { tenantId: TEST_TENANT, oid: TEST_OID }
  await server.repos.memberships.setRole(owner, 'user')
  expect((await read(body.credential)).status).toBe(401)
  await server.repos.memberships.setRole(owner, 'admin')
  const [grant] = await server.repos.elementDisplays.list(owner, new Date().toISOString())
  const revoked = await server.fetchJson(`/api/admin/element-displays/${grant.id}`, { token: 'admin', method: 'DELETE' })
  expect(revoked.status).toBe(204)
  expect((await read(body.credential)).status).toBe(401)
})

test('switching household printers, disabling monitoring and mismatched snapshots never leak other telemetry', async () => {
  const { body } = await start()
  await approve(body.code)
  status.settings.activeConnectionId = 'b'.repeat(64)
  const switched = await read(body.credential)
  expect(switched.body.snapshot).toBeNull()
  expect(switched.body.printerName).toBeNull()
  expect(switched.body.connectionState).toBe('selection_required')
  status.settings.activeConnectionId = syntheticElementConnection.id
  status.settings.enabled = false
  expect((await read(body.credential)).body.snapshot).toBeNull()
  status.settings.enabled = true
  status.snapshotConnectionId = 'b'.repeat(64)
  expect((await read(body.credential)).body.snapshot).toBeNull()
})

test('pending and paired credentials expire, restart keeps approved hashes, and pairing creation is bounded', async () => {
  const { body } = await start()
  const digest = createHash('sha256').update(body.credential).digest('hex')
  expect(await server.repos.elementDisplays.find(digest, body.expiresAt)).toBeNull()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(body.expiresAt))
  expect((await approve(body.code)).status).toBe(404)
  expect((await read(body.credential)).status).toBe(401)
  clock.mockRestore()
  // Rebind the repository, as startup does, rather than rely on in-memory grants.
  const { createElementDisplayRepository } = await import('../../lib/db/repositories/elementDisplays.ts')
  const { body: next } = await start()
  await approve(next.code)
  const repo = createElementDisplayRepository(server.database.handle)
  const saved = await repo.find(createHash('sha256').update(next.credential).digest('hex'), new Date().toISOString())
  expect(saved?.owner?.oid).toBe(TEST_OID)
  expect(await repo.find(saved!.tokenHash, saved!.expiresAt)).toBeNull()
  for (let i = 0; i < 8; i++) expect((await start()).status).toBe(201)
  expect((await start()).status).toBe(429)
})

test('invalid input and unselected printers cannot create approval grants', async () => {
  expect((await server.fetchJson('/api/element-display/pairings', {
    method: 'POST', body: '{"credential":"not-accepted"}',
  })).status).toBe(400)
  expect((await approve('ABC')).status).toBe(400)
  const { body } = await start()
  status.settings.enabled = false
  expect((await approve(body.code)).status).toBe(409)
})

test('public bootstrap serves the isolated entry with route-scoped CSP but no telemetry or app-wide policy change', async () => {
  const display = await fetch(`${server.baseUrl}/display/element`)
  expect(display.status).toBe(200)
  expect(await display.text()).toContain('Synthetic dedicated display')
  expect(display.headers.get('cache-control')).toBe('no-store')
  expect(display.headers.get('referrer-policy')).toBe('no-referrer')
  expect(display.headers.get('content-security-policy')).toContain("connect-src 'self'")
  const app = await fetch(server.baseUrl)
  expect(await app.text()).toContain('Synthetic app shell')
  expect(app.headers.get('content-security-policy')).toBeNull()
  const alias = await fetch(`${server.baseUrl}/display.html`, { redirect: 'manual' })
  expect(alias.headers.get('location')).toBe('/display/element')
  expect((await server.fetchJson('/api/element-display/status')).status).toBe(401)
})
