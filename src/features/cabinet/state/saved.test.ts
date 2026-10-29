// @vitest-environment jsdom
import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import { DEFAULT_CABINET_SETTINGS } from './params.ts'

const server = new Map<string, Record<string, unknown>>()

vi.mock('../../../services/http.ts', () => ({
  apiRequest: async (path: string, opts: { method?: string; body?: { name: string; params: Record<string, unknown> } } = {}) => {
    if (opts.method === 'PUT') { server.set(opts.body!.name, opts.body!.params); return { ok: true } }
    if (opts.method === 'DELETE') {
      server.delete(new URL(path, 'http://x').searchParams.get('name')!)
      return { ok: true }
    }
    return [...server].map(([name, params]) => ({ name, params, updatedAt: '' }))
  },
}))

const { deleteCabinet, listCabinets, saveCabinet } = await import('./saved.ts')

beforeEach(() => { server.clear(); localStorage.clear() })

test('a saved cabinet comes back under its name, label included', async () => {
  await saveCabinet('Left wall', { ...DEFAULT_CABINET_SETTINGS, trayCount: 7 })
  const [back] = await listCabinets(DEFAULT_CABINET_SETTINGS)
  assert.equal(back.name, 'Left wall')
  assert.equal(back.settings.trayCount, 7)
  assert.equal(back.settings.label, 'Left wall')
})

test('a deleted cabinet is gone', async () => {
  await saveCabinet('a', DEFAULT_CABINET_SETTINGS)
  await saveCabinet('b', DEFAULT_CABINET_SETTINGS)
  await deleteCabinet('a')
  assert.deepEqual((await listCabinets(DEFAULT_CABINET_SETTINGS)).map(c => c.name), ['b'])
})

test('cabinets kept in this browser are uploaded once, then cleared', async () => {
  localStorage.setItem('shapepilot:cabinet:saved',
    JSON.stringify({ Old: { ...DEFAULT_CABINET_SETTINGS, trayCount: 9 } }))
  const [old] = await listCabinets(DEFAULT_CABINET_SETTINGS)
  assert.equal(old.name, 'Old')
  assert.equal(old.settings.trayCount, 9)
  assert.equal(localStorage.getItem('shapepilot:cabinet:saved'), null)
})
