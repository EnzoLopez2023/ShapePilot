// The asset transfers carry raw bytes, so they cannot go through `apiRequest`
// and parse the typed error envelope themselves. What is pinned here is that
// they report the server's own reason: a house message like "could not upload
// the file" hides the only sentence that says what actually went wrong, which
// is exactly what a store outage in production looks like from a browser.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { fetchAsset, listAssets, uploadAsset } from './designAssets.ts'

const HASH = 'a'.repeat(64)

const respond = (status: number, body: unknown) => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  }))
}

afterEach(() => { vi.unstubAllGlobals() })

describe('design asset transfers', () => {
  test('an upload failure carries the server code and message', async () => {
    respond(503, {
      error: {
        code: 'asset_store_unavailable',
        message: 'the file store is not available; the design itself is unaffected',
      },
    })
    await expect(uploadAsset(HASH, new ArrayBuffer(8), 'set.jpg', 'jpeg')).rejects.toMatchObject({
      status: 503,
      code: 'asset_store_unavailable',
      message: 'the file store is not available; the design itself is unaffected',
    })
  })

  test('a rejected format says which formats are accepted', async () => {
    respond(400, {
      error: { code: 'bad_request', message: 'format must be one of: stl, obj, svg' },
    })
    await expect(uploadAsset(HASH, new ArrayBuffer(8), 'set.jpg', 'jpeg')).rejects.toMatchObject({
      status: 400,
      message: 'format must be one of: stl, obj, svg',
    })
  })

  test('a response with no typed envelope falls back to the status line', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>gateway</html>', { status: 502 }))
    await expect(listAssets()).rejects.toMatchObject({ status: 502, code: 'request_failed' })
  })

  test('a missing asset is still null rather than an error', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }))
    // Assets are not authoritative: absent bytes are an ordinary state, and the
    // 404 branch is checked before the error path.
    await expect(fetchAsset(HASH)).resolves.toBeNull()
  })
})
