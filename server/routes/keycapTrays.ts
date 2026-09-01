// Keycap tray HTTP routes.
//
// Ported from routes/keycap-trays.js at Hearth commit
// f0b05fc1dbf53e8aa26c215d8e858894a2793871. Route order, status codes, result
// field names and transactional behaviour are preserved; the differences are
// that every route is authenticated, scoped to the caller's `(tenant_id, oid)`,
// and returns the typed error envelope.
//
// Every write body is validated completely before the repository is touched
// (see server/validation/keycapTray.ts), so an invalid payload is a typed 400
// and never a partially written transaction.
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import type { Repositories } from '../../lib/db/repositories/contracts.ts'
import { DuplicateLibraryPocketError, InvalidProfileError } from '../../lib/db/repositories/contracts.ts'
import { ApiError } from '../errors/ApiError.ts'
import { ownerOf } from '../auth/requireAuth.ts'
import {
  validateCloneRequest, validateLibraryPocketInput, validateTrayDesignInput,
} from '../validation/keycapTray.ts'

type Handler = (req: Request, res: Response) => Promise<void>

// Express 5 forwards a rejected promise, but going through `next` keeps the
// typed-error path identical for sync and async failures.
const asyncRoute = (handler: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next)
  }

/** Express 5 types a route param as string | string[]; ours are always single. */
const pathId = (value: string | string[]): string => (Array.isArray(value) ? value[0] : value)

export function createKeycapTrayRouter(repos: Repositories): Router {
  const router = Router()
  const { keycapTrays, keycapProjects, audit } = repos

  const note = (
    req: { method: string; path: string; requestId?: string },
    owner: { tenantId: string; oid: string },
    action: string,
    subject?: string,
  ) => {
    void audit.record({
      owner,
      category: 'keycap-tray',
      action,
      outcome: 'success',
      httpMethod: req.method,
      httpPath: req.path,
      httpStatus: 200,
      requestId: req.requestId ?? null,
      subject: subject ?? null,
    }).catch(() => { /* audit must never break a response */ })
  }

  /**
   * A tray may only be linked to a project the caller owns. The foreign key
   * proves the project exists; it cannot prove whose it is, so the check is
   * here. Called before the write so a rejected link is a 400, not a row.
   */
  const requireOwnedProject = async (
    owner: { tenantId: string; oid: string }, projectId: string | null | undefined,
  ): Promise<void> => {
    if (!projectId) return
    const project = await keycapProjects.get(owner, projectId)
    if (!project) throw ApiError.badRequest('project not found', { field: 'projectId' })
  }

  router.get('/', asyncRoute(async (req, res) => {
    // `?projectId=` selects one project and `?projectId=none` the unassigned
    // trays, which is what the "add an existing tray" picker lists.
    const raw = req.query.projectId
    const filter = raw === undefined
      ? undefined
      : raw === 'none'
        ? null
        : String(raw)
    res.json(await keycapTrays.listDesigns(ownerOf(req), filter))
  }))

  // The library routes must be declared before the /:id routes below: Express
  // matches in order, so '/library/pockets' would otherwise be captured by
  // '/:id' with id = 'library'.
  router.get('/library/pockets', asyncRoute(async (req, res) => {
    res.json(await keycapTrays.listLibraryPockets(ownerOf(req)))
  }))

  router.post('/library/pockets', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const input = validateLibraryPocketInput(req.body ?? {})
    try {
      const created = await keycapTrays.createLibraryPocket(owner, input)
      note(req, owner, 'library_pocket_created', created.id)
      res.status(201).json(created)
    } catch (error) {
      if (error instanceof DuplicateLibraryPocketError) {
        throw ApiError.conflict(error.message, { name: error.pocketName })
      }
      throw error
    }
  }))

  router.delete('/library/pockets/:id', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const removed = await keycapTrays.deleteLibraryPocket(owner, pathId(req.params.id))
    if (!removed) throw ApiError.notFound('pocket not found')
    note(req, owner, 'library_pocket_deleted', pathId(req.params.id))
    res.json({ ok: true })
  }))

  router.get('/:id', asyncRoute(async (req, res) => {
    const design = await keycapTrays.getDesign(ownerOf(req), pathId(req.params.id))
    if (!design) throw ApiError.notFound('design not found')
    res.json(design)
  }))

  router.post('/', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const input = validateTrayDesignInput(req.body ?? {})
    await requireOwnedProject(owner, input.projectId)
    try {
      const created = await keycapTrays.createDesign(owner, input)
      note(req, owner, 'design_created', created.id)
      res.status(201).json(created)
    } catch (error) {
      if (error instanceof InvalidProfileError) throw ApiError.badRequest(error.message)
      throw error
    }
  }))

  router.put('/:id', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const input = validateTrayDesignInput(req.body ?? {})
    await requireOwnedProject(owner, input.projectId)
    try {
      const updated = await keycapTrays.updateDesign(owner, pathId(req.params.id), input)
      if (!updated) throw ApiError.notFound('design not found')
    } catch (error) {
      if (error instanceof InvalidProfileError) throw ApiError.badRequest(error.message)
      throw error
    }
    note(req, owner, 'design_updated', pathId(req.params.id))
    res.json({ ok: true })
  }))

  // Cloning is one transaction so a duplicate is never half-created.
  router.post('/:id/clone', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const requested = validateCloneRequest(req.body ?? {})
    // A copy dropped into another project may only land in one the caller owns,
    // for the same reason a design write is checked: the foreign key proves the
    // project exists, not whose it is.
    await requireOwnedProject(owner, requested.projectId ?? undefined)
    const created = await keycapTrays.cloneDesign(
      owner, pathId(req.params.id), requested.name, requested.projectId)
    if (!created) throw ApiError.notFound('design not found')
    note(req, owner, 'design_cloned', created.id)
    res.status(201).json(created)
  }))

  router.delete('/:id', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const removed = await keycapTrays.deleteDesign(owner, pathId(req.params.id))
    if (!removed) throw ApiError.notFound('design not found')
    note(req, owner, 'design_deleted', pathId(req.params.id))
    res.json({ ok: true })
  }))

  return router
}
