import { afterEach, describe, expect, test } from 'vitest'
import { startTestServer, stubVerifier, validClaims } from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'
import {
  ELEMENT_TEST_NOW, syntheticElementConnection, syntheticElementJob, syntheticElementSyncState,
} from '../fixtures/elementStatistics.ts'
import { testConfig } from '../helpers/server.ts'

const KEY = 'integration-key-that-is-long-enough-0123456789'
let server: TestServer | null = null
afterEach(async () => {
  await server?.close()
  server = null
})

async function seed(target: TestServer) {
  const repo = target.repos.elementStatistics
  const connection = await repo.saveConnection(syntheticElementConnection)
  await repo.commitPage(connection.id, [
    syntheticElementJob(),
    syntheticElementJob({ id: '899', title: 'Old failure', result: 'failed_or_aborted', startedAt: '2026-01-02T10:00:00.000Z', endedAt: '2026-01-02T10:30:00.000Z' }),
  ], ELEMENT_TEST_NOW, syntheticElementSyncState)
  return connection
}

describe('print-jobs integration', () => {
  test('is unavailable until a key is configured', async () => {
    server = await startTestServer({ label: 'integration-off', verifier: stubVerifier({ admin: validClaims() }) })
    const res = await server.fetchJson('/api/integrations/print-jobs', { headers: { authorization: `Integration ${KEY}` } })
    expect(res.status).toBe(503)
  })

  test('requires the exact key and never accepts an Entra token', async () => {
    server = await startTestServer({
      label: 'integration-auth',
      env: { SHAPEPILOT_INTEGRATION_KEY: KEY },
      verifier: stubVerifier({ admin: validClaims() }),
    })
    for (const authorization of [undefined, `Integration ${KEY}x`, `Bearer ${KEY}`, 'Integration short']) {
      const res = await server.fetchJson('/api/integrations/print-jobs', { headers: authorization ? { authorization } : {} })
      expect(res.status).toBe(401)
    }
    const entra = await server.fetchJson('/api/integrations/print-jobs', { token: 'admin' })
    expect(entra.status).toBe(401)
  })

  test('returns a whitelisted projection of the job ledger with an overlap window', async () => {
    server = await startTestServer({ label: 'integration-jobs', env: { SHAPEPILOT_INTEGRATION_KEY: KEY } })
    const connection = await seed(server)
    const all = await server.fetchJson<{ cursor: string; truncated: boolean; jobs: Record<string, unknown>[] }>(
      '/api/integrations/print-jobs', { headers: { authorization: `Integration ${KEY}` } },
    )
    expect(all.status).toBe(200)
    expect(all.headers.get('cache-control')).toBe('no-store')
    expect(all.body.truncated).toBe(false)
    expect(all.body.jobs).toHaveLength(2)
    const job = all.body.jobs.find(j => j.title === 'Synthetic calibration plate')!
    expect(job).toEqual({
      id: `${connection.id}:900`,
      title: 'Synthetic calibration plate',
      result: 'completed',
      startedAt: '2026-09-14T16:00:00.000Z',
      endedAt: '2026-09-14T17:00:00.000Z',
      seconds: 3600,
      estimatedSeconds: 4200,
      grams: 45,
      materials: [{ material: 'PLA', color: '336699FF', grams: 45 }],
    })
    // Nothing account- or printer-identifying beyond the opaque connection id leaks.
    expect(Object.keys(job).sort()).toEqual(
      ['endedAt', 'estimatedSeconds', 'grams', 'id', 'materials', 'result', 'seconds', 'startedAt', 'title'],
    )

    const recent = await server.fetchJson<{ jobs: { title: string }[] }>(
      '/api/integrations/print-jobs?since=2026-09-16T00:00:00.000Z',
      { headers: { authorization: `Integration ${KEY}` } },
    )
    // since - 3 days still includes the 14 Sep job; the January one is out.
    expect(recent.body.jobs.map(j => j.title)).toEqual(['Synthetic calibration plate'])

    const bad = await server.fetchJson('/api/integrations/print-jobs?since=yesterday', { headers: { authorization: `Integration ${KEY}` } })
    expect(bad.status).toBe(400)
  })

  test('config rejects weak keys and defers Key Vault references', () => {
    expect(() => testConfig({ SHAPEPILOT_INTEGRATION_KEY: 'short' })).toThrow(/SHAPEPILOT_INTEGRATION_KEY/)
    const deferred = testConfig({ SHAPEPILOT_INTEGRATION_KEY: '@Microsoft.KeyVault(SecretUri=https://x.vault.azure.net/secrets/y)' })
    expect(deferred.integration).toEqual({ printJobsKey: null, unresolvedSecret: true })
  })
})
