import { randomUUID } from 'node:crypto'
import { checkServerIdentity } from 'node:tls'
import { connect } from 'mqtt'
import type { IClientOptions } from 'mqtt'
import type {
  BambuRegion, ElementAccount, ElementHistoryPage, ElementProblem, ElementSnapshot,
} from '../../lib/contracts/elementStatistics.ts'
import { BambuProviderError } from './bambuProviderErrors.ts'
import type { BambuProviderErrorCode } from './bambuProviderErrors.ts'
import { createBambuHttpsTransport } from './bambuHttpTransport.ts'
import type { BambuFetch } from './bambuHttpTransport.ts'
import {
  assertBoundedBambuPayload, BAMBU_MAX_HISTORY_LIMIT, BAMBU_MAX_PAYLOAD_BYTES, bambuIdentifier, historyOffset,
  bambuReportTime, isBambuObject, mergeBambuSnapshot, normalizeBambuAccount, normalizeBambuHistory,
} from './normalization.ts'

export { BambuProviderError } from './bambuProviderErrors.ts'
export type { BambuFetch, BambuFetchInit } from './bambuHttpTransport.ts'

export interface BambuProviderConfig {
  accessToken: string
  region: BambuRegion
}

export interface BambuSubscription {
  close(): Promise<void>
}

export interface BambuSubscriptionCallbacks {
  onSnapshot(snapshot: ElementSnapshot): void
  onState(state: 'connecting' | 'connected' | 'offline' | 'expired' | 'error', problem: ElementProblem | null): void
}

export interface BambuProvider {
  readonly expiresAt: string | null
  discover(signal?: AbortSignal): Promise<ElementAccount>
  history(printerId: string, cursor: string | null, limit: number, signal?: AbortSignal): Promise<ElementHistoryPage>
  subscribe(accountId: string, printerId: string, callbacks: BambuSubscriptionCallbacks): Promise<BambuSubscription>
  close(): Promise<void>
}

export interface BambuMqttPacket {
  retain?: boolean
  dup?: boolean
}

export interface BambuMqttClient {
  on(event: 'connect', listener: () => void): unknown
  on(event: 'message', listener: (topic: string, payload: Buffer, packet: BambuMqttPacket) => void): unknown
  on(event: 'error', listener: (error: unknown) => void): unknown
  on(event: 'close' | 'offline', listener: () => void): unknown
  on(event: 'disconnect', listener: (packet: { reasonCode?: number }) => void): unknown
  subscribe(topic: string, options: { qos: 0 }, callback: (error: Error | null, granted?: { topic: string; qos: number }[]) => void): unknown
  end(force: boolean, options: Record<string, never>, callback: () => void): unknown
}

export interface BambuMqttOptions extends IClientOptions {
  protocol: 'mqtts'
  host: string
  port: 8883
  servername: string
  rejectUnauthorized: true
  checkServerIdentity: typeof checkServerIdentity
  minVersion: 'TLSv1.2'
  username: string
  password: string
  reconnectPeriod: 0
  reconnectOnConnackError: false
  resubscribe: false
  clean: true
  queueQoSZero: false
}

export interface BambuProviderOptions {
  fetch?: BambuFetch
  mqttConnect?: (options: BambuMqttOptions) => BambuMqttClient
  now?: () => number
  random?: () => number
}

// Global: Doridian/OpenBambuAPI cloud-http.md, mqtt.md and tls.md.
// China: greghesp/ha-bambulab pybambu/{const,utils,bambu_cloud}.py:
// get_Url maps REST .com to .cn; cloud_mqtt_host selects cn.mqtt.bambulab.com.
const endpoints = {
  global: { rest: 'https://api.bambulab.com', mqtt: 'us.mqtt.bambulab.com' },
  china: { rest: 'https://api.bambulab.cn', mqtt: 'cn.mqtt.bambulab.com' },
} as const
const HTTP_BUDGET_MS = 12_000
const HTTP_SPACING_MS = 1_000
const HTTP_MAX_QUEUED = 16
const MQTT_CONNECT_MS = 12_000
const MQTT_CLOSE_MS = 1_000
const MAX_SUBSCRIPTIONS = 8
const MAX_REPORT_AGE_MS = 120_000

function safeError(error: unknown, fallback: BambuProviderErrorCode): BambuProviderError {
  return error instanceof BambuProviderError
    ? new BambuProviderError(error.code, error.retryAfterMs, error.status)
    : new BambuProviderError(fallback)
}

function advisoryExpiry(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (!isBambuObject(claims) || typeof claims.exp !== 'number' || !Number.isInteger(claims.exp)
      || claims.exp < 0 || claims.exp > 253_402_300_799) return null
    return new Date(claims.exp * 1_000).toISOString()
  } catch {
    return null
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal, error: () => BambuProviderError): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => { signal.removeEventListener('abort', aborted); reject(error()) }
    if (signal.aborted) aborted()
    else signal.addEventListener('abort', aborted, { once: true })
    void promise.then(
      value => { signal.removeEventListener('abort', aborted); resolve(value) },
      failure => { signal.removeEventListener('abort', aborted); reject(failure) },
    )
  })
}

function sleep(ms: number, signal: AbortSignal, error: () => BambuProviderError): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', aborted); resolve() }
    const timer = setTimeout(finish, Math.max(0, ms))
    const aborted = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); reject(error()) }
    if (signal.aborted) aborted()
    else signal.addEventListener('abort', aborted, { once: true })
  })
}

function retryAfter(value: string | null, now: number): number | null {
  if (value === null || value.length > 128) return null
  let delay: number
  if (/^\d+(?:\.\d+)?$/.test(value)) delay = Number(value) * 1_000
  else delay = Date.parse(value) - now
  return Number.isFinite(delay) ? Math.min(86_400_000, Math.max(0, Math.ceil(delay))) : null
}

function cancelBody(response: Response): void {
  try { void response.body?.cancel().catch(() => {}) } catch { /* Already consumed or cancelled. */ }
}

async function readJson(response: Response, signal: AbortSignal, abortError: () => BambuProviderError): Promise<unknown> {
  const length = response.headers.get('content-length')
  if (length !== null && (/^\d+$/.test(length) && Number(length) > BAMBU_MAX_PAYLOAD_BYTES)) {
    cancelBody(response)
    throw new BambuProviderError('response_too_large')
  }
  if (!response.body) throw new BambuProviderError('invalid_response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { value, done } = await abortable(reader.read(), signal, abortError)
      if (done) break
      bytes += value.byteLength
      if (bytes > BAMBU_MAX_PAYLOAD_BYTES) throw new BambuProviderError('response_too_large')
      chunks.push(value)
    }
    let payload: unknown
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes))
      payload = JSON.parse(decoded)
    } catch { throw new BambuProviderError('invalid_response') }
    assertBoundedBambuPayload(payload)
    return payload
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function mqttAuthenticationFailure(error: unknown): boolean {
  if (!isBambuObject(error)) return false
  return [error.code, error.reasonCode].some(value => value === 4 || value === 5 || value === 134 || value === 135)
}

export function createBambuProvider(config: BambuProviderConfig, options: BambuProviderOptions = {}): BambuProvider {
  if (!config || !Object.hasOwn(endpoints, config.region) || typeof config.accessToken !== 'string'
    || !config.accessToken.length || config.accessToken.length > 16_384 || /[^\x21-\x7e]/.test(config.accessToken)) {
    throw new BambuProviderError('invalid_configuration')
  }
  let token = config.accessToken
  const region = config.region
  const endpoint = endpoints[region]
  const expiresAt = advisoryExpiry(token)
  const expiresMs = expiresAt === null ? null : Date.parse(expiresAt)
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random
  const jitter = (base: number, max = 60_000) => {
    const value = random()
    return Math.min(max, Math.round(base * (0.8 + 0.4 * (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5))))
  }
  const transport = options.fetch ? null : createBambuHttpsTransport()
  const fetchImpl = options.fetch ?? transport!.fetch
  const mqttConnect = options.mqttConnect ?? ((mqttOptions: BambuMqttOptions) => connect(mqttOptions))
  const lifetime = new AbortController()
  let closed = false
  let terminal: BambuProviderError | null = null
  let closing: Promise<void> | null = null
  let expiryTimer: ReturnType<typeof setTimeout> | null = null
  let queued = 0
  let queueTail = Promise.resolve()
  let nextRequestAt = 0
  let cooldownUntil = 0
  let cooldownCode: BambuProviderErrorCode = 'rate_limited'
  let cooldownStatus = 429
  let accountId: string | null = null
  let printers = new Set<string>()
  const subscriptions = new Set<{ close(): Promise<void>; expire(error: BambuProviderError): void }>()

  const expire = (error: BambuProviderError) => {
    if (closed || terminal) return
    terminal = error
    lifetime.abort()
    token = ''
    if (expiryTimer) clearTimeout(expiryTimer)
    transport?.close()
    for (const subscription of subscriptions) subscription.expire(error)
  }
  const available = () => {
    if (closed) throw new BambuProviderError('provider_closed')
    if (!terminal && expiresMs !== null && expiresMs <= now()) expire(new BambuProviderError('credential_expired'))
    if (terminal) throw safeError(terminal, 'credential_expired')
  }
  const armExpiry = () => {
    if (closed || terminal || expiresMs === null) return
    const remaining = expiresMs - now()
    if (remaining <= 0) expire(new BambuProviderError('credential_expired'))
    else {
      expiryTimer = setTimeout(armExpiry, Math.min(remaining, 2_147_483_647))
      expiryTimer.unref?.()
    }
  }
  armExpiry()
  const sanitized = <T>(dto: T): T => {
    available()
    if (token && JSON.stringify(dto).includes(token)) throw new BambuProviderError('invalid_response')
    return dto
  }

  const requestJson = async (path: string, query: Record<string, string>, callerSignal?: AbortSignal): Promise<unknown> => {
    available()
    if (callerSignal?.aborted) throw new BambuProviderError('request_aborted')
    if (queued >= HTTP_MAX_QUEUED) throw new BambuProviderError('queue_full', HTTP_SPACING_MS)
    const budget = new AbortController()
    const deadline = now() + HTTP_BUDGET_MS
    const timer = setTimeout(() => budget.abort(), HTTP_BUDGET_MS)
    const signal = AbortSignal.any([lifetime.signal, budget.signal, ...(callerSignal ? [callerSignal] : [])])
    const abortError = () => terminal ? safeError(terminal, 'credential_expired')
      : new BambuProviderError(closed ? 'provider_closed' : callerSignal?.aborted ? 'request_aborted' : 'http_timeout')
    const url = new URL(path, endpoint.rest)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    queued++
    const work = queueTail.then(async () => {
      let last: BambuProviderError | null = null
      for (let attempt = 0; attempt < 3; attempt++) {
        available()
        if (signal.aborted) throw abortError()
        const delay = Math.max(nextRequestAt, cooldownUntil) - now()
        if (cooldownUntil >= deadline) throw new BambuProviderError(cooldownCode, cooldownUntil - now(), cooldownStatus)
        if (delay > 0) await sleep(delay, signal, abortError)
        if (signal.aborted) throw abortError()
        nextRequestAt = now() + HTTP_SPACING_MS
        try {
          const pendingResponse = fetchImpl(url.href, {
            method: 'GET', redirect: 'manual', signal,
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Accept-Encoding': 'identity' },
          }).then(response => {
            if (signal.aborted) { cancelBody(response); throw abortError() }
            return response
          })
          const response = await abortable(pendingResponse, signal, abortError)
          const status = response.status
          if (response.redirected || status === 0 || (status >= 300 && status < 400)) {
            cancelBody(response)
            throw new BambuProviderError('redirect_rejected', null, status)
          }
          if (status === 401 || status === 403) {
            cancelBody(response)
            const error = new BambuProviderError('credential_rejected', null, status)
            expire(error)
            throw error
          }
          if (status !== 200) {
            const retry = retryAfter(response.headers.get('retry-after'), now())
            cancelBody(response)
            const transient = [408, 425, 429, 500, 502, 503, 504].includes(status)
            if (transient && (retry !== null || status === 429)) {
              const until = now() + (retry ?? HTTP_SPACING_MS)
              if (until >= cooldownUntil) {
                cooldownUntil = until
                cooldownCode = status === 429 ? 'rate_limited' : 'cloud_unavailable'
                cooldownStatus = status
              }
            }
            throw new BambuProviderError(status === 429 ? 'rate_limited' : transient ? 'cloud_unavailable' : 'cloud_rejected', retry, status)
          }
          const payload = await readJson(response, signal, abortError)
          if (isBambuObject(payload)) {
            if (payload.code === 401 || payload.code === 403 || payload.code === '401' || payload.code === '403') {
              const error = new BambuProviderError('credential_rejected', null, Number(payload.code))
              expire(error)
              throw error
            }
            if ((payload.code != null && payload.code !== 0 && payload.code !== '0')
              || (payload.error != null && payload.error !== '')) throw new BambuProviderError('cloud_rejected')
          }
          return payload
        } catch (error) {
          if (signal.aborted) throw abortError()
          last = safeError(error, 'network_unavailable')
          if (!['network_unavailable', 'rate_limited', 'cloud_unavailable'].includes(last.code) || attempt === 2) throw last
          const wait = Math.max(last.retryAfterMs ?? 0, jitter(1_000 * 2 ** attempt))
          if (wait >= deadline - now()) throw new BambuProviderError(last.code, wait, last.status)
          await sleep(wait, signal, abortError)
        }
      }
      throw last ?? new BambuProviderError('cloud_unavailable')
    }).finally(() => { queued-- })
    queueTail = work.then(() => {}, () => {})
    try { return await abortable(work, signal, abortError) } finally { clearTimeout(timer) }
  }

  const discover = async (signal?: AbortSignal): Promise<ElementAccount> => {
    const preference = await requestJson('/v1/design-user-service/my/preference', {}, signal)
    const binding = await requestJson('/v1/iot-service/api/user/bind', {}, signal)
    const account = sanitized(normalizeBambuAccount(preference, binding, region))
    accountId = account.accountId
    printers = new Set(account.printers.map(printer => printer.id))
    return account
  }

  const history = async (printerId: string, cursor: string | null, limit: number, signal?: AbortSignal): Promise<ElementHistoryPage> => {
    available()
    if (!bambuIdentifier(printerId, 'printer') || (cursor !== null && historyOffset(cursor) === null)) {
      throw new BambuProviderError('invalid_identifier')
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > BAMBU_MAX_HISTORY_LIMIT) throw new BambuProviderError('invalid_request')
    if (accountId !== null && !printers.has(printerId)) throw new BambuProviderError('printer_not_bound')
    // Offset paging: Bambu ignores `after`/`before` (see historyOffset).
    const query: Record<string, string> = { deviceId: printerId, limit: String(limit) }
    if (cursor !== null) query.offset = cursor
    const payload = await requestJson('/v1/user-service/my/tasks', query, signal)
    return sanitized(normalizeBambuHistory(payload, printerId, cursor, limit, now()))
  }

  const subscribe = async (
    selectedAccountId: string, printerId: string, callbacks: BambuSubscriptionCallbacks,
  ): Promise<BambuSubscription> => {
    available()
    if (!bambuIdentifier(selectedAccountId, 'account') || !bambuIdentifier(printerId, 'printer')) {
      throw new BambuProviderError('invalid_identifier')
    }
    if (accountId === null) await discover()
    available()
    if (selectedAccountId !== accountId) throw new BambuProviderError('account_mismatch')
    if (!printers.has(printerId)) throw new BambuProviderError('printer_not_bound')
    if (subscriptions.size >= MAX_SUBSCRIPTIONS) throw new BambuProviderError('subscription_limit')
    const topic = `device/${printerId}/report`
    let stopped = false
    let established = false
    let generation = 0
    let failures = 0
    let connectedAt = 0
    let current: BambuMqttClient | null = null
    let connectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let snapshot: ElementSnapshot | null = null
    let reportTime: number | null = null
    let reportProblem = false
    let closePromise: Promise<void> | null = null
    const disposals = new Set<Promise<void>>()
    let resolveInitial: (subscription: BambuSubscription) => void = () => {}
    let rejectInitial: (error: BambuProviderError) => void = () => {}
    const ready = new Promise<BambuSubscription>((resolve, reject) => { resolveInitial = resolve; rejectInitial = reject })
    const emitState = (state: Parameters<BambuSubscriptionCallbacks['onState']>[0], error: BambuProviderError | null) => {
      if (stopped || closed) return
      try { callbacks.onState(state, error ? { code: error.code, message: error.message } : null) } catch { /* Consumer errors must not escape the transport. */ }
    }
    const dispose = (client: BambuMqttClient): Promise<void> => {
      const pending = new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, MQTT_CLOSE_MS)
        const finish = () => { clearTimeout(timeout); resolve() }
        try { client.end(true, {}, finish) } catch { finish() }
      })
      disposals.add(pending)
      void pending.then(() => disposals.delete(pending))
      return pending
    }
    const stop = (): Promise<void> => {
      if (closePromise) return closePromise
      stopped = true
      generation++
      if (connectTimer) clearTimeout(connectTimer)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      subscriptions.delete(internal)
      if (current) { void dispose(current); current = null }
      snapshot = null
      rejectInitial(terminal ?? new BambuProviderError('provider_closed'))
      closePromise = Promise.allSettled([...disposals]).then(() => {})
      return closePromise
    }
    const publicSubscription: BambuSubscription = { close: stop }
    const internal = {
      close: stop,
      expire(error: BambuProviderError) { emitState('expired', error); rejectInitial(error); void stop() },
    }
    subscriptions.add(internal)
    const scheduleReconnect = () => {
      if (stopped || closed || terminal) return
      const wait = jitter(1_000 * 2 ** Math.min(failures++, 6))
      reconnectTimer = setTimeout(begin, wait)
      reconnectTimer.unref?.()
    }
    const begin = () => {
      if (stopped || closed) return
      try { available() } catch (error) { internal.expire(safeError(error, 'credential_expired')); return }
      const version = ++generation
      snapshot = null
      reportProblem = false
      let subscribed = false
      let subscribing = false
      emitState('connecting', null)
      if (stopped || closed || terminal) return
      const fail = (error: BambuProviderError) => {
        if (stopped || version !== generation) return
        generation++
        if (connectTimer) clearTimeout(connectTimer)
        if (current) { void dispose(current); current = null }
        if (error.code === 'credential_rejected' || error.code === 'credential_expired') {
          expire(error)
          return
        }
        if (!established) {
          emitState('error', error)
          rejectInitial(error)
          void stop()
        } else {
          if (subscribed && now() - connectedAt >= 60_000) failures = 0
          emitState('offline', error)
          scheduleReconnect()
        }
      }
      let client: BambuMqttClient
      try {
        client = mqttConnect({
          protocol: 'mqtts', host: endpoint.mqtt, port: 8883, servername: endpoint.mqtt,
          rejectUnauthorized: true, checkServerIdentity, minVersion: 'TLSv1.2',
          username: `u_${selectedAccountId}`, password: token,
          clientId: `element_${randomUUID().replaceAll('-', '')}`,
          protocolVersion: 4, clean: true, keepalive: 30, connectTimeout: MQTT_CONNECT_MS,
          reconnectPeriod: 0, reconnectOnConnackError: false, resubscribe: false, queueQoSZero: false,
          log: () => {},
        })
      } catch (error) {
        fail(new BambuProviderError(mqttAuthenticationFailure(error) ? 'credential_rejected' : 'mqtt_unavailable'))
        return
      }
      current = client
      const active = () => !stopped && !closed && version === generation && current === client
      connectTimer = setTimeout(() => fail(new BambuProviderError('mqtt_connect_timeout')), MQTT_CONNECT_MS)
      client.on('error', error => {
        if (active()) fail(new BambuProviderError(mqttAuthenticationFailure(error) ? 'credential_rejected' : 'mqtt_unavailable'))
      })
      client.on('close', () => { if (active()) fail(new BambuProviderError('mqtt_unavailable')) })
      client.on('offline', () => { if (active()) fail(new BambuProviderError('mqtt_unavailable')) })
      client.on('disconnect', packet => {
        if (active()) fail(new BambuProviderError(mqttAuthenticationFailure(packet) ? 'credential_rejected' : 'mqtt_unavailable'))
      })
      client.on('connect', () => {
        if (!active() || subscribing) return
        subscribing = true
        try {
          client.subscribe(topic, { qos: 0 }, (error, granted) => {
            if (!active()) return
            if (error || granted?.length !== 1 || granted[0].topic !== topic || granted[0].qos !== 0) {
              fail(new BambuProviderError(mqttAuthenticationFailure(error) ? 'credential_rejected' : 'mqtt_subscribe_failed'))
              return
            }
            if (connectTimer) clearTimeout(connectTimer)
            subscribed = true
            connectedAt = now()
            established = true
            emitState('connected', null)
            resolveInitial(publicSubscription)
          })
        } catch (error) {
          fail(new BambuProviderError(mqttAuthenticationFailure(error) ? 'credential_rejected' : 'mqtt_subscribe_failed'))
        }
      })
      client.on('message', (incomingTopic, payload, packet) => {
        if (!active() || !subscribed || incomingTopic !== topic || packet?.retain || packet?.dup) return
        try {
          if (!(payload instanceof Uint8Array)) throw new BambuProviderError('mqtt_invalid_payload')
          if (payload.byteLength > BAMBU_MAX_PAYLOAD_BYTES) throw new BambuProviderError('mqtt_payload_too_large')
          let decoded: unknown
          try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)) } catch { throw new BambuProviderError('mqtt_invalid_payload') }
          assertBoundedBambuPayload(decoded, 'mqtt_invalid_payload')
          const timestamp = bambuReportTime(decoded)
          const received = now()
          if (timestamp !== null && (timestamp < received - MAX_REPORT_AGE_MS || timestamp > received + 30_000
            || (reportTime !== null && timestamp < reportTime))) throw new BambuProviderError('mqtt_stale_report')
          const effectiveTime = new Date(Math.min(received, timestamp ?? received)).toISOString()
          const next = mergeBambuSnapshot(decoded, snapshot, effectiveTime)
          if (!next) return
          snapshot = sanitized(next)
          if (timestamp !== null) reportTime = timestamp
          if (reportProblem) { reportProblem = false; emitState('connected', null) }
          try { callbacks.onSnapshot(structuredClone(snapshot)) } catch { /* Consumer errors are not upstream errors. */ }
        } catch (error) {
          reportProblem = true
          const problem = safeError(error, 'mqtt_invalid_payload')
          emitState('error', problem.code === 'invalid_response' ? new BambuProviderError('mqtt_invalid_payload') : problem)
        }
      })
    }
    begin()
    return ready
  }

  return {
    expiresAt, discover, history, subscribe,
    close() {
      if (closing) return closing
      closed = true
      lifetime.abort()
      if (expiryTimer) clearTimeout(expiryTimer)
      transport?.close()
      token = ''
      printers.clear()
      accountId = null
      const pending = [...subscriptions].map(subscription => subscription.close())
      closing = Promise.allSettled([...pending, queueTail]).then(() => {})
      return closing
    },
  }
}
