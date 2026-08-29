import { Router } from 'express'
import type { BuildIdentity } from '../../lib/lineage/buildIdentity.ts'

/**
 * `/api/version` and `/version.json` serve the identical immutable object, so
 * a deployed instance's build and Hearth source lineage can never disagree
 * depending on which one is asked.
 */
export function createVersionRouter(identity: BuildIdentity): Router {
  const router = Router()
  const body = Object.freeze({
    ...identity,
    sha: identity.commit,
    buildId: identity.build,
  })

  router.get('/api/version', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json(body)
  })
  router.get('/version.json', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json(body)
  })

  return router
}
