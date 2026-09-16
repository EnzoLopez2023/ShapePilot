// @vitest-environment jsdom
//
// The reorder-reminder control, with the browser's push machinery faked.
//
// Each state is pinned by what it tells the person, because the failure this
// control is most prone to is a button that appears and silently does nothing:
// on a server without keys, in a browser without push, on an iPhone that has
// not added the app to its Home Screen, or after permission was refused.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReminderControl from '../../src/features/filaments/components/ReminderControl.tsx'
import { ThemeModeProvider } from '../../src/theme/ThemeModeProvider.tsx'

const PUBLIC_KEY = Buffer.alloc(65, 4).toString('base64url')

let config = { enabled: true, publicKey: PUBLIC_KEY as string | null, eligible: true }
let requests: { path: string; method: string; body: unknown }[] = []
let permission: NotificationPermission = 'default'
let grant: NotificationPermission = 'granted'
let subscription: { endpoint: string; toJSON: () => unknown; unsubscribe: () => Promise<boolean> } | null = null
let userAgent = 'Mozilla/5.0 (Macintosh)'
let withPush = true

const fakeSubscription = () => ({
  endpoint: 'https://push.example.invalid/this-browser',
  toJSON: () => ({ endpoint: 'https://push.example.invalid/this-browser', expirationTime: null, keys: { p256dh: 'p', auth: 'a' } }),
  unsubscribe: async () => { subscription = null; return true },
})

const installBrowser = () => {
  const pushManager = {
    getSubscription: async () => subscription,
    subscribe: async () => { subscription = fakeSubscription(); return subscription },
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true, value: { ready: Promise.resolve({ pushManager }) },
  })
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => userAgent })
  if (withPush) {
    vi.stubGlobal('PushManager', class {})
    vi.stubGlobal('Notification', {
      get permission() { return permission },
      requestPermission: async () => { permission = grant; return grant },
    })
  }
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = String(url)
    const method = init?.method ?? 'GET'
    requests.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (path.endsWith('/notifications/push') && method === 'GET') return Response.json(config)
    if (path.endsWith('/push/test')) return Response.json({ sent: 1, gone: 0, failed: 0 })
    return Response.json({ ok: true }, { status: method === 'POST' ? 201 : 200 })
  }))
}

const draw = () => render(<ThemeModeProvider><ReminderControl /></ThemeModeProvider>)

beforeEach(() => {
  config = { enabled: true, publicKey: PUBLIC_KEY, eligible: true }
  requests = []
  permission = 'default'
  grant = 'granted'
  subscription = null
  userAgent = 'Mozilla/5.0 (Macintosh)'
  withPush = true
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  // jsdom has no PushManager of its own; the stub is removed with the globals.
  delete (navigator as unknown as Record<string, unknown>).serviceWorker
})

test('turning reminders on asks permission, subscribes, and tells the server', async () => {
  const user = userEvent.setup()
  installBrowser()
  draw()
  await user.click(await screen.findByRole('button', { name: 'Turn on reminders' }))

  await screen.findByText('Reminders are on for this device.', { selector: '[role="status"]' })
  const saved = requests.find(request => request.path.endsWith('/push/subscriptions') && request.method === 'POST')
  assert.deepEqual(saved?.body, fakeSubscription().toJSON())
  assert.ok(await screen.findByRole('button', { name: 'Send a test' }))
})

test('when on, a test can be sent, and turning off removes it from the server too', async () => {
  const user = userEvent.setup()
  permission = 'granted'
  subscription = fakeSubscription()
  installBrowser()
  draw()

  await user.click(await screen.findByRole('button', { name: 'Send a test' }))
  await screen.findByText('Test sent. It should arrive in a few seconds.')

  await user.click(screen.getByRole('button', { name: 'Turn off' }))
  await screen.findByRole('button', { name: 'Turn on reminders' })
  const removed = requests.find(request => request.method === 'DELETE')
  assert.deepEqual(removed?.body, { endpoint: 'https://push.example.invalid/this-browser' })
  assert.equal(subscription, null)
})

test('blocked notifications say how to fix it, and nothing is sent to the server', async () => {
  const user = userEvent.setup()
  grant = 'denied'
  installBrowser()
  draw()
  await user.click(await screen.findByRole('button', { name: 'Turn on reminders' }))
  await screen.findByText(/Notifications are blocked for this site/)
  assert.equal(requests.some(request => request.method === 'POST'), false)
})

test('a server without keys says so instead of offering a switch', async () => {
  config = { enabled: false, publicKey: null, eligible: true }
  installBrowser()
  draw()
  await screen.findByText('Reorder reminders are not set up on this server yet.')
  assert.equal(screen.queryByRole('button'), null)
})

test('an iPhone in a Safari tab is told to add the app to its Home Screen first', async () => {
  userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'
  withPush = false
  installBrowser()
  draw()
  await screen.findByText(/add ShapePilot to your Home Screen/)
  assert.equal(screen.queryByRole('button'), null)
})

test('an account that may not see printer stock sees nothing at all', async () => {
  config = { enabled: true, publicKey: PUBLIC_KEY, eligible: false }
  installBrowser()
  draw()
  await waitFor(() => assert.ok(requests.length > 0))
  assert.equal(screen.queryByRole('region', { name: 'Reorder reminders' }), null)
  assert.equal(screen.queryByText(/reminders/i), null)
})
