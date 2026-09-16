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
import { validateFilamentUsageMappingsInput } from '../validation/filamentUsage.ts'
import { requireRole } from '../auth/requireRole.ts'
import { computeFilamentUsage } from '../../lib/contracts/filamentUsage.ts'
import { REPORT_JOB_LIMIT } from '../element/synchronization.ts'
import { ApiError } from '../errors/ApiError.ts'

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

  // Usage comes from the EL-ement Statistics history, which is administrator
  // data about the household printer rather than anything owned by one account,
  // so it is gated exactly as that page is. The links, by contrast, are the
  // account's own -- an administrator's links do not rewrite anyone else's.
  const adminOnly = requireRole('admin', repos.memberships)

  router.get('/usage', adminOnly, (req, res, next) => {
    void (async () => {
      const owner = ownerOf(req)
      const [jobs, mappings] = await Promise.all([
        repos.elementStatistics.listJobs(null, REPORT_JOB_LIMIT + 1),
        repos.filamentUsageMappings.list(owner),
      ])
      if (jobs.length > REPORT_JOB_LIMIT) {
        throw new ApiError(413, 'report_limit',
          'The recorded history exceeds 50,000 jobs, so usage cannot be totalled in one pass.')
      }
      res.json(computeFilamentUsage(jobs, mappings))
    })().catch(next)
  })

  router.put('/usage/mappings', adminOnly, (req, res, next) => {
    void (async () => {
      const owner = ownerOf(req)
      const mappings = validateFilamentUsageMappingsInput(req.body)
      const stored = await repos.filamentUsageMappings.replace(owner, mappings)
      void repos.audit.record({
        owner,
        category: 'filament',
        action: 'usage_mappings_updated',
        outcome: 'success',
        httpMethod: req.method,
        httpPath: req.path,
        httpStatus: 200,
        requestId: req.requestId ?? null,
        detail: { mappings: stored.length },
      }).catch(() => { /* audit must never break a response */ })
      res.json({ mappings: stored })
    })().catch(next)
  })

  return router
}
