// X2D maintenance routes: the profile, and the service log.
//
// The properties worth pinning are the ones the calendar leans on. The record
// is owner-scoped like everything else; the profile is a singleton that upserts
// rather than accumulating rows; the log is append-only, so logging the same
// job twice keeps both entries rather than replacing one; every task key is
// checked against the committed catalogue; and a delete only ever reaches the
// caller's own row.
//
// The service log is the one place in this app where losing a write is worse
// than showing a stale read -- a maintenance history with a silent hole in it
// is worse than no history -- so the write paths get most of the attention here.
import assert from 'node:assert/strict'
import { afterAll, beforeAll, describe, test } from 'vitest'
import {
  OTHER_OID, startTestServer, stubVerifier, validClaims,
} from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'
import { MAINTENANCE_TASKS } from '../../lib/contracts/x2dMaintenance.ts'

const OWNER_TOKEN = 'owner-token'
const OTHER_TOKEN = 'other-token'
const BASE = '/api/maintenance'

interface Profile {
  commissionedOn: string
  usageTier: string
  filamentWear: string
  rollsUsed: number
}

interface Event {
  id: number
  taskKey: string
  performedOn: string
  note: string | null
  createdAt: string
}

interface Record_ {
  profile: Profile | null
  events: Event[]
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: { field?: string } }
}

const PROFILE: Profile = {
  commissionedOn: '2026-09-04',
  usageTier: 'regular',
  filamentWear: 'standard',
  rollsUsed: 0,
}

// Real catalogue keys, so these tests break if the catalogue's shape changes
// out from under the routes rather than passing against invented ones.
const XY = MAINTENANCE_TASKS.find(task => task.key === 'xy-axes')!.key
const PLATE = MAINTENANCE_TASKS.find(task => task.key === 'pei-plate-clean')!.key

describe('X2D maintenance routes', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startTestServer({
      label: 'maintenance',
      verifier: stubVerifier({
        [OWNER_TOKEN]: validClaims(),
        [OTHER_TOKEN]: validClaims({ oid: OTHER_OID }),
      }),
    })
  })

  afterAll(async () => { await server.close() })

  const get = (token = OWNER_TOKEN) => server.fetchJson<Record_>(BASE, { token })

  const putProfile = <T = Profile>(body: unknown, token = OWNER_TOKEN) =>
    server.fetchJson<T>(`${BASE}/profile`, {
      method: 'PUT', token, body: JSON.stringify(body),
    })

  const postEvent = <T = Event>(body: unknown, token = OWNER_TOKEN) =>
    server.fetchJson<T>(`${BASE}/events`, {
      method: 'POST', token, body: JSON.stringify(body),
    })

  const removeEvent = <T = { ok: true }>(id: number | string, token = OWNER_TOKEN) =>
    server.fetchJson<T>(`${BASE}/events/${id}`, { method: 'DELETE', token })

  test('starts with no profile and no history', async () => {
    const before = await get()
    assert.equal(before.status, 200)
    // Null, not an invented default. A guessed commissioning date would put
    // every job on the calendar on a day nothing is actually due.
    assert.equal(before.body.profile, null)
    assert.deepEqual(before.body.events, [])
  })

  test('requires a token', async () => {
    // Called without the helpers, which default the token in.
    assert.equal((await server.fetchJson(BASE)).status, 401)
    assert.equal((await server.fetchJson(`${BASE}/profile`, {
      method: 'PUT', body: JSON.stringify(PROFILE),
    })).status, 401)
    assert.equal((await server.fetchJson(`${BASE}/events`, {
      method: 'POST', body: JSON.stringify({ taskKey: XY, performedOn: '2026-09-10' }),
    })).status, 401)
  })

  test('stores the profile and reads it back', async () => {
    const saved = await putProfile(PROFILE)
    assert.equal(saved.status, 200)
    assert.deepEqual(saved.body, PROFILE)
    assert.deepEqual((await get()).body.profile, PROFILE)
  })

  test('a second profile write replaces the first rather than adding a row', async () => {
    await putProfile({ ...PROFILE, usageTier: 'high', rollsUsed: 7 })
    const record = await get()
    assert.equal(record.body.profile?.usageTier, 'high')
    assert.equal(record.body.profile?.rollsUsed, 7)

    const rows = server.database.handle
      .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM maintenance_profile')
      .get()
    assert.equal(rows?.count, 1)

    await putProfile(PROFILE)
  })

  test('logs a service and returns it with an id', async () => {
    const logged = await postEvent({ taskKey: XY, performedOn: '2026-09-10', note: ' oiled ' })
    assert.equal(logged.status, 201)
    assert.equal(logged.body.taskKey, XY)
    assert.equal(logged.body.performedOn, '2026-09-10')
    // Trimmed on the way in, so the stored note has no accidental whitespace.
    assert.equal(logged.body.note, 'oiled')
    assert.ok(logged.body.id > 0)
  })

  test('an empty note is stored as no note at all', async () => {
    const logged = await postEvent({ taskKey: PLATE, performedOn: '2026-09-11', note: '   ' })
    assert.equal(logged.body.note, null)
    await removeEvent(logged.body.id)
  })

  test('the log is append-only: the same job twice keeps both entries', async () => {
    const first = await postEvent({ taskKey: PLATE, performedOn: '2026-09-06' })
    const second = await postEvent({ taskKey: PLATE, performedOn: '2026-09-13' })
    const events = (await get()).body.events.filter(event => event.taskKey === PLATE)
    assert.equal(events.length, 2)
    // Newest first, which is the order the page and the log both read in.
    assert.equal(events[0].performedOn, '2026-09-13')
    assert.equal(events[1].performedOn, '2026-09-06')
    await removeEvent(first.body.id)
    await removeEvent(second.body.id)
  })

  test('refuses a task that is not in the catalogue', async () => {
    const rejected = await postEvent<ErrorBody>({
      taskKey: 'polish-the-flux-capacitor', performedOn: '2026-09-10',
    })
    assert.equal(rejected.status, 400)
    assert.equal(rejected.body.error?.details?.field, 'taskKey')
  })

  test('refuses a service dated in the future', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    const rejected = await postEvent<ErrorBody>({ taskKey: XY, performedOn: tomorrow })
    assert.equal(rejected.status, 400)
    assert.equal(rejected.body.error?.details?.field, 'performedOn')
  })

  test('refuses a date that matches the pattern but is not a day', async () => {
    const rejected = await postEvent<ErrorBody>({ taskKey: XY, performedOn: '2026-02-31' })
    assert.equal(rejected.status, 400)
    assert.match(rejected.body.error?.message ?? '', /not a real calendar date/)
  })

  test('refuses an unknown field rather than silently dropping it', async () => {
    const rejected = await postEvent<ErrorBody>({
      taskKey: XY, performedOn: '2026-09-10', hoursSpent: 2,
    })
    assert.equal(rejected.status, 400)
    assert.equal(rejected.body.error?.details?.field, 'hoursSpent')
  })

  test('deletes only the caller\'s own entry', async () => {
    const mine = await postEvent({ taskKey: XY, performedOn: '2026-09-12' })

    // Another account cannot reach it, and is told "not found" rather than
    // "forbidden" -- which would confirm the row exists.
    const theirs = await removeEvent<ErrorBody>(mine.body.id, OTHER_TOKEN)
    assert.equal(theirs.status, 404)
    assert.ok((await get()).body.events.some(event => event.id === mine.body.id))

    const removed = await removeEvent(mine.body.id)
    assert.equal(removed.status, 200)
    assert.ok(!(await get()).body.events.some(event => event.id === mine.body.id))
  })

  test('deleting something already gone is a 404, not a 500', async () => {
    assert.equal((await removeEvent<ErrorBody>(999_999)).status, 404)
  })

  test('refuses an id that is not a positive whole number', async () => {
    for (const id of ['abc', '-1', '1.5']) {
      assert.equal((await removeEvent<ErrorBody>(id)).status, 400)
    }
  })

  test('one account cannot see or disturb another\'s record', async () => {
    await putProfile({ ...PROFILE, commissionedOn: '2025-01-02' }, OTHER_TOKEN)
    await postEvent({ taskKey: PLATE, performedOn: '2025-02-02' }, OTHER_TOKEN)

    const mine = await get()
    assert.equal(mine.body.profile?.commissionedOn, PROFILE.commissionedOn)
    assert.ok(!mine.body.events.some(event => event.performedOn === '2025-02-02'))

    const theirs = await get(OTHER_TOKEN)
    assert.equal(theirs.body.profile?.commissionedOn, '2025-01-02')
    assert.equal(theirs.body.events.length, 1)
  })

  test('every catalogue task is loggable', async () => {
    // The catalogue and the validator agree, for all twelve rather than the two
    // this suite otherwise exercises.
    for (const task of MAINTENANCE_TASKS) {
      const logged = await postEvent({ taskKey: task.key, performedOn: '2026-09-09' })
      assert.equal(logged.status, 201, `${task.key} should be loggable`)
      await removeEvent(logged.body.id)
    }
  })
})
