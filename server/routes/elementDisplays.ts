import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { RequestHandler } from 'express'
import type { Repositories } from '../../lib/db/repositories/contracts.ts'
import type { DisplaySnapshot, DisplayStatus } from '../../lib/contracts/elementDisplay.ts'
import type { ElementStatus } from '../../lib/contracts/elementStatistics.ts'
import type { ElementMonitor } from '../element/monitor.ts'
import { ownerOf } from '../auth/requireAuth.ts'
import { ApiError } from '../errors/ApiError.ts'

const MINUTE = 60_000
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const iso = (ms: number) => new Date(ms).toISOString()

function noStore(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('referrer-policy', 'no-referrer')
    next()
  }
}

/** One bounded process-wide budget: this deployment is deliberately single-writer. */
function budget(limit: number): RequestHandler {
  let start = Date.now()
  let used = 0
  return (_req, res, next) => {
    if (Date.now() - start >= MINUTE) { start = Date.now(); used = 0 }
    if (++used > limit) {
      res.setHeader('retry-after', '60')
      next(new ApiError(429, 'display_rate_limit', 'Too many display requests. Retry in a minute.'))
    } else next()
  }
}

export function displaySnapshot(status: ElementStatus): DisplaySnapshot | null {
  const s = status.snapshot
  if (!s || status.snapshotConnectionId !== status.settings.activeConnectionId) return null
  return {
    receivedAt: s.receivedAt, state: s.state, jobName: s.jobName,
    progressPercent: s.progressPercent, remainingMinutes: s.remainingMinutes,
    currentLayer: s.currentLayer, totalLayers: s.totalLayers,
    nozzleActualC: s.nozzleActualC, nozzleTargetC: s.nozzleTargetC,
    bedActualC: s.bedActualC, bedTargetC: s.bedTargetC,
    printError: s.printError, hms: s.hms?.map(issue => ({ code: issue.code, attribute: issue.attribute })) ?? null,
  }
}

interface Options { repos: Repositories; monitor: ElementMonitor }

export function createElementDisplayRouter({ repos, monitor }: Options): Router {
  const router = Router()
  router.use(noStore())
  router.post('/pairings', budget(10), async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Object.keys(req.body).length !== 0 || Array.isArray(req.body)) {
      throw ApiError.badRequest('An empty JSON object is required.')
    }
    const now = Date.now()
    const credential = randomBytes(32).toString('hex')
    const code = randomBytes(5).toString('hex').toUpperCase()
    const expiresAt = iso(now + 10 * MINUTE)
    if (!await repos.elementDisplays.create(randomUUID(), hash(credential), code, iso(now), expiresAt)) {
      throw ApiError.unavailable('Display pairing capacity reached. Wait for pending codes to expire.')
    }
    res.status(201).json({ credential, code, expiresAt })
  })
  router.get('/status', budget(600), async (req, res) => {
    const match = /^Display ([a-f0-9]{64})$/.exec(req.get('authorization') ?? '')
    if (!match) throw ApiError.unauthorized('A paired display credential is required.')
    const display = await repos.elementDisplays.find(hash(match[1]), iso(Date.now()))
    if (!display) throw ApiError.unauthorized('Display access expired or was revoked. Pair this display again.')
    if (!display.owner) {
      res.json({
        paired: false, expiresAt: display.expiresAt, printerName: null,
        connectionState: 'unconfigured', freshness: 'unavailable', snapshot: null,
      } satisfies DisplayStatus)
      return
    }
    const member = await repos.memberships.find(display.owner)
    if (member?.role !== 'admin') throw ApiError.unauthorized('The approving administrator no longer has access. Pair again.')
    const status = await monitor.status()
    // A display is pinned to the approved household connection, never whatever is selected next.
    const active = status.settings.activeConnectionId === display.connectionId
    const snapshot = active && status.settings.enabled ? displaySnapshot(status) : null
    res.json({
      paired: true, expiresAt: display.expiresAt,
      printerName: active ? status.connections.find(item => item.id === display.connectionId)?.printerName ?? null : null,
      connectionState: active ? status.connectionState : 'selection_required',
      freshness: snapshot ? status.freshness : 'unavailable',
      snapshot,
    } satisfies DisplayStatus)
  })
  return router
}

/** Always mounted behind Entra authentication AND a database-rechecked admin role. */
export function createElementDisplayAdminRouter({ repos, monitor }: Options): Router {
  const router = Router()
  router.use(noStore())
  router.get('/', async (req, res) => {
    res.json(await repos.elementDisplays.list(ownerOf(req), iso(Date.now())))
  })
  router.post('/approve', budget(20), async (req, res) => {
    const body: unknown = req.body
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw ApiError.badRequest('A JSON object is required.')
    const value = body as Record<string, unknown>
    if (Object.keys(value).some(key => !['code', 'label'].includes(key))
      || typeof value.code !== 'string' || !/^[A-F0-9]{10}$/.test(value.code)
      || typeof value.label !== 'string' || !value.label.trim() || value.label.trim().length > 80) {
      throw ApiError.badRequest('Enter the 10-character display code and a name of 1–80 characters.')
    }
    const status = await monitor.status()
    if (!status.settings.enabled || !status.settings.activeConnectionId) {
      throw ApiError.conflict('Enable and select the household printer before pairing a display.')
    }
    const owner = ownerOf(req)
    if (!await repos.elementDisplays.approve(value.code, owner, status.settings.activeConnectionId,
      value.label.trim(), iso(Date.now()), iso(Date.now() + 90 * 24 * 60 * MINUTE))) {
      throw ApiError.notFound('That pairing code expired or was already used. Start pairing again on the display.')
    }
    await repos.audit.record({
      owner, category: 'element_display', action: 'paired', outcome: 'success', requestId: req.requestId,
    })
    res.status(204).end()
  })
  router.delete('/:id', async (req, res) => {
    if (!/^[a-f0-9-]{36}$/.test(req.params.id)) throw ApiError.badRequest('Invalid display ID.')
    const owner = ownerOf(req)
    if (!await repos.elementDisplays.revoke(req.params.id, owner)) throw ApiError.notFound('Display not found.')
    await repos.audit.record({
      owner, category: 'element_display', action: 'revoked', outcome: 'success', requestId: req.requestId,
    })
    res.status(204).end()
  })
  return router
}
