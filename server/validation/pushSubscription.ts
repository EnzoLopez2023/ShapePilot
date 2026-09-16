// Runtime validation for Web Push subscriptions.
//
// A subscription is what `PushSubscription.toJSON()` produces in the browser:
// the push service's endpoint and two keys. The keys have exact sizes -- a
// 65-byte P-256 public key and a 16-byte auth secret, base64url-encoded -- so
// anything else is refused rather than stored and failed on at send time.
import { ApiError } from '../errors/ApiError.ts'
import type { PushSubscriptionInput } from '../../lib/db/repositories/contracts.ts'

const bad = (field: string, message: string): never => {
  throw new ApiError(400, 'bad_request', message, { field })
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/

const byteLength = (value: string): number =>
  Buffer.from(value.replace(/=+$/, ''), 'base64url').length

function endpointOf(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    bad('endpoint', 'endpoint must be a URL of at most 2048 characters')
  }
  let url: URL
  try {
    url = new URL(value as string)
  } catch {
    return bad('endpoint', 'endpoint must be a URL')
  }
  // Push services are always https; anything else is not a push service, and
  // the server would be making requests wherever it pointed.
  if (url.protocol !== 'https:') bad('endpoint', 'endpoint must be an https URL')
  return value as string
}

export function validatePushSubscriptionInput(body: unknown): PushSubscriptionInput {
  if (!isPlainObject(body)) bad('body', 'body must be a JSON object')
  const root = body as Record<string, unknown>
  for (const key of Object.keys(root)) {
    // `expirationTime` is part of toJSON() and always null in practice; accepted
    // and ignored rather than making the client strip it.
    if (!['endpoint', 'keys', 'expirationTime'].includes(key)) {
      bad(key, `body does not accept the field "${key}"`)
    }
  }
  const endpoint = endpointOf(root.endpoint)
  if (!isPlainObject(root.keys)) bad('keys', 'keys must be a JSON object')
  const keys = root.keys as Record<string, unknown>
  for (const key of Object.keys(keys)) {
    if (key !== 'p256dh' && key !== 'auth') bad(`keys.${key}`, `keys does not accept the field "${key}"`)
  }
  const p256dh = keys.p256dh
  if (typeof p256dh !== 'string' || !BASE64URL.test(p256dh) || byteLength(p256dh) !== 65) {
    bad('keys.p256dh', 'keys.p256dh must be a base64url 65-byte P-256 public key')
  }
  const auth = keys.auth
  if (typeof auth !== 'string' || !BASE64URL.test(auth) || byteLength(auth) !== 16) {
    bad('keys.auth', 'keys.auth must be a base64url 16-byte secret')
  }
  return { endpoint, keys: { p256dh: p256dh as string, auth: auth as string } }
}

export function validatePushEndpointInput(body: unknown): { endpoint: string } {
  if (!isPlainObject(body)) bad('body', 'body must be a JSON object')
  const root = body as Record<string, unknown>
  for (const key of Object.keys(root)) {
    if (key !== 'endpoint') bad(key, `body does not accept the field "${key}"`)
  }
  return { endpoint: endpointOf(root.endpoint) }
}
