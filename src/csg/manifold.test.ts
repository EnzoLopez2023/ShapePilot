// The kernel loader caches its promise so setup() runs once -- but it must not
// cache a failure. One dropped fetch (a deploy swapping the server mid-request)
// used to leave every build on the page failing until a reload.
import assert from 'node:assert/strict'
import { test, vi } from 'vitest'

test('a failed kernel load is retried, not remembered', async () => {
  let calls = 0
  vi.doMock('manifold-3d', () => ({
    default: async () => {
      calls++
      if (calls === 1) throw new Error('network dropped')
      return { setup: () => {} }
    },
  }))
  vi.resetModules()
  const { loadManifold } = await import('./manifold.ts')

  await assert.rejects(loadManifold(), /network dropped/)
  const kernel = await loadManifold()
  assert.ok(kernel, 'the second attempt should load')
  assert.equal(calls, 2)
  // And a success IS remembered: no third load.
  await loadManifold()
  assert.equal(calls, 2)
  vi.doUnmock('manifold-3d')
})
