// Imported design assets: the bytes behind an `imported` scene object.
//
// Two deliberate properties, both load-bearing:
//
//   * Assets are NOT authoritative. The backup manifest describes one SQLite
//     file and nothing here changes that. A missing asset degrades to
//     "re-attach this file", exactly as it does when a document is opened on a
//     browser that never imported it, so losing one never breaks a document.
//   * A content hash is not a capability. Every lookup is scoped by
//     `(tenant_id, oid)`, so knowing another owner's hash reveals nothing.
import { createHash } from 'node:crypto'
import { Router, raw } from 'express'
import type { NextFunction, Request, Response } from 'express'
import type { DesignAssetFormat, Repositories } from '../../lib/db/repositories/contracts.ts'
import { DESIGN_ASSET_FORMATS } from '../../lib/db/repositories/contracts.ts'
import type { ArtifactStore } from '../../lib/recovery/artifactStore.ts'
import { ArtifactStoreError } from '../../lib/recovery/artifactStore.ts'
import { ApiError } from '../errors/ApiError.ts'
import { ownerOf } from '../auth/requireAuth.ts'

/**
 * Matches MAX_IMPORT_BYTES in src/import/index.ts, so the browser never accepts
 * a file the server will then refuse.
 */
export const MAX_ASSET_BYTES = 64 * 1024 * 1024
const RAW_LIMIT = '64mb'

const HEX64 = /^[0-9a-f]{64}$/
const PATH_LIKE = /[/\\]/

type Handler = (req: Request, res: Response) => Promise<void>

const asyncRoute = (handler: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next)
  }

const pathParam = (value: string | string[]): string => (Array.isArray(value) ? value[0] : value)

/** Owner-scoped so two accounts holding identical bytes never share an object. */
const objectKey = (owner: { tenantId: string; oid: string }, hash: string): string =>
  `${owner.tenantId}/${owner.oid}/${hash}`

export interface AssetRouterOptions {
  repos: Repositories
  /** Matches the error middleware's logger; silenced in tests. */
  logger?: (message: string, error: unknown) => void
  /**
   * Resolved on first use, not at construction. The filesystem adapter acquires
   * its root eagerly, and an app that never stores an asset -- most test
   * servers, and a fresh deployment before the first import -- should not need
   * the directory to exist yet.
   */
  store: () => ArtifactStore
}

export function createDesignAssetRouter(
  { repos, store, logger }: AssetRouterOptions,
): Router {
  const router = Router()
  const { designAssets, audit } = repos
  const log = logger ?? ((message: string, error: unknown) => {
    console.error(message, error instanceof Error ? error.message : error)
  })

  router.get('/', asyncRoute(async (req, res) => {
    res.json(await designAssets.list(ownerOf(req)))
  }))

  router.get('/:hash', asyncRoute(async (req, res) => {
    const owner = ownerOf(req)
    const hash = pathParam(req.params.hash)
    if (!HEX64.test(hash)) throw ApiError.notFound('asset not found')

    const record = await designAssets.find(owner, hash)
    if (!record) throw ApiError.notFound('asset not found')

    let bytes: Uint8Array
    try {
      bytes = await store().get(objectKey(owner, hash))
    } catch (cause) {
      // Metadata without bytes is a real state, since assets are deliberately
      // outside the backup manifest. It reads as absent so the client falls
      // back to asking for the file again.
      if (cause instanceof ArtifactStoreError) throw ApiError.notFound('asset not found')
      throw cause
    }

    res.setHeader('content-type', 'application/octet-stream')
    res.setHeader('content-length', String(bytes.byteLength))
    // Content-addressed, so the bytes behind a hash can never change.
    res.setHeader('cache-control', 'private, max-age=31536000, immutable')
    res.end(Buffer.from(bytes))
  }))

  router.put(
    '/:hash',
    raw({ type: () => true, limit: RAW_LIMIT }),
    asyncRoute(async (req, res) => {
      const owner = ownerOf(req)
      const hash = pathParam(req.params.hash)
      if (!HEX64.test(hash)) {
        throw new ApiError(400, 'bad_request', 'hash must be a SHA-256 hex digest',
          { field: 'hash' })
      }

      const body: unknown = req.body
      if (!Buffer.isBuffer(body) || body.byteLength === 0) {
        throw new ApiError(400, 'bad_request', 'a request body is required', { field: 'body' })
      }
      if (body.byteLength > MAX_ASSET_BYTES) {
        throw new ApiError(413, 'payload_too_large', 'the file is too large to store')
      }

      // The hash names the content, so it is verified rather than trusted: a
      // mismatch would make the store's addressing a lie.
      const actual = createHash('sha256').update(body).digest('hex')
      if (actual !== hash) {
        throw new ApiError(400, 'bad_request', 'the body does not match the hash in the path',
          { field: 'hash' })
      }

      const format = assetFormat(req.query.format)
      const filename = assetFilename(req.query.filename)

      // The store creates exclusively -- right for backup bundles, which must
      // never be overwritten. Assets are content-addressed, so the same hash is
      // by definition the same bytes, and re-importing a file is an ordinary
      // thing to do. An object that is already there is success, and the write
      // is skipped rather than allowed to fail as a conflict.
      const key = objectKey(owner, hash)
      try {
        const present = await store().list(`${owner.tenantId}/${owner.oid}`)
        if (!present.includes(key)) await store().put(key, body)
      } catch (cause) {
        // A store that cannot be acquired or written to is a real operational
        // state -- a directory that is not there, a mount that refuses the
        // syscalls the guard uses -- and it is not the caller's fault. It says
        // so, with the store's own code, instead of collapsing to a bare 500
        // that leaves nothing to act on. Assets are non-authoritative by
        // design, so this fails one upload rather than the app.
        if (cause instanceof ArtifactStoreError) {
          // The error middleware logs only *unexpected* failures, so turning
          // this into a typed ApiError would silence the one line that says
          // which syscall the store refused. It is logged here instead.
          log('Artifact store refused a design-asset write:', cause)
          throw new ApiError(503, 'asset_store_unavailable',
            'the file store is not available; the design itself is unaffected',
            {
              reason: cause.code,
              // Safe to hand back for this code alone: an ARTIFACT_OPERATION_FAILED
              // message is the guard's own stderr, which is a fixed English
              // string plus `strerror(errno)` and carries no path or user data.
              // ARTIFACT_ROOT_INVALID's message embeds an fs error that does
              // name the path, so it stays server-side.
              ...(cause.code === 'ARTIFACT_OPERATION_FAILED'
                ? { refusal: cause.message.slice(0, 200) }
                : {}),
            })
        }
        throw cause
      }

      const record = await designAssets.record(owner, {
        hash, filename, format, byteLength: body.byteLength,
      })

      void audit.record({
        owner,
        category: 'design-asset',
        action: 'asset_stored',
        outcome: 'success',
        httpMethod: req.method,
        httpPath: req.path,
        httpStatus: 201,
        requestId: req.requestId ?? null,
        subject: hash,
        detail: JSON.stringify({ format, byteLength: body.byteLength }),
      }).catch(() => { /* audit must never break a response */ })

      res.status(201).json(record)
    }),
  )

  return router
}

function assetFormat(value: unknown): DesignAssetFormat {
  const raw = typeof value === 'string' ? value.toLowerCase() : ''
  if (!(DESIGN_ASSET_FORMATS as readonly string[]).includes(raw)) {
    throw new ApiError(400, 'bad_request',
      `format must be one of: ${DESIGN_ASSET_FORMATS.join(', ')}`, { field: 'format' })
  }
  return raw as DesignAssetFormat
}

function assetFilename(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) {
    throw new ApiError(400, 'bad_request', 'filename is required', { field: 'filename' })
  }
  if (raw.length > 400) {
    throw new ApiError(400, 'bad_request', 'filename is too long', { field: 'filename' })
  }
  // Display only -- it never reaches the filesystem, since the object key is
  // the hash -- but a stored path separator would still be a trap for a later
  // reader, so it is refused rather than quietly sanitised.
  if (PATH_LIKE.test(raw)) {
    throw new ApiError(400, 'bad_request', 'filename must not contain a path', { field: 'filename' })
  }
  return raw
}
