import { Router } from 'express'
import type { Repositories } from '../../lib/db/repositories/contracts.ts'
import { ownerOf } from '../auth/requireAuth.ts'
import { ApiError } from '../errors/ApiError.ts'

function queryString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw ApiError.badRequest(`${name} must be provided once as a string.`)
  }
  return value
}

/**
 * Audit ingestion and retrieval.
 *
 * The client may only record events for itself: the actor is taken from the
 * verified principal and never from the body. Retrieval is admin-only and is
 * mounted behind `requireRole('admin')` in app.ts.
 */
export function createAuditRouter(repos: Repositories): Router {
  const router = Router()

  router.post('/events', (req, res, next) => {
    void (async () => {
      const owner = ownerOf(req)
      const body = (req.body ?? {}) as Record<string, unknown>
      await repos.audit.record({
        owner,
        category: typeof body.category === 'string' ? body.category : 'client',
        action: typeof body.action === 'string' ? body.action : 'unknown',
        outcome: body.outcome === 'failure' ? 'failure' : 'success',
        httpMethod: req.method,
        httpPath: req.path,
        httpStatus: 202,
        requestId: req.requestId ?? null,
        subject: typeof body.subject === 'string' ? body.subject : null,
        detail: body.detail,
      })
      res.status(202).json({ ok: true })
    })().catch(next)
  })

  return router
}

/** Admin-only reader; mounted separately so the role gate is explicit. */
export function createAuditAdminRouter(repos: Repositories): Router {
  const router = Router()

  router.get('/', (req, res, next) => {
    void (async () => {
      const category = queryString(req.query.category, 'category')
      const before = queryString(req.query.before, 'before')
      const rawLimit = queryString(req.query.limit, 'limit')
      const limit = rawLimit === undefined ? undefined : Number(rawLimit)
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
        throw ApiError.badRequest('limit must be a positive integer.')
      }
      res.json(await repos.audit.list({
        category,
        limit,
        before,
      }))
    })().catch(next)
  })

  return router
}
