// Design-document HTTP routes, shared by the Shaper, Bambu and Playground
// sub-apps.
//
// Same shape as the keycap tray routes: authenticated, scoped to the caller's
// `(tenant_id, oid)`, every write body validated in full before the repository
// is touched, and a fire-and-forget audit note that can never break a response.
//
// Only parameters cross this boundary. Meshes, STL and SVG output and imported
// binaries stay in the browser, which is what keeps the server free of geometry.
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import type { Repositories } from '../../lib/db/repositories/contracts.ts'
import { ApiError } from '../errors/ApiError.ts'
import { ownerOf } from '../auth/requireAuth.ts'
import {
  validateCloneRequest, validateDesignDocumentInput, validateKindQuery,
} from '../validation/designDocument.ts'

type Handler = (req: Request, res: Response) => Promise<void>

const asyncRoute = (handler: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next)
  }

/** Express 5 types a route param as string | string[]; ours are always single. */
const pathId = (value: string | string[]): string => (Array.isArray(value) ? value[0] : value)

export function createDesignDocumentRouter(repos: Repositories): Router {
  const router = Router()
  const { designDocuments, audit } = repos

  const note = (
    req: { method: string; path: string; requestId?: string },
    owner: { tenantId: string; oid: string },
    action: string,
    subject?: string,
  ) => {
    void audit.record({
      owner,
      category: 'design-document',
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
    const kind = validateKindQuery(req.query.kind)
    res.json(await designDocuments.list(ownerOf(req), kind))
  }))

  router.get('/:id', asyncRoute(async (req, res) => {
    const record = await designDocuments.get(ownerOf(req), pathId(req.params.id))
    if (!record) throw ApiError.notFound('design document not found')

    // doc_json is stored validated, so it is re-hydrated rather than re-parsed
    // field by field. `id` comes from the row and `revision` starts at 0 --
    // history is client-side state and never round-trips.
    res.json({
      ...(JSON.parse(record.docJson) as Record<string, unknown>),
      id: record.id,
      kind: record.kind,
      name: record.name,
      notes: record.notes ?? undefined,
      revision: 0,
    })
  }))

  router.post('/', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const input = validateDesignDocumentInput(req.body ?? {})
    const created = await designDocuments.create(owner, input)
    note(req, owner, 'document_created', created.id)
    res.status(201).json(created)
  }))

  router.put('/:id', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const id = pathId(req.params.id)
    const input = validateDesignDocumentInput(req.body ?? {})
    const updated = await designDocuments.update(owner, id, input)
    if (!updated) throw ApiError.notFound('design document not found')
    note(req, owner, 'document_updated', id)
    res.json({ ok: true })
  }))

  router.post('/:id/clone', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const id = pathId(req.params.id)
    const { name, kind } = validateCloneRequest(req.body ?? {})
    const created = await designDocuments.clone(owner, id, name, kind)
    if (!created) throw ApiError.notFound('design document not found')
    // A clone that retargets the kind is the "continue in another designer"
    // handoff, so the audit subject records both ends.
    note(req, owner, 'document_cloned', `${id}->${created.id}`)
    res.status(201).json(created)
  }))

  router.delete('/:id', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const id = pathId(req.params.id)
    const removed = await designDocuments.remove(owner, id)
    if (!removed) throw ApiError.notFound('design document not found')
    note(req, owner, 'document_deleted', id)
    res.json({ ok: true })
  }))

  return router
}
