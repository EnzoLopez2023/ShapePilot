// Gridfinity HTTP routes: bins and baseplates under `/designs`, the label lists
// their raised names are picked from under `/label-lists`. Authenticated and
// scoped to the caller's `(tenant_id, oid)` like every designer route.
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import type { Repositories } from '../../lib/db/repositories/contracts.ts'
import { ApiError } from '../errors/ApiError.ts'
import { ownerOf } from '../auth/requireAuth.ts'
import {
  validateCloneRequest, validateGridfinityDesignInput, validateLabelListInput,
} from '../validation/gridfinity.ts'

type Handler = (req: Request, res: Response) => Promise<void>

const asyncRoute = (handler: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next)
  }

const pathId = (value: string | string[]): string => (Array.isArray(value) ? value[0] : value)

export function createGridfinityRouter(repos: Repositories): Router {
  const router = Router()
  const { gridfinity, audit } = repos

  const note = (
    req: { method: string; path: string; requestId?: string },
    owner: { tenantId: string; oid: string },
    action: string,
    subject?: string,
  ) => {
    void audit.record({
      owner,
      category: 'gridfinity',
      action,
      outcome: 'success',
      httpMethod: req.method,
      httpPath: req.path,
      httpStatus: 200,
      requestId: req.requestId ?? null,
      subject: subject ?? null,
    }).catch(() => { /* audit must never break a response */ })
  }

  router.get('/designs', asyncRoute(async (req, res) => {
    res.json(await gridfinity.listDesigns(ownerOf(req)))
  }))

  router.get('/designs/:id', asyncRoute(async (req, res) => {
    const design = await gridfinity.getDesign(ownerOf(req), pathId(req.params.id))
    if (!design) throw ApiError.notFound('design not found')
    res.json(design)
  }))

  router.post('/designs', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const created = await gridfinity.createDesign(owner, validateGridfinityDesignInput(req.body ?? {}))
    note(req, owner, 'design_created', created.id)
    res.status(201).json(created)
  }))

  router.put('/designs/:id', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const input = validateGridfinityDesignInput(req.body ?? {})
    if (!await gridfinity.updateDesign(owner, pathId(req.params.id), input)) {
      throw ApiError.notFound('design not found')
    }
    note(req, owner, 'design_updated', pathId(req.params.id))
    res.json({ ok: true })
  }))

  router.post('/designs/:id/clone', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const { name } = validateCloneRequest(req.body ?? {})
    const created = await gridfinity.cloneDesign(owner, pathId(req.params.id), name)
    if (!created) throw ApiError.notFound('design not found')
    note(req, owner, 'design_cloned', created.id)
    res.status(201).json(created)
  }))

  router.delete('/designs/:id', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    if (!await gridfinity.deleteDesign(owner, pathId(req.params.id))) {
      throw ApiError.notFound('design not found')
    }
    note(req, owner, 'design_deleted', pathId(req.params.id))
    res.json({ ok: true })
  }))

  router.get('/label-lists', asyncRoute(async (req, res) => {
    res.json(await gridfinity.listLabelLists(ownerOf(req)))
  }))

  router.get('/label-lists/:id', asyncRoute(async (req, res) => {
    const list = await gridfinity.getLabelList(ownerOf(req), pathId(req.params.id))
    if (!list) throw ApiError.notFound('label list not found')
    res.json(list)
  }))

  router.post('/label-lists', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const created = await gridfinity.createLabelList(owner, validateLabelListInput(req.body ?? {}))
    note(req, owner, 'label_list_created', created.id)
    res.status(201).json(created)
  }))

  router.put('/label-lists/:id', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const input = validateLabelListInput(req.body ?? {})
    if (!await gridfinity.updateLabelList(owner, pathId(req.params.id), input)) {
      throw ApiError.notFound('label list not found')
    }
    note(req, owner, 'label_list_updated', pathId(req.params.id))
    res.json({ ok: true })
  }))

  router.delete('/label-lists/:id', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    if (!await gridfinity.deleteLabelList(owner, pathId(req.params.id))) {
      throw ApiError.notFound('label list not found')
    }
    note(req, owner, 'label_list_deleted', pathId(req.params.id))
    res.json({ ok: true })
  }))

  return router
}
