import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { apiBlobRequest, apiRequest, setAccessTokenProvider } from './http.ts'

beforeEach(() => { setAccessTokenProvider(async () => null) })
afterEach(() => {
  setAccessTokenProvider(async () => null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

test('JSON and report downloads share same-origin authentication and typed errors', async () => {
  setAccessTokenProvider(async () => 'synthetic-entra-token')
  const fetcher = vi.fn(async () => new Response('id,title\r\n1,Synthetic\r\n', {
    headers: { 'content-type': 'text/csv' },
  }))
  vi.stubGlobal('fetch', fetcher)
  const blob = await apiBlobRequest('/admin/element-statistics/export/jobs.csv')
  expect(await blob.text()).toContain('Synthetic')
  expect(fetcher.mock.calls[0]).toMatchObject([
    '/api/admin/element-statistics/export/jobs.csv',
    { headers: { authorization: 'Bearer synthetic-entra-token' }, credentials: 'same-origin' },
  ])
  fetcher.mockImplementation(async () => new Response(JSON.stringify({
    error: { code: 'forbidden', message: 'Administrator access required.' },
  }), { status: 403 }))
  await expect(apiBlobRequest('/admin/element-statistics/report.html')).rejects.toMatchObject({
    status: 403, code: 'forbidden', message: 'Administrator access required.',
  })
})

test('JSON responses, request bodies and empty responses retain the existing contract', async () => {
  const fetcher = vi.fn(async () => new Response('{"saved":true}'))
  vi.stubGlobal('fetch', fetcher)
  expect(await apiRequest('/settings', { method: 'PUT', body: { test: true } })).toEqual({ saved: true })
  expect(fetcher.mock.calls[0]).toMatchObject([
    '/api/settings',
    { method: 'PUT', body: '{"test":true}', headers: { 'content-type': 'application/json' } },
  ])
  fetcher.mockImplementation(async () => new Response(null, { status: 204 }))
  expect(await apiRequest('/empty')).toBeNull()
})

test('the request budget includes token acquisition, not just fetch', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  setAccessTokenProvider(() => new Promise(() => {}))
  const result = expect(apiBlobRequest('/report', { timeoutMs: 50 })).rejects.toMatchObject({
    code: 'timeout', status: 0,
  })
  await vi.advanceTimersByTimeAsync(50)
  await result
  expect(fetcher).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

test('a failed token provider is normalized and always releases the timer', async () => {
  vi.useFakeTimers()
  setAccessTokenProvider(async () => { throw null })
  await expect(apiBlobRequest('/report')).rejects.toMatchObject({ code: 'network_error' })
  expect(vi.getTimerCount()).toBe(0)
})

test('already cancelled work neither acquires a token nor fetches', async () => {
  const token = vi.fn(async () => null)
  const fetcher = vi.fn()
  setAccessTokenProvider(token)
  vi.stubGlobal('fetch', fetcher)
  const controller = new AbortController()
  controller.abort()
  await expect(apiRequest('/report', { signal: controller.signal })).rejects.toMatchObject({ code: 'timeout' })
  expect(token).not.toHaveBeenCalled()
  expect(fetcher).not.toHaveBeenCalled()
})

test('cancellation propagates through downloads and removes the caller listener', async () => {
  const caller = new AbortController()
  const remove = vi.spyOn(caller.signal, 'removeEventListener')
  vi.stubGlobal('fetch', async (_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted.', 'AbortError')))
  }))
  const result = expect(apiBlobRequest('/report', { signal: caller.signal })).rejects.toMatchObject({ code: 'timeout' })
  await Promise.resolve()
  caller.abort()
  await result
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
})
