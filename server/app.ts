// Express application construction. This module never listens; bootstrap.ts
// owns the socket and the lifecycle.
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import express from 'express'
import type { Express } from 'express'
import type { AppDatabase } from '../lib/db/connection.ts'
import type { Repositories } from '../lib/db/repositories/contracts.ts'
import type { Lifecycle } from '../lib/health/readiness.ts'
import type { BuildIdentity } from '../lib/lineage/buildIdentity.ts'
import type { AppConfig } from './config.ts'
import { requireAuth } from './auth/requireAuth.ts'
import { requireRole } from './auth/requireRole.ts'
import type { TokenVerifier } from './auth/verifyToken.ts'
import { createTokenVerifier } from './auth/verifyToken.ts'
import { createErrorMiddleware, notFoundHandler } from './errors/errorMiddleware.ts'
import { createAdminRouter } from './routes/admin.ts'
import { createAuditAdminRouter, createAuditRouter } from './routes/audit.ts'
import { createHealthRouter } from './routes/health.ts'
import { createKeycapTrayRouter } from './routes/keycapTrays.ts'
import { createSettingsRouter } from './routes/settings.ts'
import { createVersionRouter } from './routes/version.ts'

export interface CreateAppOptions {
  config: AppConfig
  identity: BuildIdentity
  repos: Repositories
  database: () => AppDatabase | null
  lifecycle: () => Lifecycle
  startedAtMs?: number
  /** Injectable for tests; defaults to real JWKS verification. */
  verifier?: TokenVerifier | null
  logger?: (message: string, error: unknown) => void
}

const JSON_LIMIT = '2mb'

export function createApp(options: CreateAppOptions): Express {
  const { config, identity, repos } = options
  const startedAtMs = options.startedAtMs ?? Date.now()

  const verifier = options.verifier !== undefined
    ? options.verifier
    : createTokenVerifier(config.auth)

  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)

  app.use((req, res, next) => {
    req.requestId = req.get('x-request-id')?.slice(0, 64) || randomUUID()
    res.setHeader('x-request-id', req.requestId)
    next()
  })

  app.use(express.json({ limit: JSON_LIMIT }))

  // Unauthenticated: process liveness, bounded readiness, immutable identity.
  app.use('/api', createHealthRouter({
    identity,
    startedAtMs,
    lifecycle: options.lifecycle,
    database: options.database,
  }))
  app.use(createVersionRouter(identity))

  const authenticated = requireAuth({
    auth: config.auth,
    verifier,
    memberships: repos.memberships,
  })
  const adminOnly = requireRole('admin', repos.memberships)

  app.use('/api/keycap-trays', authenticated, createKeycapTrayRouter(repos))
  app.use('/api/settings', authenticated, createSettingsRouter(repos))
  app.use('/api/audit', authenticated, createAuditRouter(repos))
  app.use('/api/admin/audit', authenticated, adminOnly, createAuditAdminRouter(repos))
  app.use('/api/admin', authenticated, adminOnly, createAdminRouter({
    repos,
    identity,
    database: options.database,
    lifecycle: options.lifecycle,
  }))

  app.use('/api', notFoundHandler)

  // Same-origin SPA in production. Real URL routing means every unmatched
  // non-API path has to fall through to the shell.
  if (existsSync(config.clientDir)) {
    app.use(express.static(config.clientDir, { index: false, maxAge: '1h' }))
    app.get(/.*/, (req, res, next) => {
      if (req.path.startsWith('/api/')) return next()
      res.sendFile(join(config.clientDir, 'index.html'))
    })
  }

  app.use(createErrorMiddleware({ audit: repos.audit, logger: options.logger }))

  return app
}
