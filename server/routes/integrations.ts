// Service-to-service reads for the owner's other apps.
//
// Workshop's Library hub links Bambu Cloud print jobs to the 3D model files on
// the owner's Mac, so it needs the job ledger this app already keeps. That is a
// server calling a server, so it cannot use the owner's Entra session: it
// presents a shared key (`Authorization: Integration <key>`) that only unlocks
// this read-only, whitelisted projection of the ledger. With no key configured
// the routes answer 503 and reveal nothing.
import { timingSafeEqual, createHash } from 'node:crypto'
import { Router } from 'express'
import type { Request } from 'express'
import type { Repositories } from '../../lib/db/repositories/contracts.ts'
import { elementElapsedSeconds } from '../../lib/contracts/elementStatistics.ts'
import type { ElementJob } from '../../lib/contracts/elementStatistics.ts'
import type { IntegrationConfig } from '../config.ts'
import { ApiError } from '../errors/ApiError.ts'

interface IntegrationRouterOptions {
  repos: Repositories
  config: IntegrationConfig
}

/** Jobs are re-sent for this long after `since`, so late results (active -> completed) still arrive. */
const OVERLAP_MS = 3 * 24 * 60 * 60 * 1000
const PAGE_LIMIT = 1000

export interface IntegrationPrintJob {
  id: string
  title: string | null
  result: ElementJob['result']
  startedAt: string | null
  endedAt: string | null
  seconds: number | null
  estimatedSeconds: number | null
  grams: number | null
  materials: { material: string | null; color: string | null; grams: number | null }[]
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function authorized(req: Request, key: string): boolean {
  const match = /^Integration (\S+)$/.exec(req.get('authorization') ?? '')
  // Compare fixed-length digests so neither length nor content leaks through timing.
  return Boolean(match) && timingSafeEqual(digest(match![1]), digest(key))
}

export function integrationPrintJob(job: ElementJob): IntegrationPrintJob {
  return {
    // The ledger key is (connection, cloud job); both are needed to be unique.
    id: `${job.connectionId}:${job.id}`,
    title: job.title,
    result: job.result,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    seconds: job.actualDurationSeconds
      ?? elementElapsedSeconds(job.result, job.startedAt, job.endedAt, job.lastSeenAt),
    estimatedSeconds: job.estimatedDurationSeconds,
    grams: job.estimatedWeightGrams,
    materials: job.materials.map(m => ({
      material: m.material, color: m.color, grams: m.estimatedWeightGrams,
    })),
  }
}

export function createIntegrationRouter({ repos, config }: IntegrationRouterOptions): Router {
  const router = Router()
  router.use((_req, res, next) => {
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-content-type-options', 'nosniff')
    next()
  })

  router.get('/print-jobs', async (req, res) => {
    if (!config.printJobsKey) throw ApiError.unavailable('Print history integration is not configured.')
    if (!authorized(req, config.printJobsKey)) throw ApiError.unauthorized('Invalid integration key.')
    const since = typeof req.query.since === 'string' ? Date.parse(req.query.since) : NaN
    if (req.query.since !== undefined && !Number.isFinite(since)) {
      throw ApiError.badRequest('since must be an ISO timestamp.')
    }
    const cursor = new Date().toISOString()
    const bounds = Number.isFinite(since)
      ? { fromInclusive: new Date(since - OVERLAP_MS).toISOString() }
      : undefined
    const jobs = await repos.elementStatistics.listJobs(null, PAGE_LIMIT + 1, bounds)
    res.json({
      cursor,
      truncated: jobs.length > PAGE_LIMIT,
      jobs: jobs.slice(0, PAGE_LIMIT).map(integrationPrintJob),
    })
  })

  return router
}
