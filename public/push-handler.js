// Web Push handling, imported into the generated service worker.
//
// Plain JavaScript on purpose: vite-plugin-pwa generates the worker with
// Workbox and pulls this in with importScripts, so it is served as-is from
// /push-handler.js and never passes through the bundler.
//
// A push carries JSON from server/notifications/reorderAlerts.ts: a title, a
// body, the page to open, and a tag so a newer reminder replaces an older one
// instead of stacking. A click focuses an open ShapePilot window on that page,
// or opens one.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'ShapePilot'
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === 'string' ? data.body : '',
    tag: typeof data.tag === 'string' ? data.tag : undefined,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data && event.notification.data.url || '/', self.location.origin)
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (new URL(client.url).origin === url.origin && 'focus' in client) {
        await client.focus()
        if ('navigate' in client) await client.navigate(url.href)
        return
      }
    }
    await self.clients.openWindow(url.href)
  })())
})
