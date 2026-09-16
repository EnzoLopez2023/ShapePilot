// Reorder reminders against a real database, with the push service faked.
//
// What is pinned is what makes a reminder trustworthy rather than noise: it is
// sent once when a colour comes to need reordering and not every ten minutes
// after, it re-arms once the colour recovers, it goes only to administrators,
// a delivery that reached nobody is retried, and a browser the push service
// says is gone is forgotten. Silence from the printer changes nothing.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test } from 'vitest'
import { createTempDatabase } from '../helpers/server.ts'
import type { TempDatabase } from '../helpers/server.ts'
import { syntheticElementConnection, syntheticElementSnapshot } from '../fixtures/elementStatistics.ts'
import {
  checkReorderAlerts, reorderPayload, scheduleReorderAlerts,
} from '../../server/notifications/reorderAlerts.ts'
import type {
  DeliveryResult, PushPayload, PushSender,
} from '../../server/notifications/reorderAlerts.ts'
import type { Owner, StoredPushSubscription } from '../../lib/db/repositories/contracts.ts'
import type { ElementAmsSlot } from '../../lib/contracts/elementStatistics.ts'
import { stockOf, amsStockOf } from '../../lib/contracts/filamentStock.ts'

const ADMIN: Owner = { tenantId: 't', oid: 'admin' }
const USER: Owner = { tenantId: 't', oid: 'user' }
const COCOA = 'bambu-lab/pla/basic/cocoa-brown-10802'

const P256DH = Buffer.alloc(65, 4).toString('base64url')
const AUTH = Buffer.alloc(16, 7).toString('base64url')

/** Records what would have been pushed, and answers as told. */
class FakeSender implements PushSender {
  sent: { endpoint: string; payload: PushPayload }[] = []
  answer: DeliveryResult = 'sent'
  async send(subscription: StoredPushSubscription, payload: PushPayload) {
    this.sent.push({ endpoint: subscription.endpoint, payload })
    return this.answer
  }
}

const cocoaAt = (remainingPercent: number | null): ElementAmsSlot => ({
  amsId: '0', slotId: '0', material: 'PLA', subBrand: 'PLA Basic', color: '#6F5034FF',
  remainingPercent, empty: false,
})

describe('reorder reminders', () => {
  let temp: TempDatabase
  let sender: FakeSender

  const setAms = async (slots: ElementAmsSlot[] | null) => {
    await temp.repos.elementStatistics.recordSnapshot(syntheticElementConnection.id, {
      ...syntheticElementSnapshot, ams: slots,
    })
  }
  const own = (owner: Owner, quantity: number) =>
    temp.repos.filaments.replace(owner, quantity > 0 ? [{ key: COCOA, variant: 'spool', quantity }] : [])
  const run = () => checkReorderAlerts(temp.repos, sender)

  beforeEach(async () => {
    temp = createTempDatabase('reorder-alerts')
    sender = new FakeSender()
    const stats = temp.repos.elementStatistics
    await stats.saveConnection(syntheticElementConnection)
    await stats.saveSettings({ enabled: true, activeConnectionId: syntheticElementConnection.id, updatedAt: null })
    await temp.repos.memberships.ensure({ owner: ADMIN, initialRole: 'admin' })
    await temp.repos.memberships.ensure({ owner: USER, initialRole: 'user' })
    await temp.repos.push.subscribe(ADMIN, {
      endpoint: 'https://push.example.invalid/admin-laptop', keys: { p256dh: P256DH, auth: AUTH },
    })
  })

  afterEach(() => { temp.cleanup() })

  test('says nothing while the loaded spool is fine, or while the printer has said nothing', async () => {
    await own(ADMIN, 1)
    assert.deepEqual(await run(), { checked: 0, notified: 0 })
    await setAms([cocoaAt(55)])
    assert.deepEqual(await run(), { checked: 1, notified: 0 })
    assert.equal(sender.sent.length, 0)
  })

  test('tells an administrator once, and not again every run after', async () => {
    await own(ADMIN, 1)
    await setAms([cocoaAt(12)])
    assert.deepEqual(await run(), { checked: 1, notified: 1 })
    assert.equal(sender.sent.length, 1)
    assert.equal(sender.sent[0].payload.title, 'Reorder filament')
    assert.match(sender.sent[0].payload.body, /PLA Basic · Cocoa Brown 10802 — 12% left in AMS 1 · slot 1/)
    assert.equal(sender.sent[0].payload.url, '/filaments')

    await setAms([cocoaAt(9)])
    await run()
    await run()
    assert.equal(sender.sent.length, 1, 'a colour already reported is not reported again')
  })

  test('re-arms when a spare is added, and tells again when it runs low next time', async () => {
    await own(ADMIN, 1)
    await setAms([cocoaAt(12)])
    await run()
    assert.deepEqual(await temp.repos.push.alertedKeys(ADMIN), [COCOA])

    await own(ADMIN, 2)
    await run()
    assert.deepEqual(await temp.repos.push.alertedKeys(ADMIN), [], 'a spare clears the alert')

    await own(ADMIN, 1)
    await run()
    assert.equal(sender.sent.length, 2, 'the spare used up, it is news again')
  })

  test('printer silence does not clear an alert', async () => {
    await own(ADMIN, 1)
    await setAms([cocoaAt(12)])
    await run()
    await setAms(null)
    await run()
    assert.deepEqual(await temp.repos.push.alertedKeys(ADMIN), [COCOA])
  })

  test('only administrators are told, whoever holds a subscription', async () => {
    await temp.repos.push.subscribe(USER, {
      endpoint: 'https://push.example.invalid/user-phone', keys: { p256dh: P256DH, auth: AUTH },
    })
    await own(USER, 1)
    await own(ADMIN, 3)
    await setAms([cocoaAt(12)])
    assert.deepEqual(await run(), { checked: 1, notified: 0 })
    assert.equal(sender.sent.length, 0, 'the admin has spares; the user is not eligible')
  })

  test('a delivery that reached nobody is not recorded, so the next run retries it', async () => {
    await own(ADMIN, 1)
    await setAms([cocoaAt(12)])
    sender.answer = 'failed'
    assert.deepEqual(await run(), { checked: 1, notified: 0 })
    assert.deepEqual(await temp.repos.push.alertedKeys(ADMIN), [])

    sender.answer = 'sent'
    assert.deepEqual(await run(), { checked: 1, notified: 1 })
  })

  test('a browser the push service says is gone is forgotten', async () => {
    await own(ADMIN, 1)
    await setAms([cocoaAt(12)])
    sender.answer = 'gone'
    await run()
    assert.deepEqual(await temp.repos.push.listForOwner(ADMIN), [])
    assert.deepEqual(await temp.repos.push.listOwners(), [])
  })

  test('a browser signed into by another account moves to that account', async () => {
    await temp.repos.push.subscribe(USER, {
      endpoint: 'https://push.example.invalid/admin-laptop', keys: { p256dh: P256DH, auth: AUTH },
    })
    assert.deepEqual(await temp.repos.push.listForOwner(ADMIN), [])
    assert.equal((await temp.repos.push.listForOwner(USER)).length, 1)
  })
})

describe('the reminder text', () => {
  test('lists several colours under one title', () => {
    const ams = amsStockOf({
      ...syntheticElementSnapshot,
      ams: [
        cocoaAt(12),
        { ...cocoaAt(4), slotId: '3', color: '#FFFFFFFF' },
      ],
    })
    const payload = reorderPayload(stockOf(ams, () => 0))
    assert.equal(payload.title, 'Reorder 2 filaments')
    assert.deepEqual(payload.body.split('\n'), [
      'PLA Basic · Jade White 10100 — 4% left in AMS 1 · slot 4',
      'PLA Basic · Cocoa Brown 10802 — 12% left in AMS 1 · slot 1',
      'No spare on the shelf.',
    ])
  })
})

describe('the schedule', () => {
  test('runs one check at a time, survives a failure, and waits for a run on close', async () => {
    let calls = 0
    let release: () => void = () => {}
    const errors: unknown[] = []
    const schedule = scheduleReorderAlerts(() => {
      calls += 1
      if (calls === 1) return Promise.reject(new Error('boom'))
      return new Promise<void>(resolve => { release = resolve })
    }, { intervalMs: 5, firstRunMs: 1, logger: (_message, error) => { errors.push(error) } })

    await new Promise(resolve => setTimeout(resolve, 40))
    // First run failed and was logged; the second is still in flight, so no third started.
    assert.equal(errors.length, 1)
    assert.equal(calls, 2)
    const closing = schedule.close()
    release()
    await closing
    const after = calls
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(calls, after, 'nothing runs after close')
  })
})
