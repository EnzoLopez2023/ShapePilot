import { EventEmitter } from 'node:events'
import { checkServerIdentity } from 'node:tls'
import type { PeerCertificate } from 'node:tls'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BambuProviderError, createBambuProvider,
} from './provider.ts'
import type {
  BambuFetch, BambuMqttClient, BambuMqttOptions, BambuProvider,
  BambuProviderConfig, BambuProviderOptions, BambuSubscriptionCallbacks,
} from './provider.ts'
import { BAMBU_MAX_PAYLOAD_BYTES } from './normalization.ts'

const start = Date.parse('2026-09-15T12:00:00Z')
const serial = '01P00A123456789'
const topic = `device/${serial}/report`
const accessToken = 'test-server-only-access-token'
const jwt = (claims: Record<string, unknown>) =>
  `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.test-signature`
const response = (body: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const task = { id: 100, deviceId: serial, status: 2, title: 'Bracket' }
const defaultFetch: BambuFetch = async url => {
  const path = new URL(url).pathname
  if (path.endsWith('/preference')) return response({ uid: 123, name: 'Maker', secret: 'discarded' })
  if (path.endsWith('/bind')) return response({ devices: [{
    dev_id: serial, name: 'Printer', dev_model_name: 'P1S', online: true, dev_access_code: 'lan-only-code',
  }] })
  return response({ hits: [task], total: 1 })
}

class MockMqtt extends EventEmitter implements BambuMqttClient {
  autoAck = true
  stallClose = false
  grant: { topic: string; qos: number }[] | undefined
  subscriptionError: Error | null = null
  acknowledge: ((error: Error | null, granted?: { topic: string; qos: number }[]) => void) | null = null
  subscribe = vi.fn((subscriptionTopic: string, _options: { qos: 0 }, callback: (error: Error | null, granted?: { topic: string; qos: number }[]) => void) => {
    this.acknowledge = callback
    if (this.autoAck) callback(this.subscriptionError, this.grant ?? [{ topic: subscriptionTopic, qos: 0 }])
  })
  end = vi.fn((_force: boolean, _options: Record<string, never>, callback: () => void) => {
    if (!this.stallClose) callback()
  })
  publish = vi.fn(() => { throw new Error('Publishing is forbidden in this test transport.') })
  report(print: Record<string, unknown>, packet: { retain?: boolean; dup?: boolean } = {}) {
    this.emit('message', topic, Buffer.from(JSON.stringify({ print })), packet)
  }
}

const created: BambuProvider[] = []
function makeProvider(options: BambuProviderOptions = {}, config: BambuProviderConfig = { accessToken, region: 'global' }) {
  const clients: MockMqtt[] = []
  const mqtt = vi.fn((_options: BambuMqttOptions) => {
    const client = new MockMqtt()
    clients.push(client)
    return client
  })
  const fetch = vi.fn(options.fetch ?? defaultFetch)
  const provider = createBambuProvider(config, { fetch, mqttConnect: mqtt, random: () => 0.5, ...options })
  created.push(provider)
  return { provider, fetch, mqtt, clients }
}

async function discover(provider: BambuProvider) {
  const pending = provider.discover()
  await vi.advanceTimersByTimeAsync(1_000)
  return pending
}

function callbacks(): BambuSubscriptionCallbacks {
  return { onSnapshot: vi.fn(), onState: vi.fn() }
}

async function connected(options: BambuProviderOptions = {}, config?: BambuProviderConfig) {
  const context = makeProvider(options, config)
  await discover(context.provider)
  const cb = callbacks()
  const pending = context.provider.subscribe('123', serial, cb)
  context.clients[0].emit('connect')
  const subscription = await pending
  return { ...context, cb, subscription, client: context.clients[0] }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(start)
})

afterEach(async () => {
  const closed = Promise.all(created.splice(0).map(provider => provider.close()))
  await vi.advanceTimersByTimeAsync(1_000)
  await closed
  vi.useRealTimers()
})

describe('read-only Bambu HTTP transport', () => {
  it.each([
    ['global', 'https://api.bambulab.com'],
    ['china', 'https://api.bambulab.cn'],
  ] as const)('uses the allowlisted %s endpoints and only the verified preference UID', async (region, origin) => {
    const config = { accessToken: jwt({ exp: (start + 60_000) / 1_000, uid: '999', sub: 'wrong-identity' }), region }
    const { provider, fetch } = makeProvider({}, config)
    const account = await discover(provider)
    expect(account.accountId).toBe('123')
    expect(account.region).toBe(region)
    expect(account.printers).toEqual([{ id: serial, name: 'Printer', model: 'P1S', online: true, state: null }])
    expect(provider.expiresAt).toBe('2026-09-15T12:01:00.000Z')
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      `${origin}/v1/design-user-service/my/preference`, `${origin}/v1/iot-service/api/user/bind`,
    ])
    for (const [, init] of fetch.mock.calls) {
      expect(init).toMatchObject({
        method: 'GET', redirect: 'manual', headers: { Authorization: `Bearer ${config.accessToken}`, Accept: 'application/json' },
      })
      expect(init.signal).toBeInstanceOf(AbortSignal)
    }
    expect(JSON.stringify(account)).not.toMatch(/lan-only|discarded|Bearer|wrong-identity/)
    expect(JSON.stringify(provider)).not.toContain(config.accessToken)
  })

  it('treats JWT expiry as advisory only and does not invent identity for an opaque token', () => {
    expect(makeProvider().provider.expiresAt).toBeNull()
    for (const token of ['not.a.jwt', jwt({ exp: '123' }), jwt({ exp: -1 }), jwt({ exp: 1.5 }), jwt({ sub: 456 })]) {
      expect(makeProvider({}, { accessToken: token, region: 'global' }).provider.expiresAt).toBeNull()
    }
  })

  it('rejects expired credentials before any HTTP or MQTT traffic', async () => {
    const { provider, fetch, mqtt } = makeProvider({}, { accessToken: jwt({ exp: start / 1_000 - 1 }), region: 'global' })
    await expect(provider.discover()).rejects.toMatchObject({ code: 'credential_expired' })
    await expect(provider.subscribe('123', serial, callbacks())).rejects.toMatchObject({ code: 'credential_expired' })
    expect(fetch).not.toHaveBeenCalled()
    expect(mqtt).not.toHaveBeenCalled()
  })

  it.each([
    { accessToken: '', region: 'global' },
    { accessToken: 'token\ninjection', region: 'global' },
    { accessToken, region: 'unexpected-host' },
    { accessToken: 'x'.repeat(16_385), region: 'global' },
  ])('fails closed on invalid configuration without echoing it', config => {
    expect(() => createBambuProvider(config as BambuProviderConfig, { fetch: defaultFetch })).toThrow(
      expect.objectContaining({ code: 'invalid_configuration' }),
    )
  })

  it('uses deviceId, an offset and a bounded limit without unrelated endpoints', async () => {
    const { provider, fetch } = makeProvider()
    await provider.history(serial, '200', 20)
    const url = new URL(fetch.mock.calls[0][0])
    expect(url.pathname).toBe('/v1/user-service/my/tasks')
    // Bambu ignores `after`; `offset` is what pages (verified live 2026-09-16).
    expect(Object.fromEntries(url.searchParams)).toEqual({ deviceId: serial, offset: '200', limit: '20' })
    expect(fetch.mock.calls[0][1].method).toBe('GET')
  })

  it.each([
    ['../serial', null, 20], [serial, '../cursor', 20], [serial, null, 0],
    [serial, null, 101], [serial, null, 2.5], [serial, '1220177551', 20],
  ] as const)('rejects invalid history inputs before network access (%s)', async (id, cursor, limit) => {
    const { provider, fetch } = makeProvider()
    await expect(provider.history(id, cursor, limit)).rejects.toBeInstanceOf(BambuProviderError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([301, 302, 307, 308])('does not forward a token to an HTTP %s redirect target', async status => {
    const fetch = vi.fn<BambuFetch>(async () => response({ error: accessToken }, status, {
      location: `https://attacker.invalid/?token=${accessToken}`,
    }))
    const { provider } = makeProvider({ fetch })
    const error = await provider.history(serial, null, 20).catch(error => error)
    expect(error).toMatchObject({ code: 'redirect_rejected', status })
    expect(String(error)).not.toContain(accessToken)
    expect(JSON.stringify(error)).not.toContain('attacker')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1].redirect).toBe('manual')
  })

  it('also rejects already-redirected injected responses', async () => {
    const fetch = vi.fn<BambuFetch>(async () => {
      const result = response({ hits: [] })
      Object.defineProperty(result, 'redirected', { value: true })
      return result
    })
    const { provider } = makeProvider({ fetch })
    await expect(provider.history(serial, null, 20)).rejects.toMatchObject({ code: 'redirect_rejected' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([401, 403])('makes HTTP %s actionable and terminal, without refresh or automatic retries', async status => {
    const fetch = vi.fn<BambuFetch>(async () => response({ message: `Bearer ${accessToken}`, headers: { token: accessToken } }, status))
    const { provider, mqtt } = makeProvider({ fetch })
    const error = await provider.history(serial, null, 20).catch(error => error)
    expect(error).toMatchObject({ code: 'credential_rejected', status, retryAfterMs: null })
    expect(String(error)).not.toContain(accessToken)
    await expect(provider.discover()).rejects.toMatchObject({ code: 'credential_rejected' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(mqtt).not.toHaveBeenCalled()
  })

  it('rejects safe error envelopes even when HTTP status is 200', async () => {
    const { provider } = makeProvider({ fetch: async () => response({ code: 401, message: accessToken }) })
    await expect(provider.history(serial, null, 20)).rejects.toMatchObject({ code: 'credential_rejected', status: 401 })
    const other = makeProvider({ fetch: async () => response({ code: 999, message: accessToken, hits: [] }) }).provider
    const error = await other.history(serial, null, 20).catch(error => error)
    expect(error).toMatchObject({ code: 'cloud_rejected' })
    expect(String(error)).not.toContain(accessToken)
  })

  it('bounds transient retries, spacing and retry delay within one request budget', async () => {
    const times: number[] = []
    const fetch = vi.fn<BambuFetch>(async () => {
      times.push(Date.now())
      return times.length < 3 ? response({ error: accessToken }, times.length === 1 ? 500 : 503) : response({ hits: [] })
    })
    const { provider } = makeProvider({ fetch })
    const pending = provider.history(serial, null, 20)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(await pending).toEqual({ jobs: [], nextCursor: null, total: null })
    expect(times).toEqual([start, start + 1_000, start + 3_000])
  })

  it('stops after three transient failures and strips upstream exception text', async () => {
    const fetch = vi.fn<BambuFetch>(async () => { throw new Error(`URL https://example.invalid/?token=${accessToken}`) })
    const { provider } = makeProvider({ fetch })
    const pending = provider.history(serial, null, 20).catch(error => error)
    await vi.advanceTimersByTimeAsync(3_000)
    const error = await pending
    expect(error).toMatchObject({ code: 'network_unavailable' })
    expect(String(error)).not.toMatch(/example.invalid|test-server-only/)
    expect(error.cause).toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it.each(['2', 'Tue, 15 Sep 2026 12:00:02 GMT'])('honors Retry-After %s when a bounded retry fits', async header => {
    const fetch = vi.fn<BambuFetch>()
      .mockResolvedValueOnce(response(null, 429, { 'retry-after': header }))
      .mockResolvedValueOnce(response({ hits: [] }))
    const { provider } = makeProvider({ fetch })
    const pending = provider.history(serial, null, 20)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toMatchObject({ jobs: [] })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('returns long rate limits immediately and enforces them across subsequent requests', async () => {
    const fetch = vi.fn<BambuFetch>()
      .mockResolvedValueOnce(response(null, 429, { 'retry-after': '120' }))
      .mockResolvedValueOnce(response({ hits: [] }))
    const { provider } = makeProvider({ fetch })
    await expect(provider.history(serial, null, 20)).rejects.toMatchObject({ code: 'rate_limited', status: 429, retryAfterMs: 120_000 })
    await expect(provider.history(serial, null, 20)).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 120_000 })
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(120_000)
    await expect(provider.history(serial, null, 20)).resolves.toMatchObject({ jobs: [] })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('honors maintenance Retry-After across requests as well as rate limits', async () => {
    const fetch = vi.fn<BambuFetch>(async () => response(null, 503, { 'retry-after': '120' }))
    const { provider } = makeProvider({ fetch })
    await expect(provider.history(serial, null, 20)).rejects.toMatchObject({
      code: 'cloud_unavailable', status: 503, retryAfterMs: 120_000,
    })
    await expect(provider.history(serial, null, 20)).rejects.toMatchObject({
      code: 'cloud_unavailable', status: 503, retryAfterMs: 120_000,
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('enforces a 12-second connection budget even for an injected fetch ignoring cancellation', async () => {
    let signal: AbortSignal | undefined
    const fetch = vi.fn<BambuFetch>((_url, init) => {
      signal = init.signal
      return new Promise(() => {})
    })
    const { provider } = makeProvider({ fetch })
    const pending = provider.history(serial, null, 20).catch(error => error)
    await vi.advanceTimersByTimeAsync(12_000)
    expect(await pending).toMatchObject({ code: 'http_timeout' })
    expect(signal?.aborted).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('includes stalled response body reads in the same 12-second budget and cancels them', async () => {
    const cancel = vi.fn()
    const fetch = vi.fn<BambuFetch>(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(Buffer.from('{"hits":[')) },
      cancel,
    })))
    const { provider } = makeProvider({ fetch })
    const pending = provider.history(serial, null, 20).catch(error => error)
    await vi.advanceTimersByTimeAsync(12_000)
    expect(await pending).toMatchObject({ code: 'http_timeout' })
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
    expect(cancel).toHaveBeenCalled()
  })

  it.each(['declared', 'streamed'])('rejects %s responses exceeding 2 MiB without persisting the response', async kind => {
    const fetch: BambuFetch = async () => kind === 'declared'
      ? response({ hits: [] }, 200, { 'content-length': String(BAMBU_MAX_PAYLOAD_BYTES + 1) })
      : new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(BAMBU_MAX_PAYLOAD_BYTES))
          controller.enqueue(new Uint8Array(1))
          controller.close()
        },
      }))
    const { provider } = makeProvider({ fetch })
    await expect(provider.history(serial, null, 20)).rejects.toMatchObject({ code: 'response_too_large' })
  })

  it.each([
    `{"hits":[${accessToken}}`, Buffer.from([0xff, 0xfe]), JSON.stringify({ hits: [], oversized: 'x'.repeat(16_385) }),
  ])('rejects malformed JSON, encoding and text bounds with static errors', async body => {
    const fetch = vi.fn<BambuFetch>(async () => new Response(body))
    const { provider } = makeProvider({ fetch })
    const error = await provider.history(serial, null, 20).catch(error => error)
    expect(error).toMatchObject({ code: 'invalid_response' })
    expect(String(error)).not.toContain(accessToken)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('serializes requests and does not let a cancelled queued request break the mutex', async () => {
    let complete: (response: Response) => void = () => {}
    const fetch = vi.fn<BambuFetch>()
      .mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
      .mockImplementation(defaultFetch)
    const { provider } = makeProvider({ fetch })
    const first = provider.history(serial, null, 20)
    const abort = new AbortController()
    const cancelled = provider.history(serial, null, 20, abort.signal).catch(error => error)
    const third = provider.history(serial, null, 20)
    await vi.advanceTimersByTimeAsync(0)
    abort.abort(new Error(accessToken))
    expect(await cancelled).toMatchObject({ code: 'request_aborted' })
    expect(fetch).toHaveBeenCalledTimes(1)
    complete(response({ hits: [] }))
    await first
    await vi.advanceTimersByTimeAsync(999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await third
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('bounds the queue, aborts queued and active calls on close, and is idempotent', async () => {
    const fetch = vi.fn<BambuFetch>(() => new Promise(() => {}))
    const { provider } = makeProvider({ fetch })
    const pending = Array.from({ length: 16 }, () => provider.history(serial, null, 20).catch(error => error))
    await expect(provider.history(serial, null, 20)).rejects.toMatchObject({ code: 'queue_full' })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    await provider.close()
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
    expect((await Promise.all(pending)).every(error => error.code === 'provider_closed')).toBe(true)
    await provider.close()
    await expect(provider.history(serial, null, 20)).rejects.toMatchObject({ code: 'provider_closed' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not let an upstream echo smuggle the configured token into public names', async () => {
    const { provider } = makeProvider({ fetch: async (url, init) => url.endsWith('/preference')
      ? response({ uid: 123, name: `My ${accessToken}` }) : defaultFetch(url, init) })
    const pending = provider.discover().catch(error => error)
    await vi.advanceTimersByTimeAsync(1_000)
    const error = await pending
    expect(error).toMatchObject({ code: 'invalid_response' })
    expect(String(error)).not.toContain(accessToken)
  })
})

describe('read-only Bambu MQTT subscription', () => {
  it.each([
    ['global', 'us.mqtt.bambulab.com'], ['china', 'cn.mqtt.bambulab.com'],
  ] as const)('uses verified %s TLS, preference UID, and exactly one report topic without publishing', async (region, host) => {
    const token = jwt({ exp: start / 1_000 + 3_600, uid: '999' })
    const { mqtt, client, provider } = await connected({}, { accessToken: token, region })
    expect(mqtt).toHaveBeenCalledTimes(1)
    const options = mqtt.mock.calls[0][0]
    expect(options).toMatchObject({
      protocol: 'mqtts', host, port: 8883, servername: host, rejectUnauthorized: true,
      minVersion: 'TLSv1.2', username: 'u_123', password: token, protocolVersion: 4,
      reconnectPeriod: 0, reconnectOnConnackError: false, resubscribe: false, queueQoSZero: false, clean: true,
    })
    expect(options.checkServerIdentity).toBe(checkServerIdentity)
    expect(options.checkServerIdentity(host, { subjectaltname: 'DNS:wrong.invalid' } as PeerCertificate))
      .toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' })
    expect(client.subscribe).toHaveBeenCalledWith(topic, { qos: 0 }, expect.any(Function))
    expect(client.publish).not.toHaveBeenCalled()
    expect(options.will).toBeUndefined()
    expect(options.servers).toBeUndefined()
    expect(options.transformWsUrl).toBeUndefined()
    expect(JSON.stringify(provider)).not.toContain(token)
  })

  it('discovers identity if necessary before subscribing rather than trusting caller or JWT identity', async () => {
    const { provider, clients, fetch } = makeProvider()
    const pending = provider.subscribe('123', serial, callbacks())
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetch).toHaveBeenCalledTimes(2)
    clients[0].emit('connect')
    await pending
    expect(clients[0].subscribe).toHaveBeenCalledTimes(1)
  })

  it('rejects account mismatch, unbound printers, and wildcard/path topic inputs', async () => {
    const { provider, mqtt, fetch } = makeProvider()
    await discover(provider)
    await expect(provider.subscribe('999', serial, callbacks())).rejects.toMatchObject({ code: 'account_mismatch' })
    await expect(provider.subscribe('123', 'unbound', callbacks())).rejects.toMatchObject({ code: 'printer_not_bound' })
    await expect(provider.history('unbound', null, 20)).rejects.toMatchObject({ code: 'printer_not_bound' })
    for (const value of ['#', '+', '../evil', 'device/other/report', 'serial\n']) {
      await expect(provider.subscribe('123', value, callbacks())).rejects.toMatchObject({ code: 'invalid_identifier' })
    }
    await expect(provider.subscribe('u_123', serial, callbacks())).rejects.toMatchObject({ code: 'invalid_identifier' })
    expect(mqtt).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each(['connection', 'subscription'])('bounds initial %s establishment and does not reconnect a rejected initial attempt', async kind => {
    const { provider, clients, mqtt } = makeProvider()
    await discover(provider)
    const cb = callbacks()
    const pending = provider.subscribe('123', serial, cb).catch(error => error)
    if (kind === 'subscription') {
      clients[0].autoAck = false
      clients[0].emit('connect')
    }
    await vi.advanceTimersByTimeAsync(12_000)
    expect(await pending).toMatchObject({ code: 'mqtt_connect_timeout' })
    expect(cb.onState).toHaveBeenLastCalledWith('error', expect.objectContaining({ code: 'mqtt_connect_timeout' }))
    expect(clients[0].end).toHaveBeenCalledWith(true, {}, expect.any(Function))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mqtt).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ topic, qos: 128 }], [{ topic: 'device/other/report', qos: 0 }], [], [{ topic, qos: 1 }],
  ].map(grant => ({ grant })))('requires a successful grant for precisely the requested read-only topic (%j)', async ({ grant }) => {
    const { provider, clients } = makeProvider()
    await discover(provider)
    const pending = provider.subscribe('123', serial, callbacks()).catch(error => error)
    clients[0].grant = grant
    clients[0].emit('connect')
    expect(await pending).toMatchObject({ code: 'mqtt_subscribe_failed' })
    expect(clients[0].publish).not.toHaveBeenCalled()
  })

  it.each([4, 5, 134, 135])('makes numeric authentication rejection %s terminal without echoing the exception', async code => {
    const { provider, clients, mqtt } = makeProvider()
    await discover(provider)
    const cb = callbacks()
    const pending = provider.subscribe('123', serial, cb).catch(error => error)
    clients[0].emit('error', Object.assign(new Error(`password=${accessToken}`), { code }))
    const error = await pending
    expect(error).toMatchObject({ code: 'credential_rejected' })
    expect(String(error)).not.toContain(accessToken)
    expect(cb.onState).toHaveBeenLastCalledWith('expired', expect.objectContaining({ code: 'credential_rejected' }))
    await vi.advanceTimersByTimeAsync(120_000)
    expect(mqtt).toHaveBeenCalledTimes(1)
    await expect(provider.history(serial, null, 20)).rejects.toMatchObject({ code: 'credential_rejected' })
  })

  it('uses bounded exponential reconnect, coalesces duplicate disconnect signals and resets after stability', async () => {
    const { provider, clients, client, cb, mqtt } = await connected()
    client.emit('error', new Error(`secret ${accessToken}`))
    client.emit('close')
    client.emit('offline')
    expect(cb.onState).toHaveBeenLastCalledWith('offline', expect.objectContaining({ code: 'mqtt_unavailable' }))
    await vi.advanceTimersByTimeAsync(999)
    expect(mqtt).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(mqtt).toHaveBeenCalledTimes(2)
    clients[1].emit('connect')
    clients[1].emit('close')
    await vi.advanceTimersByTimeAsync(1_999)
    expect(mqtt).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    clients[2].emit('connect')
    await vi.advanceTimersByTimeAsync(60_000)
    clients[2].emit('close')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(mqtt).toHaveBeenCalledTimes(4)
    expect(clients.every(client => client.publish.mock.calls.length === 0)).toBe(true)
    await provider.close()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(mqtt).toHaveBeenCalledTimes(4)
  })

  it.each([[0, 800], [1, 1_200]] as const)('jitters reconnect delay with injected randomness %s', async (random, delay) => {
    const { client, mqtt } = await connected({ random: () => random })
    client.emit('close')
    await vi.advanceTimersByTimeAsync(delay - 1)
    expect(mqtt).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(mqtt).toHaveBeenCalledTimes(2)
  })

  it('caps repeated reconnect backoff at one minute without resetting on a flapping CONNACK', async () => {
    const { clients, mqtt } = await connected()
    const delays = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]
    for (let i = 0; i < delays.length; i++) {
      clients[i].emit('close')
      await vi.advanceTimersByTimeAsync(delays[i] - 1)
      expect(mqtt).toHaveBeenCalledTimes(i + 1)
      await vi.advanceTimersByTimeAsync(1)
      expect(mqtt).toHaveBeenCalledTimes(i + 2)
      clients[i + 1].emit('connect')
    }
  })

  it('stops reconnecting on a subsequent broker authentication disconnect', async () => {
    const { client, provider, cb, mqtt } = await connected()
    client.emit('disconnect', { reasonCode: 135, reasonString: accessToken })
    expect(cb.onState).toHaveBeenLastCalledWith('expired', expect.objectContaining({ code: 'credential_rejected' }))
    expect(client.end).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(mqtt).toHaveBeenCalledTimes(1)
    await expect(provider.discover()).rejects.toMatchObject({ code: 'credential_rejected' })
  })

  it('expires a connected subscription when advisory exp is reached, with no refresh', async () => {
    const { cb, client, mqtt, provider } = await connected({}, {
      accessToken: jwt({ exp: start / 1_000 + 5 }), region: 'global',
    })
    await vi.advanceTimersByTimeAsync(4_000)
    expect(cb.onState).toHaveBeenLastCalledWith('expired', expect.objectContaining({ code: 'credential_expired' }))
    expect(client.end).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mqtt).toHaveBeenCalledTimes(1)
    await expect(provider.history(serial, null, 20)).rejects.toMatchObject({ code: 'credential_expired' })
  })

  it('closes an active subscription when HTTP rejects the credential', async () => {
    let rejected = false
    const fetch: BambuFetch = (url, init) => rejected ? Promise.resolve(response({ error: accessToken }, 401)) : defaultFetch(url, init)
    const { provider, client, cb, mqtt } = await connected({ fetch })
    rejected = true
    const pending = provider.history(serial, null, 20).catch(error => error)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await pending).toMatchObject({ code: 'credential_rejected' })
    expect(cb.onState).toHaveBeenLastCalledWith('expired', expect.objectContaining({ code: 'credential_rejected' }))
    expect(client.end).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mqtt).toHaveBeenCalledTimes(1)
  })

  it('makes close bounded during handshake even if transport end never calls back', async () => {
    const { provider, clients, mqtt } = makeProvider()
    await discover(provider)
    const cb = callbacks()
    const pending = provider.subscribe('123', serial, cb).catch(error => error)
    clients[0].stallClose = true
    const closing = provider.close()
    expect(await pending).toMatchObject({ code: 'provider_closed' })
    await vi.advanceTimersByTimeAsync(1_000)
    await closing
    clients[0].emit('connect')
    clients[0].emit('error', new Error(accessToken))
    clients[0].report({ mc_percent: 99 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mqtt).toHaveBeenCalledTimes(1)
    expect(cb.onSnapshot).not.toHaveBeenCalled()
    expect(cb.onState).toHaveBeenCalledTimes(1)
  })

  it('does not start a transport if a connecting-state consumer closes the provider', async () => {
    const { provider, mqtt } = makeProvider()
    await discover(provider)
    const cb = callbacks()
    vi.mocked(cb.onState).mockImplementation(state => { if (state === 'connecting') void provider.close() })
    await expect(provider.subscribe('123', serial, cb)).rejects.toMatchObject({ code: 'provider_closed' })
    expect(mqtt).not.toHaveBeenCalled()
  })

  it('closes a subscription independently and idempotently without shutting down provider history', async () => {
    const { provider, subscription, client, cb } = await connected()
    await subscription.close()
    await subscription.close()
    expect(client.end).toHaveBeenCalledTimes(1)
    client.report({ mc_percent: 30 })
    expect(cb.onSnapshot).not.toHaveBeenCalled()
    const history = provider.history(serial, null, 20)
    await vi.advanceTimersByTimeAsync(1_000)
    expect((await history).jobs).toHaveLength(1)
  })

  it('bounds simultaneous subscriptions', async () => {
    const { provider, clients } = makeProvider()
    await discover(provider)
    for (let i = 0; i < 8; i++) {
      const pending = provider.subscribe('123', serial, callbacks())
      clients[i].emit('connect')
      await pending
    }
    await expect(provider.subscribe('123', serial, callbacks())).rejects.toMatchObject({ code: 'subscription_limit' })
    expect(clients).toHaveLength(8)
  })

  it('ignores other topics, retained/duplicate packets and camera-only reports for freshness', async () => {
    const { client, cb } = await connected()
    client.emit('message', 'device/OTHER/report', Buffer.from('{"print":{"mc_percent":30}}'), {})
    client.report({ mc_percent: 30 }, { retain: true })
    client.report({ mc_percent: 30 }, { dup: true })
    client.report({ ipcam: { rtsp_url: `rtsp://name:${accessToken}@host.invalid` }, xcam: {} })
    expect(cb.onSnapshot).not.toHaveBeenCalled()
    client.report({ mc_percent: 30 })
    expect(cb.onSnapshot).toHaveBeenCalledTimes(1)
  })

  it('requires SUBACK before treating data as observed printer status', async () => {
    const { provider, clients } = makeProvider()
    await discover(provider)
    const cb = callbacks()
    const pending = provider.subscribe('123', serial, cb)
    clients[0].autoAck = false
    clients[0].emit('connect')
    clients[0].report({ mc_percent: 90 })
    expect(cb.onSnapshot).not.toHaveBeenCalled()
    clients[0].acknowledge?.(null, [{ topic, qos: 0 }])
    await pending
    clients[0].report({ mc_percent: 90 })
    expect(cb.onSnapshot).toHaveBeenCalledTimes(1)
  })

  it('emits partial normalized updates and important errors/HMS without exposing raw data', async () => {
    const { client, cb } = await connected()
    client.report({ subtask_id: '10', subtask_name: 'Bracket', gcode_state: 'RUNNING', mc_percent: 30, nozzle_temper: 210 })
    await vi.advanceTimersByTimeAsync(1_000)
    client.report({ print_error: 123, hms: [{ code: 456, attr: 7, message: accessToken }] })
    expect(cb.onSnapshot).toHaveBeenCalledTimes(2)
    const snapshot = vi.mocked(cb.onSnapshot).mock.calls[1][0]
    expect(snapshot).toMatchObject({
      state: 'RUNNING', jobId: '10', progressPercent: 30, nozzleActualC: 210,
      printError: '123', hms: [{ code: '456', attribute: '7' }],
    })
    expect(snapshot.fieldUpdatedAt.nozzleActualC).toBe(new Date(start + 1_000).toISOString())
    expect(snapshot.fieldUpdatedAt.printError).toBe(new Date(start + 2_000).toISOString())
    expect(JSON.stringify(snapshot)).not.toContain(accessToken)
    client.report({ hms: [], print_error: 0 })
    expect(vi.mocked(cb.onSnapshot).mock.calls.at(-1)?.[0]).toMatchObject({ hms: [], printError: '0' })
    expect(client.publish).not.toHaveBeenCalled()
  })

  it('protects accumulated data from consumer mutation and exceptions', async () => {
    const { client, cb } = await connected()
    client.report({ mc_percent: 30, nozzle_temper: 210 })
    const first = vi.mocked(cb.onSnapshot).mock.calls[0][0]
    first.nozzleActualC = 999
    first.fieldUpdatedAt.nozzleActualC = 'bad-time'
    vi.mocked(cb.onSnapshot).mockImplementationOnce(() => { throw new Error(accessToken) })
    expect(() => client.report({ mc_percent: 31 })).not.toThrow()
    client.report({ mc_percent: 32 })
    const last = vi.mocked(cb.onSnapshot).mock.calls.at(-1)?.[0]
    expect(last?.nozzleActualC).toBe(210)
    expect(last?.fieldUpdatedAt.nozzleActualC).not.toBe('bad-time')
  })

  it.each([
    [Buffer.from(`{"print":${accessToken}}`), 'mqtt_invalid_payload'],
    [Buffer.from([0xff, 0xfe]), 'mqtt_invalid_payload'],
    [Buffer.alloc(BAMBU_MAX_PAYLOAD_BYTES + 1), 'mqtt_payload_too_large'],
    [Buffer.from(JSON.stringify({ print: { hms: 'not-an-array' } })), 'mqtt_invalid_payload'],
    [Buffer.from(JSON.stringify({ print: { mc_percent: 1e100 } })), 'mqtt_invalid_payload'],
  ])('surfaces safe malformed/oversized report errors and recovers on subsequent valid data', async (payload, code) => {
    const { client, cb } = await connected()
    client.emit('message', topic, payload, {})
    expect(cb.onSnapshot).not.toHaveBeenCalled()
    expect(cb.onState).toHaveBeenLastCalledWith('error', expect.objectContaining({ code }))
    expect(JSON.stringify(vi.mocked(cb.onState).mock.calls)).not.toContain(accessToken)
    client.report({ mc_percent: 10 })
    expect(cb.onSnapshot).toHaveBeenCalledTimes(1)
    expect(cb.onState).toHaveBeenLastCalledWith('connected', null)
  })

  it('drops stale, future, out-of-order and invalid timestamps instead of rejuvenating them', async () => {
    const { client, cb } = await connected()
    for (const timestamp of [start - 180_000, start + 60_000, '2026-09-15 12:00:00']) {
      client.report({ timestamp, mc_percent: 50 })
      expect(cb.onState).toHaveBeenLastCalledWith('error', expect.objectContaining({ code: 'mqtt_stale_report' }))
    }
    expect(cb.onSnapshot).not.toHaveBeenCalled()
    client.report({ timestamp: start - 5_000, mc_percent: 51 })
    expect(vi.mocked(cb.onSnapshot).mock.calls[0][0].receivedAt).toBe(new Date(start - 5_000).toISOString())
    client.report({ timestamp: start - 6_000, mc_percent: 49 })
    expect(cb.onSnapshot).toHaveBeenCalledTimes(1)
    expect(cb.onState).toHaveBeenLastCalledWith('error', expect.objectContaining({ code: 'mqtt_stale_report' }))
  })

  it('does not carry stale missing fields through a reconnect or retained snapshot', async () => {
    const { clients, client, cb } = await connected()
    client.report({ subtask_id: '10', gcode_state: 'RUNNING', mc_percent: 75, nozzle_temper: 210 })
    client.emit('close')
    await vi.advanceTimersByTimeAsync(1_000)
    clients[1].emit('connect')
    clients[1].report({ subtask_id: '10', gcode_state: 'RUNNING', mc_percent: 75 }, { retain: true })
    clients[1].report({ nozzle_temper: 25 })
    expect(cb.onSnapshot).toHaveBeenCalledTimes(2)
    expect(vi.mocked(cb.onSnapshot).mock.calls[1][0]).toMatchObject({
      nozzleActualC: 25, state: null, jobId: null, progressPercent: null,
    })
  })

  it('keeps rejecting out-of-order report timestamps across reconnects', async () => {
    const { clients, client, cb } = await connected()
    client.report({ timestamp: start, mc_percent: 75 })
    client.emit('close')
    await vi.advanceTimersByTimeAsync(1_000)
    clients[1].emit('connect')
    clients[1].report({ timestamp: start - 1_000, mc_percent: 60 })
    expect(cb.onSnapshot).toHaveBeenCalledTimes(1)
    expect(cb.onState).toHaveBeenLastCalledWith('error', expect.objectContaining({ code: 'mqtt_stale_report' }))
    clients[1].report({ timestamp: start + 1_000, mc_percent: 76 })
    expect(cb.onSnapshot).toHaveBeenCalledTimes(2)
  })

  it('rejects configured token echoes in otherwise allowed fields without returning them', async () => {
    const { client, cb } = await connected()
    client.report({ subtask_name: `Name ${accessToken}`, mc_percent: 30 })
    expect(cb.onSnapshot).not.toHaveBeenCalled()
    expect(cb.onState).toHaveBeenLastCalledWith('error', expect.objectContaining({ code: 'mqtt_invalid_payload' }))
    expect(JSON.stringify(vi.mocked(cb.onState).mock.calls)).not.toContain(accessToken)
    client.report({ mc_percent: 31 })
    expect(vi.mocked(cb.onSnapshot).mock.calls[0][0].jobName).toBeNull()
  })
})

describe('safe provider errors', () => {
  it('accepts the controller message signature while defaulting retryAfterMs to null', () => {
    const error = new BambuProviderError('provider_error', 'The read-only monitor could not complete this request.')
    expect(error).toMatchObject({ code: 'provider_error', retryAfterMs: null })
    expect(error.status).toBeUndefined()
    expect(error.message).toBe(new BambuProviderError('provider_error').message)
    expect(new BambuProviderError('rate_limited', 'The cloud is rate limiting requests.', 1_500, 429))
      .toMatchObject({ code: 'rate_limited', retryAfterMs: 1_500, status: 429 })
    expect(new BambuProviderError('credential_rejected', 'Credential rejected.', undefined, 401))
      .toMatchObject({ code: 'credential_rejected', retryAfterMs: null, status: 401 })
  })

  it('never echoes an accidentally supplied upstream message through the compatibility signature', () => {
    const error = new BambuProviderError('provider_error', `Bearer ${accessToken} https://example.invalid/?token=${accessToken}`)
    expect(String(error)).not.toMatch(/Bearer|example.invalid|test-server-only/)
    expect(JSON.stringify(error)).not.toContain(accessToken)
    expect(error.cause).toBeUndefined()
  })

  it('allowlists codes, messages, retry delays and status without accepting arbitrary error content', () => {
    const error = new BambuProviderError(`https://bad.invalid/${accessToken}`, Infinity, 999)
    expect(error).toMatchObject({ code: 'provider_error', retryAfterMs: null })
    expect(error.status).toBeUndefined()
    expect(String(error)).not.toContain(accessToken)
    expect(new BambuProviderError('rate_limited', 999_999_999, 429)).toMatchObject({
      code: 'rate_limited', retryAfterMs: 86_400_000, status: 429,
    })
  })
})
