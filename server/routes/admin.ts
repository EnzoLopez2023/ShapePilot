import { Router } from 'express'
import type { AppDatabase } from '../../lib/db/connection.ts'
import type { Repositories } from '../../lib/db/repositories/contracts.ts'
import { readiness } from '../../lib/health/readiness.ts'
import type { Lifecycle } from '../../lib/health/readiness.ts'
import type { BuildIdentity } from '../../lib/lineage/buildIdentity.ts'
import { ApiError } from '../errors/ApiError.ts'
import { ownerOf } from '../auth/requireAuth.ts'

export interface AdminRouterOptions {
  repos: Repositories
  identity: BuildIdentity
  database: () => AppDatabase | null
  lifecycle: () => Lifecycle
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Admin surface. Every route here is behind `requireRole('admin')`, which
 * re-reads the membership row server-side on each call.
 */
export function createAdminRouter(options: AdminRouterOptions): Router {
  const router = Router()
  const { repos, identity } = options

  router.get('/health', (_req, res) => {
    // The detailed report is the same bounded probe /api/ready runs; admins get
    // the schema and authority detail alongside it.
    res.json(readiness(identity, options.lifecycle(), options.database()))
  })

  router.get('/members', (_req, res, next) => {
    void (async () => {
      res.json(await repos.memberships.list())
    })().catch(next)
  })

  router.put('/members/:tenantId/:oid/role', (req, res, next) => {
    void (async () => {
      const actor = ownerOf(req)
      const { tenantId, oid } = req.params
      if (!GUID.test(tenantId) || !GUID.test(oid)) {
        throw ApiError.badRequest('tenantId and oid must be GUIDs')
      }
      const role = (req.body ?? {}).role
      if (role !== 'user' && role !== 'admin') {
        throw ApiError.badRequest("role must be 'user' or 'admin'")
      }
      if (tenantId.toLowerCase() === actor.tenantId && oid.toLowerCase() === actor.oid
        && role !== 'admin') {
        // Removing your own last admin grant locks the app out of itself.
        throw ApiError.conflict('An administrator cannot remove their own admin role.')
      }
      const updated = await repos.memberships.setRole(
        { tenantId: tenantId.toLowerCase(), oid: oid.toLowerCase() }, role)
      if (!updated) throw ApiError.notFound('member not found')

      void repos.audit.record({
        owner: actor,
        category: 'admin',
        action: 'role_changed',
        outcome: 'success',
        httpMethod: req.method,
        httpPath: req.path,
        httpStatus: 200,
        requestId: req.requestId ?? null,
        subject: `${tenantId}/${oid}`,
        detail: { role },
      }).catch(() => { /* audit must never break a response */ })

      res.json(updated)
    })().catch(next)
  })

  return router
}
