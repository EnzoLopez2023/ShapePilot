// Express application construction. This module never listens; bootstrap.ts
// owns the socket and the lifecycle.
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
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
import type { ArtifactStore } from '../lib/recovery/artifactStore.ts'
import type { FoundryClient } from './ai/foundryClient.ts'
import { createFoundryClient } from './ai/foundryClient.ts'
import { createAiRouter } from './routes/ai.ts'
import { createFilesystemArtifactStore } from '../lib/recovery/artifactStore.ts'
import { createDesignAssetRouter } from './routes/designAssets.ts'
import { createDesignDocumentRouter } from './routes/designDocuments.ts'
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
  instanceId?: string
  /** Injectable for tests; defaults to real JWKS verification. */
  verifier?: TokenVerifier | null
  /** Injectable for tests; defaults to a client built from config.ai, which is
   *  null when the Foundry resource is not configured. */
  aiClient?: FoundryClient | null
  /** Injectable for tests; defaults to the filesystem store at config.assetStoreDir. */
  assetStore?: ArtifactStore
  logger?: (message: string, error: unknown) => void
}

const JSON_LIMIT = '2mb'

/**
 * Memoized, and only touched when an asset route is actually used. Production
 * storage validation creates this directory up front; creating it here as well
 * is what lets a development or test server work without one.
 */
function assetStore(injected: ArtifactStore | undefined, dir: string): () => ArtifactStore {
  if (injected) return () => injected
  let store: ArtifactStore | null = null
  return () => {
    if (!store) {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      store = createFilesystemArtifactStore(dir)
    }
    return store
  }
}

export function createApp(options: CreateAppOptions): Express {
  const { config, identity, repos } = options
  const startedAtMs = options.startedAtMs ?? Date.now()
  const instanceId = options.instanceId ?? randomUUID()

  const verifier = options.verifier !== undefined
    ? options.verifier
    : createTokenVerifier(config.auth)

  // Built once: DefaultAzureCredential caches tokens internally, so a
  // per-request client would re-acquire needlessly.
  const aiClient = options.aiClient !== undefined
    ? options.aiClient
    : createFoundryClient(config.ai)

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
    instanceId,
  }))
  app.use(createVersionRouter(identity))

  const authenticated = requireAuth({
    auth: config.auth,
    verifier,
    memberships: repos.memberships,
  })
  const adminOnly = requireRole('admin', repos.memberships)

  app.use('/api/keycap-trays', authenticated, createKeycapTrayRouter(repos))
  app.use('/api/design-documents', authenticated, createDesignDocumentRouter(repos))
  // Asset bytes never touch express.json, which only parses application/json;
  // an octet-stream body passes straight through to this route's own raw
  // parser, which has its own much larger limit.
  app.use('/api/design-assets', authenticated, createDesignAssetRouter({
    repos,
    store: assetStore(options.assetStore, config.assetStoreDir),
  }))
  app.use('/api/ai', authenticated, createAiRouter({ repos, client: aiClient }))
  app.use('/api/settings', authenticated, createSettingsRouter(repos))
  app.use('/api/audit', authenticated, createAuditRouter(repos))
  app.use('/api/admin/audit', authenticated, adminOnly, createAuditAdminRouter(repos))
  app.use('/api/admin', authenticated, adminOnly, createAdminRouter({
    repos,
    identity,
    database: options.database,
    lifecycle: options.lifecycle,
    instanceId,
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
