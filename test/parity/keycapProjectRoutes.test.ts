// Keycap project routes: one keycap set, its photos, and the trays cut for it.
//
// The properties worth pinning are the ones the feature leans on: a project is
// owner-scoped like everything else, its set items are replaced atomically,
// deleting it never destroys a tray, coverage is arithmetic over real pockets,
// and a photo can only be attached by an owner who already holds those bytes.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, test } from 'vitest'
import {
  OTHER_OID, startTestServer, stubVerifier, validClaims,
} from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'
import { createFilesystemAssetStore } from '../../lib/assets/assetStore.ts'

const OWNER_TOKEN = 'owner-token'
const OTHER_TOKEN = 'other-token'
const BASE = '/api/keycap-projects'
const TRAYS = '/api/keycap-trays'

const sizing = {
  pitch: 19.05, widthOffset: -0.45, height: 18.6, cornerRadius: 2, cornerSegments: 16,
}

const projectPayload = (over: Record<string, unknown> = {}) => ({
  name: 'GMK Olivia',
  setName: 'Olivia',
  manufacturer: 'GMK',
  capProfile: 'Cherry',
  colorway: 'grey and tan',
  items: [
    { legend: 'Esc', units: 1, count: 1, group: 'Modifiers', source: 'photo' },
    { units: 1, count: 34, group: 'Alphas' },
    { legend: 'Caps Lock', units: 1.75, count: 1, group: 'Modifiers' },
    { legend: 'Space', units: 6.25, count: 1, group: 'Modifiers' },
  ],
  ...over,
})

const trayPayload = (over: Record<string, unknown> = {}) => ({
  name: 'Tray one',
  profile: { kind: 'preset', id: 'systainer-s76-notched' },
  sizing,
  pockets: [
    { units: 1, x: 10, y: 10 },
    { units: 1, x: 30, y: 10 },
    { units: 6.25, x: 10, y: 40 },
  ],
  ...over,
})

interface Project {
  id: string
  name: string
  setName?: string
  capProfile?: string
  items: {
    id: string
    legend?: string
    units: number
    heightUnits: number
    count: number
    group?: string
    source: string
  }[]
  photos: { hash: string; caption?: string; createdAt: string }[]
  coverage: { units: number; heightUnits: number; shape: string | null; pockets: number }[]
  createdAt: string
  updatedAt: string
}

interface Summary {
  id: string
  name: string
  setName?: string
  capCount: number
  trayCount: number
  photoCount: number
}

interface TraySummary {
  id: string
  projectId: string | null
  projectName: string | null
  name: string
  pocketCount: number
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

const PHOTO = Buffer.from('not-really-a-jpeg-but-the-route-never-decodes-it')
const PHOTO_HASH = sha256(PHOTO)
const STL = Buffer.from('solid x\nendsolid\n')
const STL_HASH = sha256(STL)

describe('keycap project routes', () => {
  let server: TestServer
  let root: string

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'shapepilot-project-assets-'))
    server = await startTestServer({
      label: 'keycap-projects',
      verifier: stubVerifier({
        [OWNER_TOKEN]: validClaims(),
        [OTHER_TOKEN]: validClaims({ oid: OTHER_OID }),
      }),
      assetStore: createFilesystemAssetStore(root),
    })
  })

  afterAll(async () => {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  })

  const post = <T>(path: string, body: unknown, token = OWNER_TOKEN) =>
    server.fetchJson<T>(path, { method: 'POST', token, body: JSON.stringify(body) })

  const put = <T>(path: string, body: unknown, token = OWNER_TOKEN) =>
    server.fetchJson<T>(path, { method: 'PUT', token, body: JSON.stringify(body) })

  const get = <T>(path: string, token = OWNER_TOKEN) =>
    server.fetchJson<T>(path, { token })

  const del = <T>(path: string, token = OWNER_TOKEN) =>
    server.fetchJson<T>(path, { method: 'DELETE', token })

  const uploadPhoto = (bytes: Buffer, hash: string, format = 'jpeg', name = 'set.jpg') =>
    fetch(`${server.baseUrl}/api/design-assets/${hash}?filename=${name}&format=${format}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${OWNER_TOKEN}`,
        'content-type': 'application/octet-stream',
      },
      body: new Uint8Array(bytes),
    })

  test('a project round-trips with its set items in order', async () => {
    const created = await post<{ id: string }>(BASE, projectPayload())
    assert.equal(created.status, 201)

    const loaded = await get<Project>(`${BASE}/${created.body.id}`)
    assert.equal(loaded.status, 200)
    assert.equal(loaded.body.name, 'GMK Olivia')
    assert.equal(loaded.body.setName, 'Olivia')
    assert.equal(loaded.body.capProfile, 'Cherry')
    assert.deepEqual(loaded.body.items.map(i => i.legend ?? null),
      ['Esc', null, 'Caps Lock', 'Space'])
    assert.deepEqual(loaded.body.items.map(i => i.count), [1, 34, 1, 1])
    // Defaults are applied server-side, not assumed by the client.
    assert.equal(loaded.body.items[1].heightUnits, 1)
    assert.equal(loaded.body.items[1].source, 'manual')
    assert.equal(loaded.body.items[0].source, 'photo')
  })

  test('the list summarises caps, trays and photos', async () => {
    const created = await post<{ id: string }>(BASE, projectPayload({ name: 'Summary set' }))
    await post(TRAYS, trayPayload({ projectId: created.body.id }))

    const list = await get<Summary[]>(BASE)
    assert.equal(list.status, 200)
    const summary = list.body.find(p => p.id === created.body.id)
    assert.ok(summary)
    // 1 + 34 + 1 + 1: the sum of the counts, not the number of rows.
    assert.equal(summary.capCount, 37)
    assert.equal(summary.trayCount, 1)
    assert.equal(summary.photoCount, 0)
  })

  test('an empty set counts as zero caps rather than null', async () => {
    const created = await post<{ id: string }>(BASE, { name: 'Bare' })
    const list = await get<Summary[]>(BASE)
    assert.equal(list.body.find(p => p.id === created.body.id)?.capCount, 0)
  })

  test('updating replaces the whole set, and omitting items leaves it alone', async () => {
    const created = await post<{ id: string }>(BASE, projectPayload({ name: 'Replaceable' }))

    const replaced = await put(`${BASE}/${created.body.id}`, {
      name: 'Replaceable', items: [{ legend: 'Enter', units: 2.25, count: 1 }],
    })
    assert.equal(replaced.status, 200)
    let loaded = await get<Project>(`${BASE}/${created.body.id}`)
    assert.deepEqual(loaded.body.items.map(i => i.legend), ['Enter'])

    // No `items` key at all: the inventory survives a rename.
    await put(`${BASE}/${created.body.id}`, { name: 'Renamed' })
    loaded = await get<Project>(`${BASE}/${created.body.id}`)
    assert.equal(loaded.body.name, 'Renamed')
    assert.deepEqual(loaded.body.items.map(i => i.legend), ['Enter'])

    // An explicit empty array does clear it.
    await put(`${BASE}/${created.body.id}`, { name: 'Renamed', items: [] })
    loaded = await get<Project>(`${BASE}/${created.body.id}`)
    assert.deepEqual(loaded.body.items, [])
  })

  test('coverage counts the pockets across the project trays, by size', async () => {
    const created = await post<{ id: string }>(BASE, projectPayload({ name: 'Covered' }))
    await post(TRAYS, trayPayload({ projectId: created.body.id }))
    await post(TRAYS, trayPayload({
      name: 'Tray two',
      projectId: created.body.id,
      pockets: [{ units: 1, x: 10, y: 10 }, { units: 1.75, x: 40, y: 10 }],
    }))
    // A tray outside the project must not be counted.
    await post(TRAYS, trayPayload({ name: 'Loose tray' }))

    const loaded = await get<Project>(`${BASE}/${created.body.id}`)
    const byUnits = new Map(loaded.body.coverage.map(c => [c.units, c.pockets]))
    assert.equal(byUnits.get(1), 3)
    assert.equal(byUnits.get(1.75), 1)
    assert.equal(byUnits.get(6.25), 1)
  })

  test('one tray can be left out of the coverage count', async () => {
    // The designer holds the open tray's pockets in memory, unsaved edits
    // included. Counting the saved copy on top of them would double every
    // pocket on the tray being drawn.
    const created = await post<{ id: string }>(BASE, projectPayload({ name: 'Excludable' }))
    const first = await post<{ id: string }>(
      TRAYS, trayPayload({ name: 'One', projectId: created.body.id }))
    await post(TRAYS, trayPayload({
      name: 'Two',
      projectId: created.body.id,
      pockets: [{ units: 1, x: 10, y: 10 }],
    }))

    const all = await get<Project>(`${BASE}/${created.body.id}`)
    assert.equal(new Map(all.body.coverage.map(c => [c.units, c.pockets])).get(1), 3)

    const without = await get<Project>(`${BASE}/${created.body.id}?excludeTray=${first.body.id}`)
    const byUnits = new Map(without.body.coverage.map(c => [c.units, c.pockets]))
    assert.equal(byUnits.get(1), 1, 'only the second tray remains')
    assert.equal(byUnits.get(6.25), undefined, 'the excluded tray contributes nothing')

    // Everything else about the project is unchanged by the exclusion.
    assert.equal(without.body.items.length, all.body.items.length)
  })

  test('a malformed excludeTray is ignored rather than failing the read', async () => {
    // It only narrows a count. A bad value must not cost someone their project.
    const created = await post<{ id: string }>(BASE, projectPayload({ name: 'Tolerant' }))
    await post(TRAYS, trayPayload({ projectId: created.body.id }))
    const res = await get<Project>(`${BASE}/${created.body.id}?excludeTray=not-an-id`)
    assert.equal(res.status, 200)
    assert.equal(new Map(res.body.coverage.map(c => [c.units, c.pockets])).get(1), 2)
  })

  test('trays can be listed by project, and the unassigned ones on their own', async () => {
    const created = await post<{ id: string }>(BASE, projectPayload({ name: 'Filterable' }))
    const inProject = await post<{ id: string }>(
      TRAYS, trayPayload({ name: 'In project', projectId: created.body.id }))
    const loose = await post<{ id: string }>(TRAYS, trayPayload({ name: 'Not in a project' }))

    const mine = await get<TraySummary[]>(`${TRAYS}?projectId=${created.body.id}`)
    assert.deepEqual(mine.body.map(t => t.id), [inProject.body.id])
    assert.equal(mine.body[0].projectName, 'Filterable')

    const unassigned = await get<TraySummary[]>(`${TRAYS}?projectId=none`)
    assert.ok(unassigned.body.some(t => t.id === loose.body.id))
    assert.ok(!unassigned.body.some(t => t.id === inProject.body.id))
    assert.equal(unassigned.body.find(t => t.id === loose.body.id)?.projectName, null)
  })

  test('a tray can be cloned straight into another project', async () => {
    const source = await post<{ id: string }>(BASE, projectPayload({ name: 'Source set' }))
    const dest = await post<{ id: string }>(BASE, projectPayload({ name: 'Destination set' }))
    const tray = await post<{ id: string }>(
      TRAYS, trayPayload({ name: 'Top tray', projectId: source.body.id }))

    const cloned = await post<{ id: string }>(`${TRAYS}/${tray.body.id}/clone`, {
      name: 'Top tray (moved)', projectId: dest.body.id,
    })
    assert.equal(cloned.status, 201)

    const copy = await get<{ projectId: string | null; name: string; pockets: unknown[] }>(
      `${TRAYS}/${cloned.body.id}`)
    assert.equal(copy.body.projectId, dest.body.id)
    assert.equal(copy.body.name, 'Top tray (moved)')
    assert.equal(copy.body.pockets.length, 3)

    // The original is untouched, still in its own set.
    const original = await get<{ projectId: string | null }>(`${TRAYS}/${tray.body.id}`)
    assert.equal(original.body.projectId, source.body.id)

    // Absent projectId still keeps the copy in the source's project.
    const sameSet = await post<{ id: string }>(`${TRAYS}/${tray.body.id}/clone`, {})
    const sameCopy = await get<{ projectId: string | null }>(`${TRAYS}/${sameSet.body.id}`)
    assert.equal(sameCopy.body.projectId, source.body.id)
  })

  test('a clone cannot be dropped into a project the caller does not own', async () => {
    const theirs = await post<{ id: string }>(BASE, { name: 'Theirs' }, OTHER_TOKEN)
    const tray = await post<{ id: string }>(TRAYS, trayPayload({ name: 'Mine' }))

    const attempt = await post<{ error: { details?: { field?: string } } }>(
      `${TRAYS}/${tray.body.id}/clone`, { projectId: theirs.body.id })
    assert.equal(attempt.status, 400)
    assert.equal(attempt.body.error.details?.field, 'projectId')

    const missing = await post(`${TRAYS}/${tray.body.id}/clone`, { projectId: '999999' })
    assert.equal(missing.status, 400)
  })

  test('a tray can be linked and unlinked without disturbing its pockets', async () => {
    const created = await post<{ id: string }>(BASE, projectPayload({ name: 'Linkable' }))
    const tray = await post<{ id: string }>(TRAYS, trayPayload({ name: 'Movable' }))

    await put(`${TRAYS}/${tray.body.id}`,
      trayPayload({ name: 'Movable', projectId: created.body.id }))
    let loaded = await get<{ projectId: string | null; pockets: unknown[] }>(
      `${TRAYS}/${tray.body.id}`)
    assert.equal(loaded.body.projectId, created.body.id)
    assert.equal(loaded.body.pockets.length, 3)

    await put(`${TRAYS}/${tray.body.id}`, trayPayload({ name: 'Movable', projectId: null }))
    loaded = await get<{ projectId: string | null; pockets: unknown[] }>(`${TRAYS}/${tray.body.id}`)
    assert.equal(loaded.body.projectId, null)
  })

  test('a tray cannot be linked to a project the caller does not own', async () => {
    const theirs = await post<{ id: string }>(BASE, { name: 'Theirs' }, OTHER_TOKEN)
    const attempt = await post<{ error: { code: string; details?: { field?: string } } }>(
      TRAYS, trayPayload({ projectId: theirs.body.id }))
    assert.equal(attempt.status, 400)
    assert.equal(attempt.body.error.details?.field, 'projectId')

    const missing = await post(TRAYS, trayPayload({ projectId: '999999' }))
    assert.equal(missing.status, 400)
  })

  test('deleting a project cascades its set but leaves its trays, unassigned', async () => {
    const created = await post<{ id: string }>(BASE, projectPayload({ name: 'Doomed' }))
    const tray = await post<{ id: string }>(
      TRAYS, trayPayload({ name: 'Survivor', projectId: created.body.id }))

    const removed = await del(`${BASE}/${created.body.id}`)
    assert.equal(removed.status, 200)
    assert.equal((await get(`${BASE}/${created.body.id}`)).status, 404)

    const survivor = await get<{ projectId: string | null; pockets: unknown[] }>(
      `${TRAYS}/${tray.body.id}`)
    assert.equal(survivor.status, 200)
    assert.equal(survivor.body.projectId, null)
    assert.equal(survivor.body.pockets.length, 3)

    // The items are gone with the project rather than orphaned.
    const rows = server.database.handle
      .prepare('SELECT COUNT(*) AS n FROM keycap_set_items WHERE project_id = ?')
      .get(Number(created.body.id)) as { n: number }
    assert.equal(rows.n, 0)
  })

  test('a photo is attached by hash, once the owner holds those bytes', async () => {
    const created = await post<{ id: string }>(BASE, projectPayload({ name: 'Photographed' }))
    assert.equal((await uploadPhoto(PHOTO, PHOTO_HASH)).status, 201)

    const attached = await post(`${BASE}/${created.body.id}/photos`,
      { hash: PHOTO_HASH, caption: 'the base kit' })
    assert.equal(attached.status, 201)

    const loaded = await get<Project>(`${BASE}/${created.body.id}`)
    assert.equal(loaded.body.photos.length, 1)
    assert.equal(loaded.body.photos[0].hash, PHOTO_HASH)
    assert.equal(loaded.body.photos[0].caption, 'the base kit')

    // Re-attaching the same hash updates the caption instead of failing.
    await post(`${BASE}/${created.body.id}/photos`, { hash: PHOTO_HASH, caption: 'renamed' })
    const again = await get<Project>(`${BASE}/${created.body.id}`)
    assert.equal(again.body.photos.length, 1)
    assert.equal(again.body.photos[0].caption, 'renamed')

    const detached = await del(`${BASE}/${created.body.id}/photos/${PHOTO_HASH}`)
    assert.equal(detached.status, 200)
    assert.equal((await get<Project>(`${BASE}/${created.body.id}`)).body.photos.length, 0)
    // The bytes are untouched: the store is content-addressed and shared.
    const bytes = await fetch(`${server.baseUrl}/api/design-assets/${PHOTO_HASH}`, {
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
    })
    assert.equal(bytes.status, 200)
  })

  test('a photo hash must be an owned image', async () => {
    const created = await post<{ id: string }>(BASE, projectPayload({ name: 'Picky' }))

    const unknown = await post(`${BASE}/${created.body.id}/photos`, { hash: 'a'.repeat(64) })
    assert.equal(unknown.status, 404)

    assert.equal((await uploadPhoto(STL, STL_HASH, 'stl', 'part.stl')).status, 201)
    const geometry = await post<{ error: { message: string } }>(
      `${BASE}/${created.body.id}/photos`, { hash: STL_HASH })
    assert.equal(geometry.status, 400)
    assert.match(geometry.body.error.message, /not an image/)

    const malformed = await post(`${BASE}/${created.body.id}/photos`, { hash: 'nope' })
    assert.equal(malformed.status, 400)
  })

  test('one account cannot see, change or delete another account’s project', async () => {
    const mine = await post<{ id: string }>(BASE, projectPayload({ name: 'Private' }))

    assert.equal((await get(`${BASE}/${mine.body.id}`, OTHER_TOKEN)).status, 404)
    assert.equal((await put(`${BASE}/${mine.body.id}`, { name: 'Stolen' }, OTHER_TOKEN)).status, 404)
    assert.equal((await del(`${BASE}/${mine.body.id}`, OTHER_TOKEN)).status, 404)
    assert.equal(
      (await post(`${BASE}/${mine.body.id}/photos`, { hash: PHOTO_HASH }, OTHER_TOKEN)).status, 404)

    const theirList = await get<Summary[]>(BASE, OTHER_TOKEN)
    assert.ok(!theirList.body.some(p => p.id === mine.body.id))

    // Still intact and still ours.
    assert.equal((await get<Project>(`${BASE}/${mine.body.id}`)).body.name, 'Private')
  })

  test('the routes require authentication', async () => {
    assert.equal((await server.fetchJson(BASE)).status, 401)
    assert.equal((await server.fetchJson(BASE, {
      method: 'POST', body: JSON.stringify({ name: 'x' }),
    })).status, 401)
  })

  test('an unknown project is a typed 404', async () => {
    const missing = await get<{ error: { code: string; message: string } }>(`${BASE}/999999`)
    assert.equal(missing.status, 404)
    assert.equal(missing.body.error.code, 'not_found')
    assert.equal(missing.body.error.message, 'project not found')
  })
})
