// End to end against a real in-process ShapePilot server: organize a fixture
// library, sync it, edit in the app, pull the edit back into model.json, and
// drive the local helper the way the web app does.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixture } from './helpers.js'
import { ScanCache } from '../src/scan.js'
import { applySavedPlan, runSync } from '../src/run.js'
import { createHelper } from '../src/helper.js'
import { modelIndex } from '../src/models.js'
import { startTestServer, stubVerifier, validClaims } from '../../../test/helpers/server.ts'
import { createFilesystemAssetStore } from '../../../lib/assets/assetStore.ts'

const assetRoot = mkdtempSync(join(tmpdir(), 'shapepilot-library-sync-'))
const bearer = 'owner'
let server
let base

before(async () => {
  server = await startTestServer({
    label: 'library-scanner',
    verifier: stubVerifier({ [bearer]: validClaims() }),
    assetStore: createFilesystemAssetStore(assetRoot),
  })
  base = server.baseUrl
})

after(async () => {
  await server.close()
  rmSync(assetRoot, { recursive: true, force: true })
})

const app = (path, init = {}) =>
  fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', ...init.headers },
  }).then((r) => r.json())

test('organize, sync, edit in the app, and pull the edit back to disk', async () => {
  const { lib, config } = fixture()
  const { token } = await app('/api/library/devices', { method: 'POST', body: JSON.stringify({ name: 'Test Mac' }) })
  Object.assign(config, { serverUrl: base, deviceToken: token })
  const cache = new ScanCache(config.cacheDir)

  // First sync: nothing organized yet, but the plan is visible in the app.
  const first = await runSync(config, { cache })
  assert.equal(first.models, 0)
  assert.ok(first.planModels > 5)
  assert.ok(first.thumbsUploaded > 0, 'plan thumbnails are uploaded before anything is organized')
  const plan = await app('/api/library/plan')
  assert.equal(plan.models.length, first.planModels)
  assert.ok(plan.models.every((m) => !m.dest || !m.dest.startsWith('/')), 'destinations are library-relative')

  // Approve everything, then sync again.
  const applied = applySavedPlan(config, plan.models.map((m) => m.id))
  assert.ok(applied.results.every((r) => r.ok))
  const second = await runSync(config, { cache })
  assert.equal(second.planModels, 0)
  assert.equal(second.thumbsUploaded, 0, 'already-uploaded thumbnails are not sent again')

  const list = await app('/api/library/models?sort=title')
  const titles = list.items.map((m) => m.title)
  assert.ok(titles.includes('Systainer Latch'))
  const latch = list.items.find((m) => m.title === 'Systainer Latch')
  assert.equal(latch.category, 'Festool')
  assert.equal(latch.status, 'printed')
  assert.ok(latch.thumbHash)
  const thumb = await fetch(`${base}/api/library/thumbs/${latch.thumbHash}`, { headers: { Authorization: `Bearer ${bearer}` } })
  assert.equal(thumb.headers.get('content-type'), 'image/png')

  // Edit in the app, sync, and the edit lands in model.json.
  await app(`/api/library/models/${latch.id}`, { method: 'PUT', body: JSON.stringify({ tags: ['sys3'], notes: 'Print with brim' }) })
  const third = await runSync(config, { cache })
  assert.equal(third.edits, 1)
  const onDisk = JSON.parse(readFileSync(join(lib, 'Festool', 'Systainer Latch', 'model.json'), 'utf8'))
  assert.deepEqual(onDisk.tags, ['sys3'])
  assert.equal(onDisk.notes, 'Print with brim')
  assert.equal(onDisk.workshopVersion, 1)
  const after = await app(`/api/library/models/${latch.id}`)
  assert.deepEqual(after.tags, ['sys3'])

  // Local helper: origin-gated, files models into categories, undo works.
  config.serverUrl = 'https://shapepilot.example'
  const helper = createHelper(config, { cache })
  await new Promise((resolve) => helper.listen(0, '127.0.0.1', resolve))
  const hbase = `http://127.0.0.1:${helper.address().port}`
  const call = (path, body, origin = 'https://shapepilot.example') =>
    fetch(`${hbase}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
  try {
    assert.equal((await call('/health', null, 'https://evil.example')).status, 403)
    const health = await (await call('/health')).json()
    assert.equal(health.ok, true)
    const pre = await call('/health', null)
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://shapepilot.example')

    const fooId = [...modelIndex(lib)].find(([, dir]) => dir.endsWith('foo bar'))[0]
    const filed = await (await call('/file', { modelId: fooId, category: 'Household', status: 'want' })).json()
    assert.equal(filed.dir, join('Household', 'foo bar'))
    assert.ok(existsSync(join(lib, 'Household', 'foo bar', 'Foo Bar.3mf')))
    const json = JSON.parse(readFileSync(join(lib, 'Household', 'foo bar', 'model.json'), 'utf8'))
    assert.equal(json.category, 'Household')
    assert.equal(json.status, 'want')

    const bytes = await call(`/file?modelId=${fooId}&relPath=${encodeURIComponent('Household/foo bar/Foo Bar.3mf')}`)
    assert.equal(bytes.status, 200)
    assert.equal((await call(`/file?modelId=${fooId}&relPath=${encodeURIComponent('../../etc/passwd')}`)).status, 404)

    const undone = await (await call('/undo', { batch: filed.batch })).json()
    assert.ok(undone.reversed >= 2)
    assert.ok(existsSync(join(lib, '_Inbox', 'foo bar', 'Foo Bar.3mf')))

    // Category management goes through the helper too.
    const cats = await (await call('/categories')).json()
    assert.ok(cats.details.some((c) => c.name === 'Festool' && c.models > 0))
    const renamed = await call('/categories/rename', { from: 'Festool', to: 'Festool Systainer' })
    assert.equal(renamed.status, 200)
    const moved = JSON.parse(readFileSync(join(lib, 'Festool Systainer', 'Systainer Latch', 'model.json'), 'utf8'))
    assert.equal(moved.category, 'Festool Systainer')
    const refused = await call('/categories/rename', { from: '_Inbox', to: 'Inbox' })
    assert.equal(refused.status, 400)
    assert.match((await refused.json()).error, /managed by the organizer/)
  } finally {
    helper.close()
  }
})
