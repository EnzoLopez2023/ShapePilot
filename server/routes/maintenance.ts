// X2D maintenance HTTP routes.
//
// One GET returns the whole page: the profile and the entire service log. That
// is deliberate rather than lazy -- the log is a dozen tasks' worth of dated
// rows for a printer one person owns, every due date on the calendar is derived
// from it, and paginating it would mean the page could not colour next month
// until it had fetched more. When a log ever does grow past that, the fix is a
// bounded window here, not a second round trip on first paint.
//
// The catalogue itself never travels. The client has it compiled in, exactly as
// it has the filament catalogue; what crosses the wire is only which jobs this
// account has done and when.
//
// Due dates are computed on the client, not here. They are a pure function of
// (profile, events, today) over a catalogue both sides hold, and a server that
// also computed them would be a second implementation to keep in step -- one
// that would additionally have to guess the reader's timezone to know what
// "today" means.
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import type { Repositories } from '../../lib/db/repositories/contracts.ts'
import { ApiError } from '../errors/ApiError.ts'
import { ownerOf } from '../auth/requireAuth.ts'
import {
  validateEventId,
  validateMaintenanceEventInput,
  validateMaintenanceProfileInput,
} from '../validation/maintenance.ts'

type Handler = (req: Request, res: Response) => Promise<void>

const asyncRoute = (handler: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next)
  }

/** Express 5 types a route param as string | string[]; ours are always single. */
const pathId = (value: string | string[]): string => (Array.isArray(value) ? value[0] : value)

export function createMaintenanceRouter(repos: Repositories): Router {
  const router = Router()
  const { maintenance, audit } = repos

  const note = (
    req: { method: string; path: string; requestId?: string },
    owner: { tenantId: string; oid: string },
    action: string,
    detail?: Record<string, unknown>,
  ) => {
    void audit.record({
      owner,
      category: 'maintenance',
      action,
      outcome: 'success',
      httpMethod: req.method,
      httpPath: req.path,
      httpStatus: 200,
      requestId: req.requestId ?? null,
      detail: detail ?? null,
    }).catch(() => { /* audit must never break a response */ })
  }

  router.get('/', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    // Both halves in one read. A page that had the log but not the profile
    // could not date a single row, so there is no useful half to send.
    const [profile, events] = await Promise.all([
      maintenance.readProfile(owner),
      maintenance.listEvents(owner),
    ])
    res.json({ profile, events })
  }))

  router.put('/profile', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const input = validateMaintenanceProfileInput(req.body)
    const profile = await maintenance.writeProfile(owner, input)
    note(req, owner, 'profile_updated', {
      usageTier: profile.usageTier,
      filamentWear: profile.filamentWear,
    })
    res.json(profile)
  }))

  router.post('/events', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const input = validateMaintenanceEventInput(req.body)
    const event = await maintenance.logEvent(owner, input)
    // The task and the date, never the note: audit detail is bounded and
    // redacted, and a free-text note is the one field here that is neither.
    note(req, owner, 'service_logged', {
      taskKey: event.taskKey,
      performedOn: event.performedOn,
    })
    res.status(201).json(event)
  }))

  router.delete('/events/:id', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const id = validateEventId(pathId(req.params.id))
    // Owner-scoped in the delete itself, so another account's row reads as
    // absent rather than as forbidden -- the same answer either way, and this
    // way without confirming the row exists.
    if (!await maintenance.deleteEvent(owner, id)) {
      throw ApiError.notFound('service record not found')
    }
    note(req, owner, 'service_deleted', { id })
    res.json({ ok: true })
  }))

  return router
}
