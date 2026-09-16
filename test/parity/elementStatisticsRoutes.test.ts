import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  OTHER_OID, startTestServer, stubVerifier, TEST_OID, TEST_TENANT, validClaims,
} from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'
import {
  ELEMENT_TEST_NOW, syntheticElementAccount, syntheticElementJob,
} from '../fixtures/elementStatistics.ts'
import type {
  ElementAccount, ElementJobDetail, ElementReport, ElementStatus,
} from '../../lib/contracts/elementStatistics.ts'
import { ElementMonitor } from '../../server/element/monitor.ts'
import type { BambuProvider } from '../../server/element/provider.ts'
import { filamentsOfLine } from '../../lib/contracts/bambuFilaments.ts'

const BASE = '/api/admin/element-statistics'
const TOKEN = 'synthetic-server-bambu-token'
let server: TestServer
let monitor: ElementMonitor
let provider: BambuProvider
let clock: number

beforeEach(async () => {
  clock = Date.parse(ELEMENT_TEST_NOW)
  provider = {
    expiresAt: null,
    discover: vi.fn(async () => syntheticElementAccount),
    history: vi.fn(async () => ({
      jobs: [
        syntheticElementJob(),
        syntheticElementJob({
          id: '899', title: '=HYPERLINK("https://example.invalid")<script>bad()</script>',
          result: 'failed_or_aborted', rawStatus: '3',
          endedAt: '2026-09-14T16:10:00.000Z',
          actualDurationSeconds: 600, estimatedDurationSeconds: 6000, estimatedWeightGrams: 100,
          materials: [{
            material: 'PETG', filamentId: 'SYNTHETIC', color: null, estimatedWeightGrams: 100,
            nozzleId: null, amsId: null, slotId: null,
          }],
        }),
      ], nextCursor: null, total: 2,
    })),
    subscribe: vi.fn(async (_account, _printer, callbacks) => {
      callbacks.onState('connected', null)
      return { close: async () => {} }
    }),
    close: vi.fn(async () => {}),
  }
  server = await startTestServer({
    label: 'element-routes',
    env: { SHAPEPILOT_ADMIN_OIDS: TEST_OID, SHAPEPILOT_BAMBU_ACCESS_TOKEN: TOKEN },
    verifier: stubVerifier({
      admin: validClaims(),
      user: validClaims({ oid: OTHER_OID }),
    }),
    elementMonitorFactory: (repos, config) => {
      monitor = new ElementMonitor({
        repository: repos.elementStatistics, config: config.element,
        providerFactory: () => provider, now: () => clock, schedule: false, logger: () => {},
      })
      return monitor
    },
  })
})
afterEach(async () => server.close())

const endpoints = [
  { path: '/status', method: 'GET' },
  { path: '/report', method: 'GET' },
  { path: `/jobs/${'a'.repeat(64)}/900`, method: 'GET' },
  { path: '/export/jobs.csv', method: 'GET' },
  { path: '/export/materials.csv', method: 'GET' },
  { path: '/export/summary.csv', method: 'GET' },
  { path: '/report.html', method: 'GET' },
  { path: '/discover', method: 'POST', body: {} },
  { path: '/connection', method: 'PUT', body: { enabled: false } },
  { path: '/sync', method: 'POST', body: { rescan: false } },
]

const request = <T = unknown>(path: string, method = 'GET', body?: unknown) =>
  server.fetchJson<T>(`${BASE}${path}`, {
    token: 'admin', method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

async function importHistory() {
  expect((await request('/connection', 'PUT', {
    enabled: true, accountId: syntheticElementAccount.accountId, printerId: 'SYNTHETIC123',
  })).status).toBe(200)
  expect((await request('/sync', 'POST', { rescan: false })).status).toBe(202)
  await monitor.idle()
}

describe('protected EL-ement Statistics API', () => {
  test('every data, setup, sync and export route rejects anonymous and non-admin users', async () => {
    for (const endpoint of endpoints) {
      const init = {
        method: endpoint.method,
        ...(endpoint.body ? { body: JSON.stringify(endpoint.body) } : {}),
      }
      expect((await server.fetchJson(`${BASE}${endpoint.path}`, init)).status).toBe(401)
      expect((await server.fetchJson(`${BASE}${endpoint.path}`, { ...init, token: 'user' })).status).toBe(403)
    }
    expect(provider.discover).not.toHaveBeenCalled()
    expect(provider.history).not.toHaveBeenCalled()
  })

  test('admin role revocation takes effect immediately on every route with the same token', async () => {
    expect((await request('/status')).status).toBe(200)
    await server.repos.memberships.setRole({ tenantId: TEST_TENANT, oid: TEST_OID }, 'user')
    for (const endpoint of endpoints) {
      expect((await request(endpoint.path, endpoint.method, endpoint.body)).status).toBe(403)
    }
    expect(provider.discover).not.toHaveBeenCalled()
  })

  test('secure discovery and selection lead to persisted report and job detail without request-time cloud retrieval', async () => {
    const discovered = await request<ElementAccount>('/discover', 'POST', {})
    expect(discovered.status).toBe(200)
    expect(discovered.body.accountId).toBe(syntheticElementAccount.accountId)
    const owned = [{ key: filamentsOfLine('bambu-lab/pla/basic')[0].key, variant: 'spool' as const }]
    await server.repos.filaments.replace({ tenantId: TEST_TENANT, oid: TEST_OID }, owned)
    await importHistory()
    const historyCalls = vi.mocked(provider.history).mock.calls.length
    const report = await request<ElementReport>('/report?timeZone=UTC&from=2026-09-14&to=2026-09-14&grain=day')
    expect(report.status).toBe(200)
    expect(report.headers.get('cache-control')).toBe('no-store')
    expect(report.body.totals.jobs).toBe(2)
    expect(report.body.totals.actualDurationSeconds.value).toBe(4200)
    expect(report.body.totals.estimatedDurationSeconds.value).toBe(10_200)
    expect(report.body.totals.completedWeightGrams.value).toBe(45)
    expect(report.body.totals.failedOrAbortedWeightGrams.value).toBe(100)
    expect(report.body.totals.unreportedLengthUnitJobs).toBe(2)
    expect(report.body.trend.reduce((sum, row) => sum + row.totals.jobs, 0)).toBe(2)
    const job = report.body.jobs.items[0]
    const detail = await request<ElementJobDetail>(`/jobs/${job.connectionId}/${job.id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.job.id).toBe(job.id)
    expect(provider.history).toHaveBeenCalledTimes(historyCalls)
    const status = await request<ElementStatus>('/status')
    expect(status.body.coverage[0].jobCount).toBe(2)
    expect(status.body.coverage[0].sync.backfillComplete).toBe(true)
    expect(JSON.stringify([discovered.body, report.body, detail.body, status.body])).not.toContain(TOKEN)
    expect(readFileSync(server.database.path).includes(Buffer.from(TOKEN))).toBe(false)
    expect(await server.repos.filaments.list({ tenantId: TEST_TENANT, oid: TEST_OID })).toEqual(owned)
  })

  test('all exports use identical persisted filters, escape content and forbid caching', async () => {
    await importHistory()
    const scope = '?result=failed_or_aborted&timeZone=UTC&from=2026-09-14&to=2026-09-14'
    const report = await request<ElementReport>(`/report${scope}`)
    expect(report.body.totals.jobs).toBe(1)
    for (const kind of ['jobs', 'materials', 'summary']) {
      const response = await fetch(`${server.baseUrl}${BASE}/export/${kind}.csv${scope}`, {
        headers: { authorization: 'Bearer admin' },
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('content-disposition')).toContain(`${kind}.csv`)
      const csv = await response.text()
      expect(csv).not.toContain(TOKEN)
      expect(csv).not.toContain('Synthetic calibration plate')
      if (kind === 'jobs') {
        expect(csv).toContain("'=HYPERLINK")
        expect(csv).toContain('100')
        expect(csv).toContain('600')
      }
    }
    const htmlResponse = await fetch(`${server.baseUrl}${BASE}/report.html${scope}`, {
      headers: { authorization: 'Bearer admin' },
    })
    expect(htmlResponse.status).toBe(200)
    expect(htmlResponse.headers.get('content-security-policy')).toContain("default-src 'none'")
    const html = await htmlResponse.text()
    expect(html).toContain('EL-ement Statistics')
    expect(html).toContain('http-equiv="Content-Security-Policy"')
    expect(html).not.toContain('<script>bad()')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain(TOKEN)
    expect(html).not.toContain('Synthetic calibration plate')
    expect(html).toContain('PETG')
  })

  test('IANA calendar bounds reach SQLite before the report limit, including a 25-hour DST day', async () => {
    await importHistory()
    const repository = server.repos.elementStatistics
    const [connection] = await repository.listConnections()
    const jobs = [
      '2025-11-02T06:59:59.999Z',
      '2025-11-02T07:00:00.000Z',
      '2025-11-03T07:59:59.999Z',
      '2025-11-03T08:00:00.000Z',
    ].map((startedAt, index) => syntheticElementJob({
      id: `boundary-${index}`, startedAt,
      endedAt: new Date(Date.parse(startedAt) + 120_000).toISOString(),
      actualDurationSeconds: 120, materials: [],
    }))
    await repository.commitPage(
      connection.id, jobs, ELEMENT_TEST_NOW, await repository.getSyncState(connection.id),
    )
    const reads = vi.spyOn(repository, 'listJobs')
    const report = await request<ElementReport>(
      '/report?from=2025-11-02&to=2025-11-02&timeZone=America%2FLos_Angeles',
    )
    expect(report.status).toBe(200)
    expect(reads).toHaveBeenCalledWith(null, 50_001, {
      fromInclusive: '2025-11-02T07:00:00.000Z',
      toExclusive: '2025-11-03T08:00:00.000Z',
    })
    expect(report.body.jobs.items.map(job => job.id).sort()).toEqual(['boundary-1', 'boundary-2'])
    expect(report.body.totals.jobs).toBe(2)
    expect(report.body.totals.actualDurationSeconds.value).toBe(240)
    expect(report.body.coverage[0].jobCount).toBe(6)
  })

  test('exactly 50,000 candidates remain reportable and 50,001 returns an explicit limit error', async () => {
    await importHistory()
    const repository = server.repos.elementStatistics
    const [template] = await repository.listJobs(null, 1)
    const jobs = Array.from({ length: 50_000 }, (_, index) => ({
      ...template, id: `synthetic-limit-${index}`, title: null, materials: [],
    }))
    const reads = vi.spyOn(repository, 'listJobs')
    reads.mockResolvedValueOnce(jobs)
    const atLimit = await request<ElementReport>('/report?pageSize=1&timeZone=UTC')
    expect(atLimit.status).toBe(200)
    expect(atLimit.body.totals.jobs).toBe(50_000)
    expect(atLimit.body.jobs.total).toBe(50_000)
    expect(atLimit.body.jobs.items).toHaveLength(1)

    jobs.push({ ...template, id: 'synthetic-over-limit', title: null, materials: [] })
    reads.mockResolvedValueOnce(jobs)
    const overLimit = await request('/report?pageSize=1&timeZone=UTC')
    expect(overLimit.status).toBe(413)
    expect(JSON.stringify(overLimit.body)).toContain('report_limit')
    expect(JSON.stringify(overLimit.body)).toContain('Narrow the date range')
    expect((await repository.coverage())[0].jobCount).toBe(2)
  })

  test('sparse refreshes preserve omitted facts, but explicit invalidation removes stale runtime and usage everywhere', async () => {
    await importHistory()
    vi.mocked(provider.history).mockResolvedValueOnce({
      jobs: [syntheticElementJob({
        title: 'Synthetic sparse update',
        startedAt: null, endedAt: null, actualDurationSeconds: null,
        estimatedDurationSeconds: null, estimatedWeightGrams: null, materials: [],
        reportedFields: ['title', 'warnings'],
      })],
      nextCursor: null, total: 2,
    })
    clock += 60_000
    expect((await request('/sync', 'POST', { rescan: true })).status).toBe(202)
    await monitor.idle()
    const preserved = await request<ElementReport>('/report?timeZone=UTC')
    expect(preserved.body.totals.actualDurationSeconds.value).toBe(4200)
    expect(preserved.body.totals.estimatedDurationSeconds.value).toBe(10_200)
    expect(preserved.body.totals.completedWeightGrams).toEqual({ value: 45, known: 1, missing: 0 })

    vi.mocked(provider.history).mockResolvedValueOnce({
      jobs: [syntheticElementJob({
        title: 'Synthetic cleared values',
        startedAt: null, endedAt: null,
        estimatedDurationSeconds: null, estimatedWeightGrams: null,
        estimatedLength: null, lengthUnit: null, materials: [],
        reportedFields: [
          'title', 'startedAt', 'endedAt', 'estimatedDurationSeconds',
          'estimatedWeightGrams', 'estimatedLength', 'lengthUnit', 'materials', 'warnings',
        ],
      })],
      nextCursor: null, total: 2,
    })
    clock += 60_000
    expect((await request('/sync', 'POST', { rescan: true })).status).toBe(202)
    await monitor.idle()
    const invalidated = await request<ElementReport>('/report?timeZone=UTC')
    expect(invalidated.body.totals.jobs).toBe(2)
    expect(invalidated.body.totals.actualDurationSeconds).toEqual({ value: 600, known: 1, missing: 1 })
    expect(invalidated.body.totals.estimatedDurationSeconds).toEqual({ value: 6000, known: 1, missing: 1 })
    expect(invalidated.body.totals.completedWeightGrams).toEqual({ value: null, known: 0, missing: 1 })
    expect(invalidated.body.totals.undatedJobs).toBe(1)
    expect(invalidated.body.trend.reduce((sum, bucket) => sum + bucket.totals.actualDurationSeconds.missing, 0)).toBe(1)
    expect(invalidated.body.jobs.items.find(job => job.id === '900')).toMatchObject({
      startedAt: null, endedAt: null, actualDurationSeconds: null,
      estimatedDurationSeconds: null, estimatedWeightGrams: null,
      estimatedLength: null, materials: [],
    })
    const csv = await fetch(
      `${server.baseUrl}${BASE}/export/jobs.csv?search=Synthetic%20cleared%20values&timeZone=UTC`,
      { headers: { authorization: 'Bearer admin' } },
    )
    expect(csv.status).toBe(200)
    const text = await csv.text()
    expect(text).toContain('Synthetic cleared values')
    expect(text).not.toContain('PLA')
    expect(text).not.toMatch(/(?:^|,)"?45"?(?:,|\r?$)/m)
  })

  test('rejects secret write fields, malformed filters and mismatched selections with explicit errors', async () => {
    expect((await request('/connection', 'PUT', { enabled: false, accessToken: 'never-accepted' })).status).toBe(400)
    expect((await request('/discover', 'POST', { password: 'never-accepted' })).status).toBe(400)
    expect((await request('/sync', 'POST', { rescan: 'true' })).status).toBe(400)
    expect((await request('/connection', 'PUT', {
      enabled: true, accountId: '999', printerId: 'SYNTHETIC123',
    })).status).toBe(409)
    for (const query of [
      'timeZone=invalid', 'from=2026-02-30', 'from=2026-09-15&to=2026-09-14',
      'page=-1', 'pageSize=101', 'result=success', 'grain=year', 'from=2026-09-14&from=2026-09-15',
    ]) {
      expect((await request(`/report?${query}`)).status).toBe(400)
    }
  })

  test('disabled monitoring preserves reports, while manual sync and automatic calls stop', async () => {
    await importHistory()
    expect((await request('/connection', 'PUT', { enabled: false })).status).toBe(200)
    const count = vi.mocked(provider.history).mock.calls.length
    expect((await request('/sync', 'POST', { rescan: false })).status).toBe(409)
    const report = await request<ElementReport>('/report')
    expect(report.body.totals.jobs).toBe(2)
    expect(provider.history).toHaveBeenCalledTimes(count)
  })

  test('manual rescan replays records idempotently instead of clearing the ledger', async () => {
    await importHistory()
    clock += 60_000
    expect((await request('/sync', 'POST', { rescan: true })).status).toBe(202)
    await monitor.idle()
    expect((await request<ElementReport>('/report')).body.totals.jobs).toBe(2)
  })
})
