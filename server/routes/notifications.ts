// Web Push routes: what a browser needs to subscribe, and the subscription
// itself.
//
// Reminders are about printer stock, which is administrator data, so saving a
// subscription and sending a test are administrator-only. Reading the
// configuration and removing a subscription are not: any signed-in browser may
// ask whether push exists here, and may always take back its own subscription.
import { Router } from 'express'
import type { Repositories } from '../../lib/db/repositories/contracts.ts'
import type { PushConfig } from '../config.ts'
import { ApiError } from '../errors/ApiError.ts'
import { ownerOf } from '../auth/requireAuth.ts'
import { requireRole } from '../auth/requireRole.ts'
import { deliver } from '../notifications/reorderAlerts.ts'
import type { PushSender } from '../notifications/reorderAlerts.ts'
import {
  validatePushEndpointInput, validatePushSubscriptionInput,
} from '../validation/pushSubscription.ts'

export interface NotificationRouterOptions {
  repos: Repositories
  config: PushConfig
  sender: PushSender | null
}

export function createNotificationRouter({ repos, config, sender }: NotificationRouterOptions): Router {
  const router = Router()
  const adminOnly = requireRole('admin', repos.memberships)

  const requireSender = (): PushSender => {
    if (!sender) {
      throw ApiError.unavailable(config.unresolvedSecret
        ? 'Push notifications are configured, but the signing key could not be read from Key Vault.'
        : 'Push notifications are not configured on this server.')
    }
    return sender
  }

  router.get('/push', (req, res, next) => {
    void (async () => {
      const membership = await repos.memberships.find(ownerOf(req))
      res.json({
        enabled: sender !== null,
        // The public key is public: it is what the browser encrypts to.
        publicKey: sender ? config.publicKey : null,
        eligible: membership?.role === 'admin',
      })
    })().catch(next)
  })

  router.post('/push/subscriptions', adminOnly, (req, res, next) => {
    void (async () => {
      requireSender()
      const input = validatePushSubscriptionInput(req.body)
      await repos.push.subscribe(ownerOf(req), {
        ...input, userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
      })
      res.status(201).json({ ok: true })
    })().catch(next)
  })

  router.delete('/push/subscriptions', (req, res, next) => {
    void (async () => {
      const { endpoint } = validatePushEndpointInput(req.body)
      // Idempotent: a browser forgetting a subscription the server already
      // dropped is the same outcome, and the page should not show an error.
      await repos.push.unsubscribe(ownerOf(req), endpoint)
      res.json({ ok: true })
    })().catch(next)
  })

  router.post('/push/test', adminOnly, (req, res, next) => {
    void (async () => {
      const counts = await deliver(repos, requireSender(), ownerOf(req), {
        title: 'ShapePilot reminders are on',
        body: 'You will hear from this browser when a loaded filament needs reordering.',
        url: '/filaments',
        tag: 'filament-reorder-test',
      })
      if (counts.sent + counts.gone + counts.failed === 0) {
        throw ApiError.badRequest('This account has no browser subscribed to reminders.')
      }
      res.json(counts)
    })().catch(next)
  })

  return router
}
