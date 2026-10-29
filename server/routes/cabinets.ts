// Cabinet HTTP routes: the named cabinets saved from the cabinet designer.
// Authenticated and scoped to the caller's `(tenant_id, oid)`. The name is the
// identity, so a save is a PUT to the collection and a delete names its target.
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import type { Repositories } from '../../lib/db/repositories/contracts.ts'
import { ApiError } from '../errors/ApiError.ts'
import { ownerOf } from '../auth/requireAuth.ts'
import { validateCabinetInput, validateCabinetName } from '../validation/cabinet.ts'

type Handler = (req: Request, res: Response) => Promise<void>

const asyncRoute = (handler: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next)
  }

export function createCabinetRouter(repos: Repositories): Router {
  const router = Router()
  const { cabinets, audit } = repos

  const note = (
    req: { method: string; path: string; requestId?: string },
    owner: { tenantId: string; oid: string },
    action: string,
    subject: string,
  ) => {
    void audit.record({
      owner,
      category: 'cabinet',
      action,
      outcome: 'success',
      httpMethod: req.method,
      httpPath: req.path,
      httpStatus: 200,
      requestId: req.requestId ?? null,
      subject,
    }).catch(() => { /* audit must never break a response */ })
  }

  router.get('/', asyncRoute(async (req, res) => {
    res.json(await cabinets.list(ownerOf(req)))
  }))

  router.put('/', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const { name, params } = validateCabinetInput(req.body ?? {})
    await cabinets.put(owner, name, params)
    note(req, owner, 'cabinet_saved', name)
    res.json({ ok: true })
  }))

  router.delete('/', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const name = validateCabinetName(req.query.name, 'name')
    if (!await cabinets.remove(owner, name)) throw ApiError.notFound('cabinet not found')
    note(req, owner, 'cabinet_deleted', name)
    res.json({ ok: true })
  }))

  return router
}
