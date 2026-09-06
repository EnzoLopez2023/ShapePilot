// Filament inventory HTTP routes.
//
// An owner-scoped singleton, shaped like /api/settings rather than like a
// collection: there is one inventory per account and it has no id. The whole
// tick set goes up on every write, so this is GET and PUT and nothing else.
//
// The catalogue itself never travels -- the client already has it, compiled in.
// What crosses the wire is only which of its entries the account owns.
import { Router } from 'express'
import type { Repositories } from '../../lib/db/repositories/contracts.ts'
import { ownerOf } from '../auth/requireAuth.ts'
import { validateFilamentInventoryInput } from '../validation/filaments.ts'

export function createFilamentRouter(repos: Repositories): Router {
  const router = Router()

  router.get('/', (req, res, next) => {
    void (async () => {
      res.json({ owned: await repos.filaments.list(ownerOf(req)) })
    })().catch(next)
  })

  router.put('/', (req, res, next) => {
    void (async () => {
      const owner = ownerOf(req)
      const entries = validateFilamentInventoryInput(req.body)
      const owned = await repos.filaments.replace(owner, entries)
      void repos.audit.record({
        owner,
        category: 'filament',
        action: 'inventory_updated',
        outcome: 'success',
        httpMethod: req.method,
        httpPath: req.path,
        httpStatus: 200,
        requestId: req.requestId ?? null,
        // The count, not the set. Audit detail is bounded and redacted, and a
        // few hundred filament keys is not an audit record.
        detail: { owned: owned.length },
      }).catch(() => { /* audit must never break a response */ })
      res.json({ owned })
    })().catch(next)
  })

  return router
}
