// Web Push routes, with the push service faked.
//
// Pinned: the browser is told whether push exists and whether this account may
// use it; subscribing and test sends are administrator-only and refused with a
// clear 503 when the server has no signing key; a subscription is validated to
// the exact shape a browser produces; and anyone may take back their own.
import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'vitest'
import {
  OTHER_OID, TEST_OID, startTestServer, stubVerifier, validClaims,
} from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'
import type {
  DeliveryResult, PushPayload, PushSender,
} from '../../server/notifications/reorderAlerts.ts'
import type { StoredPushSubscription } from '../../lib/db/repositories/contracts.ts'

const ADMIN = 'admin-token'
const USER = 'user-token'
const BASE = '/api/notifications/push'
const PUBLIC_KEY = Buffer.alloc(65, 4).toString('base64url')
const PRIVATE_KEY = Buffer.alloc(32, 9).toString('base64url')

const subscription = (endpoint = 'https://fcm.googleapis.com/fcm/send/abc123') => ({
  endpoint,
  expirationTime: null,
  keys: {
    p256dh: Buffer.alloc(65, 4).toString('base64url'),
    auth: Buffer.alloc(16, 7).toString('base64url'),
  },
})

interface ErrorBody { error?: { code?: string; message?: string; details?: { field?: string } } }

class FakeSender implements PushSender {
  sent: { subscription: StoredPushSubscription; payload: PushPayload }[] = []
  async send(subscription: StoredPushSubscription, payload: PushPayload): Promise<DeliveryResult> {
    this.sent.push({ subscription, payload })
    return 'sent'
  }
}

describe('notification routes', () => {
  let server: TestServer | null = null
  afterEach(async () => { await server?.close(); server = null })

  const start = async (sender: PushSender | null) => {
    server = await startTestServer({
      label: 'notifications',
      env: sender
        ? {
          SHAPEPILOT_ADMIN_OIDS: TEST_OID,
          SHAPEPILOT_VAPID_PUBLIC_KEY: PUBLIC_KEY,
          SHAPEPILOT_VAPID_PRIVATE_KEY: PRIVATE_KEY,
          SHAPEPILOT_VAPID_SUBJECT: 'mailto:owner@example.invalid',
        }
        : { SHAPEPILOT_ADMIN_OIDS: TEST_OID },
      verifier: stubVerifier({
        [ADMIN]: validClaims(),
        [USER]: validClaims({ oid: OTHER_OID }),
      }),
      pushSender: sender,
    })
    return server
  }

  const call = <T>(s: TestServer, path: string, method: string, token: string, body?: unknown) =>
    s.fetchJson<T>(`${BASE}${path}`, {
      method, token, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  test('says whether push exists here, and whether this account may use it', async () => {
    const s = await start(new FakeSender())
    const admin = await call<{ enabled: boolean; publicKey: string; eligible: boolean }>(s, '', 'GET', ADMIN)
    assert.deepEqual(admin.body, { enabled: true, publicKey: PUBLIC_KEY, eligible: true })
    const user = await call<{ eligible: boolean }>(s, '', 'GET', USER)
    assert.equal(user.body.eligible, false)
  })

  test('without a signing key, push is off and subscribing says why', async () => {
    const s = await start(null)
    assert.deepEqual((await call(s, '', 'GET', ADMIN)).body,
      { enabled: false, publicKey: null, eligible: true })
    const refused = await call<ErrorBody>(s, '/subscriptions', 'POST', ADMIN, subscription())
    assert.equal(refused.status, 503)
    assert.match(refused.body.error?.message ?? '', /not configured/)
  })

  test('an administrator subscribes a browser, and a test reaches it', async () => {
    const sender = new FakeSender()
    const s = await start(sender)
    assert.equal((await call(s, '/subscriptions', 'POST', ADMIN, subscription())).status, 201)
    // Subscribing the same browser twice is the same subscription.
    assert.equal((await call(s, '/subscriptions', 'POST', ADMIN, subscription())).status, 201)

    const test = await call<Record<DeliveryResult, number>>(s, '/test', 'POST', ADMIN)
    assert.equal(test.status, 200)
    assert.deepEqual(test.body, { sent: 1, gone: 0, failed: 0 })
    assert.equal(sender.sent[0].payload.tag, 'filament-reorder-test')
    assert.ok(sender.sent[0].subscription.userAgent !== undefined)
  })

  test('a test with nothing subscribed says so rather than reporting success', async () => {
    const s = await start(new FakeSender())
    const response = await call<ErrorBody>(s, '/test', 'POST', ADMIN)
    assert.equal(response.status, 400)
  })

  test('subscribing and testing are administrator-only', async () => {
    const s = await start(new FakeSender())
    assert.equal((await call(s, '/subscriptions', 'POST', USER, subscription())).status, 403)
    assert.equal((await call(s, '/test', 'POST', USER)).status, 403)
    assert.equal((await s.fetchJson(BASE)).status, 401)
  })

  test('refuses anything but the subscription a browser produces', async () => {
    const s = await start(new FakeSender())
    const good = subscription()
    for (const [body, field] of [
      [{ ...good, endpoint: 'http://push.example.invalid/x' }, 'endpoint'],
      [{ ...good, endpoint: 'not a url' }, 'endpoint'],
      [{ ...good, keys: { ...good.keys, p256dh: Buffer.alloc(33).toString('base64url') } }, 'keys.p256dh'],
      [{ ...good, keys: { ...good.keys, auth: 'not/base64url' } }, 'keys.auth'],
      [{ ...good, keys: { ...good.keys, extra: 'x' } }, 'keys.extra'],
      [{ ...good, owner: 'someone-else' }, 'owner'],
    ] as const) {
      const response = await call<ErrorBody>(s, '/subscriptions', 'POST', ADMIN, body)
      assert.equal(response.status, 400, JSON.stringify(body))
      assert.equal(response.body.error?.details?.field, field)
    }
  })

  test('anyone may take back their own subscription, and only their own', async () => {
    const sender = new FakeSender()
    const s = await start(sender)
    await call(s, '/subscriptions', 'POST', ADMIN, subscription())

    // Another account removing it changes nothing, and says ok either way.
    assert.equal((await call(s, '/subscriptions', 'DELETE', USER, { endpoint: subscription().endpoint })).status, 200)
    assert.deepEqual((await call<Record<DeliveryResult, number>>(s, '/test', 'POST', ADMIN)).body,
      { sent: 1, gone: 0, failed: 0 })

    assert.equal((await call(s, '/subscriptions', 'DELETE', ADMIN, { endpoint: subscription().endpoint })).status, 200)
    assert.equal((await call(s, '/test', 'POST', ADMIN)).status, 400)
  })
})
