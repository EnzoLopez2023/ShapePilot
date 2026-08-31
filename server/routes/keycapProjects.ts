// Keycap project HTTP routes.
//
// A project is one keycap set: what it holds, photographs of it, and the trays
// cut for it. Everything here is scoped to the caller's `(tenant_id, oid)`, and
// every write body is validated completely before a repository call opens a
// transaction.
//
// Photos are attached by content hash, never by upload: the bytes go through
// PUT /api/design-assets/:hash like any other asset, and this route records the
// link only after proving the caller owns that hash and that it names an image.
// A hash is content, not a capability.
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import type { Repositories } from '../../lib/db/repositories/contracts.ts'
import { isImageAssetFormat } from '../../lib/db/repositories/contracts.ts'
import { ApiError } from '../errors/ApiError.ts'
import { ownerOf } from '../auth/requireAuth.ts'
import {
  LIMITS, validateKeycapProjectInput, validateProjectPhotoInput,
} from '../validation/keycapProject.ts'

type Handler = (req: Request, res: Response) => Promise<void>

const asyncRoute = (handler: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next)
  }

const pathId = (value: string | string[]): string => (Array.isArray(value) ? value[0] : value)

/** Row ids are integers in SQLite and strings on the wire. */
const ROW_ID = /^[0-9]{1,19}$/

export function createKeycapProjectRouter(repos: Repositories): Router {
  const router = Router()
  const { keycapProjects, designAssets, audit } = repos

  const note = (
    req: { method: string; path: string; requestId?: string },
    owner: { tenantId: string; oid: string },
    action: string,
    subject?: string,
  ) => {
    void audit.record({
      owner,
      category: 'keycap-project',
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
    res.json(await keycapProjects.list(ownerOf(req)))
  }))

  router.get('/:id', asyncRoute(async (req, res) => {
    // `?excludeTray=` leaves one tray out of the coverage count. The designer
    // holds that tray's pockets in memory, unsaved edits included, and adding
    // the stale saved copy on top would count them twice.
    const raw = req.query.excludeTray
    const excludeTrayId = typeof raw === 'string' && ROW_ID.test(raw) ? raw : undefined
    const project = await keycapProjects.get(
      ownerOf(req), pathId(req.params.id), excludeTrayId)
    if (!project) throw ApiError.notFound('project not found')
    res.json(project)
  }))

  router.post('/', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const input = validateKeycapProjectInput(req.body ?? {})
    const created = await keycapProjects.create(owner, input)
    note(req, owner, 'project_created', created.id)
    res.status(201).json(created)
  }))

  router.put('/:id', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const input = validateKeycapProjectInput(req.body ?? {})
    const updated = await keycapProjects.update(owner, pathId(req.params.id), input)
    if (!updated) throw ApiError.notFound('project not found')
    note(req, owner, 'project_updated', pathId(req.params.id))
    res.json({ ok: true })
  }))

  // Items and photos cascade. The project's trays do not: they are unassigned
  // by the ON DELETE SET NULL on keycap_tray_designs.project_id, because
  // deleting the description of a set must not destroy the designs cut for it.
  router.delete('/:id', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const removed = await keycapProjects.remove(owner, pathId(req.params.id))
    if (!removed) throw ApiError.notFound('project not found')
    note(req, owner, 'project_deleted', pathId(req.params.id))
    res.json({ ok: true })
  }))

  router.post('/:id/photos', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const id = pathId(req.params.id)
    const photo = validateProjectPhotoInput(req.body ?? {})

    const project = await keycapProjects.get(owner, id)
    if (!project) throw ApiError.notFound('project not found')
    if (project.photos.length >= LIMITS.maxPhotos
      && !project.photos.some(p => p.hash === photo.hash)) {
      throw ApiError.conflict(`a project holds at most ${LIMITS.maxPhotos} photos`)
    }

    // Owner-scoped, so knowing someone else's hash reveals nothing and links
    // nothing. The format check keeps an STL out of a photo strip.
    const asset = await designAssets.find(owner, photo.hash)
    if (!asset) throw ApiError.notFound('asset not found')
    if (!isImageAssetFormat(asset.format)) {
      throw ApiError.badRequest('that asset is not an image', { field: 'hash' })
    }

    const attached = await keycapProjects.addPhoto(owner, id, photo)
    if (!attached) throw ApiError.notFound('project not found')
    note(req, owner, 'project_photo_added', photo.hash)
    res.status(201).json({ ok: true })
  }))

  router.delete('/:id/photos/:hash', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    // Metadata only: the bytes stay in the content-addressed store, where
    // another project may still reference them.
    const removed = await keycapProjects.removePhoto(
      owner, pathId(req.params.id), pathId(req.params.hash))
    if (!removed) throw ApiError.notFound('photo not found')
    note(req, owner, 'project_photo_removed', pathId(req.params.hash))
    res.json({ ok: true })
  }))

  return router
}
