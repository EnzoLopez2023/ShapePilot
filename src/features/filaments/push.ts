// This browser's side of Web Push: whether it can, whether it has, and turning
// it on and off.
//
// Everything here is about *this* device. A subscription is issued to one
// browser, so "reminders on" on a laptop says nothing about the phone, and the
// control is worded that way.
//
// iPhone and iPad only offer push to a site added to the Home Screen, and say
// so by having no PushManager at all in a Safari tab. That case gets its own
// state, because "not supported" would be untrue and unhelpful -- it is one
// Share-sheet tap away.
import { apiRequest } from '../../services/http.ts'

export interface PushServerConfig {
  enabled: boolean
  publicKey: string | null
  eligible: boolean
}

export const getPushConfig = () => apiRequest<PushServerConfig>('/notifications/push')

export type PushSupport = 'supported' | 'install-first' | 'unsupported'

export function pushSupport(nav: Navigator = navigator, win: Window = window): PushSupport {
  const hasWorker = 'serviceWorker' in nav
  const hasPush = 'PushManager' in win && 'Notification' in win
  if (hasWorker && hasPush) return 'supported'
  // iOS Safari in a tab: service workers exist, push does not until installed.
  const ios = /iPad|iPhone|iPod/.test(nav.userAgent)
    || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
  const standalone = win.matchMedia?.('(display-mode: standalone)').matches
  return ios && hasWorker && !standalone ? 'install-first' : 'unsupported'
}

/**
 * The service worker registration, or null if none becomes ready soon. In
 * development the PWA plugin registers no worker, and `ready` would otherwise
 * wait forever.
 */
async function registration(timeoutMs = 4000): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
  ])
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration()
  return reg ? reg.pushManager.getSubscription() : null
}

const keyBytes = (base64url: string): Uint8Array<ArrayBuffer> => {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export class PushSetupError extends Error {}

/** Ask permission, subscribe this browser, and tell the server. */
export async function enablePush(publicKey: string): Promise<void> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new PushSetupError(permission === 'denied'
      ? 'Notifications are blocked for this site. Allow them in the browser’s site settings, then try again.'
      : 'Notification permission was not given.')
  }
  const reg = await registration()
  if (!reg) throw new PushSetupError('The app’s service worker is not running here, so push is unavailable.')
  const existing = await reg.pushManager.getSubscription()
  const subscription = existing ?? await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(publicKey),
  })
  await apiRequest('/notifications/push/subscriptions', { method: 'POST', body: subscription.toJSON() })
}

/** Unsubscribe this browser and tell the server. Safe to call when already off. */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription()
  if (!subscription) return
  await apiRequest('/notifications/push/subscriptions', {
    method: 'DELETE', body: { endpoint: subscription.endpoint },
  })
  await subscription.unsubscribe()
}

export const sendTestPush = () =>
  apiRequest<{ sent: number; gone: number; failed: number }>('/notifications/push/test', { method: 'POST' })
