// Reorder reminders, delivered by Web Push.
//
// A check, not an event handler. Every run reads the printer's last saved AMS
// reading, applies the same rule the Filaments page applies
// (lib/contracts/filamentStock.ts) against each subscribed administrator's own
// inventory, and tells them about colours that have *newly* come to need a
// reorder. Running it on a timer rather than off each MQTT message means it
// cannot fire twenty times while a spool hovers at 20%, and it also catches a
// count lowered on the Filaments page, which no printer message would.
//
// "Newly" is `filament_reorder_alerts`. A colour is recorded once it has been
// delivered to at least one of the account's browsers, and cleared as soon as a
// run finds it no longer needs reordering -- a spare added, a fresh spool
// loaded -- which re-arms it for the next time it runs low. A delivery that
// reached no browser is not recorded, so the next run tries again.
//
// With no AMS reading at all, a run changes nothing. "The printer said nothing"
// is not "the spool is fine", and clearing alerts on silence would re-send them
// the moment it spoke again.
import webpush from 'web-push'
import { amsStockOf, colorLabel, slotLabel, stockOf } from '../../lib/contracts/filamentStock.ts'
import type { ColorStock } from '../../lib/contracts/filamentStock.ts'
import type {
  Owner, Repositories, StoredPushSubscription,
} from '../../lib/db/repositories/contracts.ts'
import type { PushConfig } from '../config.ts'

export interface PushPayload {
  title: string
  body: string
  /** Where a tap on the notification should land. */
  url: string
  /** Replaces an earlier notification with the same tag rather than stacking. */
  tag: string
}

export type DeliveryResult = 'sent' | 'gone' | 'failed'

export interface PushSender {
  send(subscription: StoredPushSubscription, payload: PushPayload): Promise<DeliveryResult>
}

/**
 * The real sender, or null when VAPID is not configured. 404 and 410 are the
 * push service saying the browser unsubscribed or was uninstalled; anything
 * else is a delivery that may work next time.
 */
export function createWebPushSender(config: PushConfig): PushSender | null {
  if (!config.enabled || !config.publicKey || !config.privateKey || !config.subject) return null
  const vapidDetails = {
    subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey,
  }
  return {
    async send(subscription, payload) {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: subscription.keys },
          JSON.stringify(payload),
          // A reorder reminder a day late is still worth having; a week late is not.
          { vapidDetails, TTL: 24 * 60 * 60, urgency: 'normal', timeout: 10_000 },
        )
        return 'sent'
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode
        return status === 404 || status === 410 ? 'gone' : 'failed'
      }
    },
  }
}

/** One line per colour, lowest first: "PLA Basic · Cocoa Brown 10802 — 12% left". */
export function reorderPayload(stock: readonly ColorStock[]): PushPayload {
  const lines = stock.map(entry => {
    const where = entry.loaded[0] ? ` in ${slotLabel(entry.loaded[0])}` : ''
    return `${colorLabel(entry.key)} — ${entry.lowestPercent}% left${where}`
  })
  return {
    title: stock.length === 1 ? 'Reorder filament' : `Reorder ${stock.length} filaments`,
    body: `${lines.join('\n')}\nNo spare on the shelf.`,
    url: '/filaments',
    tag: 'filament-reorder',
  }
}

/** Deliver to every browser an owner has; forget the ones that are gone. */
export async function deliver(
  repos: Repositories,
  sender: PushSender,
  owner: Owner,
  payload: PushPayload,
  now: () => Date = () => new Date(),
): Promise<Record<DeliveryResult, number>> {
  const counts: Record<DeliveryResult, number> = { sent: 0, gone: 0, failed: 0 }
  for (const subscription of await repos.push.listForOwner(owner)) {
    const result = await sender.send(subscription, payload)
    counts[result] += 1
    if (result === 'gone') await repos.push.forget(subscription.endpoint)
    if (result === 'sent') await repos.push.markSent(subscription.endpoint, now().toISOString())
  }
  return counts
}

export interface ReorderCheckResult {
  /** Owners whose stock was evaluated. */
  checked: number
  /** Owners who were sent a reminder. */
  notified: number
}

export async function checkReorderAlerts(
  repos: Repositories,
  sender: PushSender,
  now: () => Date = () => new Date(),
): Promise<ReorderCheckResult> {
  const settings = await repos.elementStatistics.getSettings()
  const ams = settings.activeConnectionId
    ? amsStockOf(await repos.elementStatistics.getSnapshot(settings.activeConnectionId))
    : null
  const result: ReorderCheckResult = { checked: 0, notified: 0 }
  if (!ams) return result

  for (const owner of await repos.push.listOwners()) {
    // Printer stock is administrator data, as on the page. A subscription left
    // behind by an account that is no longer an administrator gets nothing.
    const membership = await repos.memberships.find(owner)
    if (membership?.role !== 'admin') continue
    result.checked += 1

    const totals = new Map<string, number>()
    for (const entry of await repos.filaments.list(owner)) {
      totals.set(entry.key, (totals.get(entry.key) ?? 0) + entry.quantity)
    }
    const reorder = stockOf(ams, key => totals.get(key) ?? 0)
      .filter(entry => entry.status === 'reorder')
    const due = new Set(reorder.map(entry => entry.key))
    const alerted = new Set(await repos.push.alertedKeys(owner))

    const fresh = reorder.filter(entry => !alerted.has(entry.key))
    const recovered = [...alerted].filter(key => !due.has(key))

    let delivered = false
    if (fresh.length > 0) {
      const counts = await deliver(repos, sender, owner, reorderPayload(fresh), now)
      delivered = counts.sent > 0
      if (delivered) result.notified += 1
    }
    await repos.push.updateAlerts(owner, delivered ? fresh.map(entry => entry.key) : [], recovered)
  }
  return result
}

export interface ReorderSchedule {
  close(): Promise<void>
}

/**
 * Run the check now-ish and then every `intervalMs`, one run at a time. The
 * timer is unref'd so it never holds the process open, and a failed run is
 * logged and forgotten: the next one reads fresh state anyway.
 */
export function scheduleReorderAlerts(
  run: () => Promise<unknown>,
  { intervalMs = 10 * 60 * 1000, firstRunMs = 60 * 1000, logger = console.error } = {},
): ReorderSchedule {
  let running: Promise<unknown> | null = null
  let closed = false
  const tick = () => {
    if (closed || running) return
    running = run()
      .catch(error => logger('ShapePilot reorder reminders: check failed', error))
      .finally(() => { running = null })
  }
  const first = setTimeout(tick, firstRunMs)
  const every = setInterval(tick, intervalMs)
  first.unref()
  every.unref()
  return {
    async close() {
      closed = true
      clearTimeout(first)
      clearInterval(every)
      await running
    },
  }
}
