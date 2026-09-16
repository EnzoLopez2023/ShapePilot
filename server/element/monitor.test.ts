import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createTempDatabase, testConfig } from '../../test/helpers/server.ts'
import type { TempDatabase } from '../../test/helpers/server.ts'
import {
  ELEMENT_TEST_NOW, syntheticElementAccount, syntheticElementJob, syntheticElementSnapshot,
} from '../../test/fixtures/elementStatistics.ts'
import { ElementMonitor } from './monitor.ts'
import { BambuProviderError } from './provider.ts'
import type { BambuProvider } from './provider.ts'

let temp: TempDatabase
let monitor: ElementMonitor
let now: number
let callbacks: Parameters<BambuProvider['subscribe']>[2] | null

const providerStub = () => ({
  expiresAt: null,
  discover: vi.fn(async () => syntheticElementAccount),
  history: vi.fn(async () => ({ jobs: [syntheticElementJob()], nextCursor: null, total: 1 })),
  subscribe: vi.fn(async (_account: string, _printer: string, handlers: Parameters<BambuProvider['subscribe']>[2]) => {
    callbacks = handlers
    handlers.onState('connected', null)
    return { close: async () => {} }
  }),
  close: vi.fn(async () => {}),
})

beforeEach(() => {
  temp = createTempDatabase('element-monitor')
  now = Date.parse(ELEMENT_TEST_NOW)
  callbacks = null
})
afterEach(async () => {
  await monitor?.close()
  temp.cleanup()
})

function makeMonitor(provider: BambuProvider, credential = true, automatic = false) {
  monitor = new ElementMonitor({
    repository: temp.repos.elementStatistics,
    config: testConfig(credential ? { SHAPEPILOT_BAMBU_ACCESS_TOKEN: 'synthetic-test-token' } : {}).element,
    providerFactory: () => provider, now: () => now, schedule: automatic, logger: () => {},
  })
  return monitor
}

async function enable() {
  await monitor.configure({
    enabled: true, accountId: syntheticElementAccount.accountId, printerId: 'SYNTHETIC123',
  })
}

describe('server-lifetime household monitor', () => {
  test('the lifecycle scheduler records jobs without a browser or manual sync request', async () => {
    const provider = providerStub()
    makeMonitor(provider, true, true)
    await monitor.start()
    await enable()
    await vi.waitFor(async () => {
      expect((await temp.repos.elementStatistics.coverage())[0]?.jobCount).toBe(1)
    })
    expect(provider.history).toHaveBeenCalledTimes(1)
    await monitor.configure({ enabled: false })
    expect((await monitor.status()).settings.enabled).toBe(false)
    expect((await temp.repos.elementStatistics.coverage())[0].jobCount).toBe(1)
  })

  test('missing/disabled credentials make no automatic network calls', async () => {
    const provider = providerStub()
    makeMonitor(provider, false, true)
    await monitor.start()
    expect((await monitor.status()).connectionState).toBe('unconfigured')
    await expect(monitor.discover()).rejects.toMatchObject({ code: 'credential_missing' })
    expect(provider.discover).not.toHaveBeenCalled()
    expect(provider.history).not.toHaveBeenCalled()
    expect(provider.subscribe).not.toHaveBeenCalled()
    await monitor.close()
    makeMonitor(provider, true, true)
    await monitor.start()
    expect((await monitor.status()).connectionState).toBe('disabled')
    expect(provider.discover).not.toHaveBeenCalled()
  })

  test('verification is rate limited but selecting the verified printer is immediately usable', async () => {
    const provider = providerStub()
    makeMonitor(provider)
    await monitor.discover()
    await expect(monitor.discover()).rejects.toMatchObject({ status: 429 })
    await enable()
    expect((await monitor.status()).settings.enabled).toBe(true)
    expect(provider.discover).toHaveBeenCalledTimes(1)
  })

  test('persists history independently of page requests and retains it when disabled', async () => {
    const provider = providerStub()
    makeMonitor(provider)
    await enable()
    expect(await monitor.requestSync()).toBe(true)
    await monitor.idle()
    const status = await monitor.status()
    expect(status.coverage[0].jobCount).toBe(1)
    expect(status.coverage[0].sync.lastSuccessAt).toBe(ELEMENT_TEST_NOW)
    expect(status.connectionState).toBe('connected')
    await monitor.configure({ enabled: false })
    expect((await monitor.status()).settings.enabled).toBe(false)
    expect((await monitor.status()).coverage[0].jobCount).toBe(1)
    await expect(monitor.requestSync()).rejects.toMatchObject({ code: 'monitor_disabled' })
    expect(provider.close).toHaveBeenCalled()
  })

  test('concurrent sync and rescan requests admit a single operation', async () => {
    const provider = providerStub()
    makeMonitor(provider)
    await enable()
    const admitted = await Promise.all([monitor.requestSync(), monitor.requestSync(true), monitor.requestSync()])
    expect(admitted.filter(Boolean)).toHaveLength(1)
    await monitor.idle()
    expect(provider.history).toHaveBeenCalledTimes(1)
  })

  test('disabling aborts an in-flight history read before it can write a late page', async () => {
    const provider = providerStub()
    let entered = false
    const slowProvider: BambuProvider = {
      ...provider,
      history: async (_printer, _cursor, _limit, signal) => new Promise((_resolve, reject) => {
        entered = true
        signal!.addEventListener('abort', () => reject(new Error('Synthetic cancelled transport')), { once: true })
      }),
    }
    makeMonitor(slowProvider)
    await enable()
    await monitor.requestSync()
    await vi.waitFor(() => expect(entered).toBe(true))
    await monitor.configure({ enabled: false })
    const status = await monitor.status()
    expect(status.syncing).toBe(false)
    expect(status.coverage[0].jobCount).toBe(0)
    expect(status.coverage[0].sync.lastSuccessAt).toBeNull()
    expect(status.events.some(event => event.kind === 'sync_error')).toBe(false)
  })

  test('a changed account cannot import into the former printer partition', async () => {
    const provider = providerStub()
    makeMonitor(provider)
    await enable()
    await monitor.requestSync()
    await monitor.idle()
    const first = (await monitor.status()).settings.activeConnectionId!
    now += 300_000
    provider.discover.mockResolvedValue({ ...syntheticElementAccount, accountId: '987654321' })
    await monitor.requestSync()
    await monitor.idle()
    let status = await monitor.status()
    expect(status.connectionState).toBe('selection_required')
    expect(status.problem?.code).toBe('account_mismatch')
    expect(provider.history).toHaveBeenCalledTimes(1)
    expect(status.coverage[0].sync.nextSyncAt).toBeNull()
    now += 30_000
    await monitor.configure({ enabled: true, accountId: '987654321', printerId: 'SYNTHETIC123' })
    await monitor.requestSync()
    await monitor.idle()
    status = await monitor.status()
    expect(status.connections).toHaveLength(2)
    expect(status.settings.activeConnectionId).not.toBe(first)
    expect(status.coverage.reduce((sum, item) => sum + item.jobCount, 0)).toBe(2)
    expect(await temp.repos.elementStatistics.getJob(first, '900')).not.toBeNull()
  })

  test('a printer removed from the account requires explicit reselection', async () => {
    const provider = providerStub()
    makeMonitor(provider)
    await enable()
    provider.discover.mockResolvedValue({ ...syntheticElementAccount, printers: [] })
    await monitor.requestSync()
    await monitor.idle()
    expect((await monitor.status()).problem?.code).toBe('printer_mismatch')
    expect(provider.history).not.toHaveBeenCalled()
  })

  test('expiry is actionable without refresh traffic or a success-shaped sync', async () => {
    const provider = providerStub()
    makeMonitor(provider)
    await enable()
    provider.discover.mockRejectedValue(new BambuProviderError('credential_expired'))
    await monitor.requestSync()
    await monitor.idle()
    const status = await monitor.status()
    expect(status.connectionState).toBe('expired')
    expect(status.coverage[0].sync.lastSuccessAt).toBeNull()
    expect(status.coverage[0].sync.nextSyncAt).toBeNull()
    expect(provider.history).not.toHaveBeenCalled()
    expect(status.events.some(event => event.kind === 'sync_error')).toBe(true)
  })

  test('records failures with cooldown, then recovers without losing the checkpoint', async () => {
    const provider = providerStub()
    makeMonitor(provider)
    await enable()
    provider.history.mockRejectedValueOnce(new BambuProviderError('provider_error'))
    await monitor.requestSync()
    await monitor.idle()
    expect((await monitor.status()).coverage[0].sync.consecutiveFailures).toBe(1)
    await expect(monitor.requestSync()).rejects.toMatchObject({ status: 429 })
    now += 60_000
    await monitor.requestSync()
    await monitor.idle()
    const status = await monitor.status()
    expect(status.coverage[0].sync.consecutiveFailures).toBe(0)
    expect(status.coverage[0].jobCount).toBe(1)
    expect(status.problem).toBeNull()
    expect(status.events.some(event => event.kind === 'sync_recovered')).toBe(true)
  })

  test('holds live deltas in memory and flushes one bounded sample on shutdown', async () => {
    const provider = providerStub()
    const record = vi.spyOn(temp.repos.elementStatistics, 'recordSnapshot')
    makeMonitor(provider)
    await enable()
    await monitor.requestSync()
    await monitor.idle()
    for (let index = 0; index < 1000; index += 1) {
      callbacks!.onSnapshot({ ...syntheticElementSnapshot, progressPercent: index % 100 })
    }
    expect(record).not.toHaveBeenCalled()
    expect((await monitor.status()).snapshot?.progressPercent).toBe(99)
    expect((await monitor.status()).freshness).toBe('fresh')
    now += 4 * 60_000
    expect((await monitor.status()).freshness).toBe('stale')
    const connectionId = (await monitor.status()).settings.activeConnectionId!
    await monitor.close()
    expect(record).toHaveBeenCalledTimes(1)
    expect((await temp.repos.elementStatistics.getSnapshot(connectionId))?.progressPercent).toBe(99)
    expect((await temp.repos.elementStatistics.listEvents(connectionId, 100)).length).toBeLessThan(10)
  })

  test('bounds state bursts and marks coalesced transitions as a recording gap', async () => {
    const provider = providerStub()
    makeMonitor(provider)
    await enable()
    await monitor.requestSync()
    await monitor.idle()
    for (let index = 0; index < 250; index += 1) {
      callbacks!.onSnapshot({ ...syntheticElementSnapshot, state: `SYNTHETIC_${index}` })
    }
    const connectionId = (await monitor.status()).settings.activeConnectionId!
    await monitor.close()
    const events = await temp.repos.elementStatistics.listEvents(connectionId, 200)
    expect(events.length).toBeLessThanOrEqual(101)
    expect(events.some(event => event.code === 'events_coalesced')).toBe(true)
  })
})
