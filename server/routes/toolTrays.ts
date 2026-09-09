// Tool tray HTTP routes.
//
// The same shape as the switch tray's routes -- authenticated, scoped to the
// caller's `(tenant_id, oid)`, typed error envelope, every write body fully
// validated before the repository is touched. No project link and no library
// sub-resource, so `/:id` sits in its natural place.
//
// The write bodies are the largest of any designer here (a pocket list, each
// pocket a list of steps), which is why `validation/toolTray.ts` carries real
// budgets rather than only shape checks.
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import type { Repositories } from '../../lib/db/repositories/contracts.ts'
import { InvalidProfileError } from '../../lib/db/repositories/contracts.ts'
import { ApiError } from '../errors/ApiError.ts'
import { ownerOf } from '../auth/requireAuth.ts'
import { validateCloneRequest, validateToolTrayInput } from '../validation/toolTray.ts'

type Handler = (req: Request, res: Response) => Promise<void>

const asyncRoute = (handler: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next)
  }

/** Express 5 types a route param as string | string[]; ours are always single. */
const pathId = (value: string | string[]): string => (Array.isArray(value) ? value[0] : value)

export function createToolTrayRouter(repos: Repositories): Router {
  const router = Router()
  const { toolTrays, audit } = repos

  const note = (
    req: { method: string; path: string; requestId?: string },
    owner: { tenantId: string; oid: string },
    action: string,
    subject?: string,
  ) => {
    void audit.record({
      owner,
      category: 'tool-tray',
      action,
      outcome: 'success',
      httpMethod: req.method,
      httpPath: req.path,
      httpStatus: 200,
      requestId: req.requestId ?? null,
      subject: subject ?? null,
    }).catch(() => { /* audit must never break a response */ })
  }

  router.get('/', asyncRoute(async (req, res) => {
    res.json(await toolTrays.listDesigns(ownerOf(req)))
  }))

  router.get('/:id', asyncRoute(async (req, res) => {
    const design = await toolTrays.getDesign(ownerOf(req), pathId(req.params.id))
    if (!design) throw ApiError.notFound('design not found')
    res.json(design)
  }))

  router.post('/', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const input = validateToolTrayInput(req.body ?? {})
    try {
      const created = await toolTrays.createDesign(owner, input)
      note(req, owner, 'design_created', created.id)
      res.status(201).json(created)
    } catch (error) {
      if (error instanceof InvalidProfileError) throw ApiError.badRequest(error.message)
      throw error
    }
  }))

  router.put('/:id', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const input = validateToolTrayInput(req.body ?? {})
    try {
      const updated = await toolTrays.updateDesign(owner, pathId(req.params.id), input)
      if (!updated) throw ApiError.notFound('design not found')
    } catch (error) {
      if (error instanceof InvalidProfileError) throw ApiError.badRequest(error.message)
      throw error
    }
    note(req, owner, 'design_updated', pathId(req.params.id))
    res.json({ ok: true })
  }))

  router.post('/:id/clone', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const requested = validateCloneRequest(req.body ?? {})
    const created = await toolTrays.cloneDesign(owner, pathId(req.params.id), requested.name)
    if (!created) throw ApiError.notFound('design not found')
    note(req, owner, 'design_cloned', created.id)
    res.status(201).json(created)
  }))

  router.delete('/:id', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const removed = await toolTrays.deleteDesign(owner, pathId(req.params.id))
    if (!removed) throw ApiError.notFound('design not found')
    note(req, owner, 'design_deleted', pathId(req.params.id))
    res.json({ ok: true })
  }))

  return router
}
