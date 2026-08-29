import { Router } from 'express'
import type { AppDatabase } from '../../lib/db/connection.ts'
import { liveness, readiness } from '../../lib/health/readiness.ts'
import type { Lifecycle } from '../../lib/health/readiness.ts'
import type { BuildIdentity } from '../../lib/lineage/buildIdentity.ts'

export interface HealthRouterOptions {
  identity: BuildIdentity
  startedAtMs: number
  lifecycle: () => Lifecycle
  database: () => AppDatabase | null
}

/**
 * `/api/live` is process-only and never opens or queries the database.
 * `/api/ready` runs one bounded probe plus a schema-identity comparison.
 * Neither performs integrity checks, backup, repair or any unbounded work.
 */
export function createHealthRouter(options: HealthRouterOptions): Router {
  const router = Router()

  router.get('/live', (_req, res) => {
    res.json(liveness(options.identity, options.lifecycle(), options.startedAtMs))
  })

  router.get('/ready', (_req, res) => {
    const report = readiness(options.identity, options.lifecycle(), options.database())
    res.status(report.status === 'ready' ? 200 : 503).json(report)
  })

  return router
}
