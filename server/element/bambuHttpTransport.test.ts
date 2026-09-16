import { EventEmitter } from 'node:events'
import { request } from 'node:https'
import type * as HttpsModule from 'node:https'
import type { RequestOptions } from 'node:https'
import type { ClientRequest, IncomingMessage } from 'node:http'
import { PassThrough } from 'node:stream'
import { checkServerIdentity } from 'node:tls'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBambuHttpsTransport } from './bambuHttpTransport.ts'
import { createBambuProvider } from './provider.ts'

vi.mock('node:https', async importOriginal => {
  const original = await importOriginal<typeof HttpsModule>()
  return { ...original, request: vi.fn() }
})

beforeEach(() => { vi.mocked(request).mockReset() })

function reply(body: string, status = 200, headers: Record<string, string> = {}) {
  vi.mocked(request).mockImplementation(((_url: unknown, _options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const outgoing = new EventEmitter() as ClientRequest
    outgoing.end = (() => {
      const stream = Object.assign(new PassThrough(), {
        statusCode: status,
        headers: { 'content-type': 'application/json', ...headers },
      })
      callback(stream as unknown as IncomingMessage)
      stream.end(body)
      return outgoing
    }) as ClientRequest['end']
    return outgoing
  }) as typeof request)
}

describe('default HTTPS transport with an injected native request mock', () => {
  it('enforces CA and hostname validation, one socket and GET without relying on global fetch TLS settings', async () => {
    reply('{"hits":[]}')
    const provider = createBambuProvider({ accessToken: 'test-token', region: 'global' })
    try {
      await expect(provider.history('SERIAL123', null, 20)).resolves.toEqual({ jobs: [], total: null, nextCursor: null })
      expect(request).toHaveBeenCalledTimes(1)
      const options = vi.mocked(request).mock.calls[0][1] as RequestOptions
      expect(options).toMatchObject({
        method: 'GET', rejectUnauthorized: true, checkServerIdentity, servername: 'api.bambulab.com',
        minVersion: 'TLSv1.2', maxHeaderSize: 16_384, headers: { Authorization: 'Bearer test-token' },
      })
      expect(options.agent).toMatchObject({
        maxSockets: 1, maxTotalSockets: 1, maxFreeSockets: 1,
        options: { rejectUnauthorized: true, checkServerIdentity, minVersion: 'TLSv1.2' },
      })
    } finally { await provider.close() }
  })

  it('does not follow redirects or return server error bodies or unrelated headers', async () => {
    const credential = 'must-not-return'
    reply(credential, 302, { location: `https://elsewhere.invalid/?token=${credential}`, 'set-cookie': credential, 'retry-after': '60' })
    const transport = createBambuHttpsTransport()
    try {
      const result = await transport.fetch('https://api.bambulab.cn/v1/user-service/my/tasks', {
        method: 'GET', redirect: 'manual', headers: { Authorization: 'Bearer dummy' }, signal: new AbortController().signal,
      })
      expect(result.status).toBe(302)
      expect(await result.text()).toBe('')
      const headers: Record<string, string> = {}
      result.headers.forEach((value, key) => { headers[key] = value })
      expect(headers).toEqual({ 'content-type': 'application/json', 'retry-after': '60' })
      expect(request).toHaveBeenCalledTimes(1)
    } finally { transport.close() }
  })

  it.each([
    'http://api.bambulab.com/v1/user-service/my/tasks',
    'https://evil.invalid/v1/user-service/my/tasks',
    'https://api.bambulab.com:8443/v1/user-service/my/tasks',
    'https://user:secret@api.bambulab.com/v1/user-service/my/tasks',
    'https://api.bambulab.com/v1/iot-service/api/user/print',
    'https://api.bambulab.com/v1/user-service/my/tasks?token=must-not-send',
    'not a URL with secret data',
  ])('refuses an unallowlisted transport URL before socket creation', async url => {
    const transport = createBambuHttpsTransport()
    try {
      await expect(transport.fetch(url, {
        method: 'GET', redirect: 'manual', headers: {}, signal: new AbortController().signal,
      })).rejects.toMatchObject({ code: 'invalid_request' })
      expect(request).not.toHaveBeenCalled()
    } finally { transport.close() }
  })

  it('drops native transport exception details rather than attaching a cause', async () => {
    const outgoing = new EventEmitter() as ClientRequest
    outgoing.end = (() => {
      outgoing.emit('error', new Error('secret URL https://api.bambulab.com/?token=do-not-echo'))
      return outgoing
    }) as ClientRequest['end']
    vi.mocked(request).mockReturnValue(outgoing)
    const transport = createBambuHttpsTransport()
    try {
      const error = await transport.fetch('https://api.bambulab.com/v1/user-service/my/tasks', {
        method: 'GET', redirect: 'manual', headers: {}, signal: new AbortController().signal,
      }).catch(error => error)
      expect(error).toMatchObject({ code: 'network_unavailable' })
      expect(error.cause).toBeUndefined()
      expect(String(error)).not.toMatch(/do-not-echo|https/)
    } finally { transport.close() }
  })
})
