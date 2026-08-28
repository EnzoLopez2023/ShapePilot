import { Router } from 'express'
import type { Repositories } from '../../lib/db/repositories/contracts.ts'
import { DEFAULT_PREFERENCES, normalizePreferences } from '../../lib/db/repositories/settings.ts'
import { ownerOf } from '../auth/requireAuth.ts'

export function createSettingsRouter(repos: Repositories): Router {
  const router = Router()

  router.get('/', (req, res, next) => {
    void (async () => {
      const owner = ownerOf(req)
      const stored = await repos.settings.get(owner)
      const membership = await repos.memberships.find(owner)
      res.json({
        preferences: stored ?? DEFAULT_PREFERENCES,
        profile: {
          tenantId: owner.tenantId,
          oid: owner.oid,
          displayName: membership?.displayName ?? req.principal?.displayName ?? null,
          email: membership?.email ?? req.principal?.email ?? null,
          role: membership?.role ?? 'user',
          authSource: req.principal?.source ?? 'entra',
        },
      })
    })().catch(next)
  })

  router.put('/', (req, res, next) => {
    void (async () => {
      const owner = ownerOf(req)
      const saved = await repos.settings.put(owner, normalizePreferences(req.body))
      void repos.audit.record({
        owner,
        category: 'settings',
        action: 'preferences_updated',
        outcome: 'success',
        httpMethod: req.method,
        httpPath: req.path,
        httpStatus: 200,
        requestId: req.requestId ?? null,
        detail: saved,
      }).catch(() => { /* audit must never break a response */ })
      res.json({ preferences: saved })
    })().catch(next)
  })

  return router
}
