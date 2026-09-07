// Switch tray HTTP routes.
//
// The same shape as the keycap tray's routes -- authenticated, scoped to the
// caller's `(tenant_id, oid)`, typed error envelope, every write body fully
// validated before the repository is touched -- with two differences: there is
// no project link to prove ownership of, and no library sub-resource, so `/:id`
// can be declared in its natural place.
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import type { Repositories } from '../../lib/db/repositories/contracts.ts'
import { InvalidProfileError } from '../../lib/db/repositories/contracts.ts'
import { ApiError } from '../errors/ApiError.ts'
import { ownerOf } from '../auth/requireAuth.ts'
import { validateCloneRequest, validateSwitchTrayInput } from '../validation/switchTray.ts'

type Handler = (req: Request, res: Response) => Promise<void>

const asyncRoute = (handler: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next)
  }

/** Express 5 types a route param as string | string[]; ours are always single. */
const pathId = (value: string | string[]): string => (Array.isArray(value) ? value[0] : value)

export function createSwitchTrayRouter(repos: Repositories): Router {
  const router = Router()
  const { switchTrays, audit } = repos

  const note = (
    req: { method: string; path: string; requestId?: string },
    owner: { tenantId: string; oid: string },
    action: string,
    subject?: string,
  ) => {
    void audit.record({
      owner,
      category: 'switch-tray',
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
    res.json(await switchTrays.listDesigns(ownerOf(req)))
  }))

  router.get('/:id', asyncRoute(async (req, res) => {
    const design = await switchTrays.getDesign(ownerOf(req), pathId(req.params.id))
    if (!design) throw ApiError.notFound('design not found')
    res.json(design)
  }))

  router.post('/', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const input = validateSwitchTrayInput(req.body ?? {})
    try {
      const created = await switchTrays.createDesign(owner, input)
      note(req, owner, 'design_created', created.id)
      res.status(201).json(created)
    } catch (error) {
      if (error instanceof InvalidProfileError) throw ApiError.badRequest(error.message)
      throw error
    }
  }))

  router.put('/:id', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const input = validateSwitchTrayInput(req.body ?? {})
    try {
      const updated = await switchTrays.updateDesign(owner, pathId(req.params.id), input)
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
    const created = await switchTrays.cloneDesign(owner, pathId(req.params.id), requested.name)
    if (!created) throw ApiError.notFound('design not found')
    note(req, owner, 'design_cloned', created.id)
    res.status(201).json(created)
  }))

  router.delete('/:id', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const removed = await switchTrays.deleteDesign(owner, pathId(req.params.id))
    if (!removed) throw ApiError.notFound('design not found')
    note(req, owner, 'design_deleted', pathId(req.params.id))
    res.json({ ok: true })
  }))

  return router
}
