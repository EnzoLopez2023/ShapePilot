import { Agent, request } from 'node:https'
import { Readable } from 'node:stream'
import { checkServerIdentity } from 'node:tls'
import { BambuProviderError } from './bambuProviderErrors.ts'

export interface BambuFetchInit {
  method: 'GET'
  redirect: 'manual'
  headers: Record<string, string>
  signal: AbortSignal
}

export type BambuFetch = (url: string, init: BambuFetchInit) => Promise<Response>

export function createBambuHttpsTransport(): { fetch: BambuFetch; close(): void } {
  // Explicit TLS settings also protect against a process-wide insecure TLS default.
  const agent = new Agent({
    keepAlive: true, maxSockets: 1, maxTotalSockets: 1, maxFreeSockets: 1,
    rejectUnauthorized: true, checkServerIdentity, minVersion: 'TLSv1.2',
  })
  return {
    fetch: (url, init) => new Promise<Response>((resolve, reject) => {
      let parsed: URL
      try { parsed = new URL(url) } catch { reject(new BambuProviderError('invalid_request')); return }
      const allowedPaths = [
        '/v1/design-user-service/my/preference',
        '/v1/iot-service/api/user/bind',
        '/v1/user-service/my/tasks',
      ]
      if (parsed.protocol !== 'https:' || !['api.bambulab.com', 'api.bambulab.cn'].includes(parsed.hostname)
        || parsed.username || parsed.password || (parsed.port && parsed.port !== '443') || parsed.hash
        || !allowedPaths.includes(parsed.pathname)
        // History pages by `offset`; Bambu ignores `after`, so it is not sent.
        || [...parsed.searchParams.keys()].some(key => !['deviceId', 'offset', 'limit'].includes(key))) {
        reject(new BambuProviderError('invalid_request'))
        return
      }
      const outgoing = request(parsed, {
        method: 'GET', headers: init.headers, signal: init.signal, agent,
        rejectUnauthorized: true, checkServerIdentity, servername: parsed.hostname,
        minVersion: 'TLSv1.2', maxHeaderSize: 16_384,
      }, incoming => {
        const status = incoming.statusCode ?? 502
        const headers = new Headers()
        for (const name of ['content-type', 'content-length', 'retry-after']) {
          const value = incoming.headers[name]
          if (typeof value === 'string') headers.set(name, value)
        }
        if (status < 200 || status > 599) {
          incoming.destroy()
          reject(new BambuProviderError('cloud_rejected'))
        } else if (status !== 200) {
          incoming.destroy()
          resolve(new Response(null, { status, headers }))
        } else {
          resolve(new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, { status, headers }))
        }
      })
      outgoing.on('error', () => reject(new BambuProviderError('network_unavailable')))
      outgoing.end()
    }),
    close: () => agent.destroy(),
  }
}
