// Print links: hand a 3MF to Bambu Studio.
//
// Studio opens a model from a `bambustudio://open?file=<url>` link -- the one
// MakerWorld and Printables use -- by downloading that URL itself. It sends no
// credentials, so the URL has to work on its own. The browser uploads the 3MF
// it just built; the server keeps it in memory under a random token for a few
// minutes and serves it to anyone holding the link. The token is the only
// capability, it is 256 bits, it expires, and nothing is written to disk.
//
// Two routers because they sit either side of authentication: the upload is the
// signed-in user's, the download is Studio's.
import { randomBytes } from 'node:crypto'
import { Router, raw } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { ApiError } from '../errors/ApiError.ts'
import { ownerOf } from '../auth/requireAuth.ts'

export const PRINT_LINK_TTL_MS = 15 * 60 * 1000
export const MAX_PRINT_LINK_BYTES = 64 * 1024 * 1024
/** Live links per account; the oldest goes first. */
const MAX_LINKS_PER_OWNER = 5
/** Across everyone, so a burst cannot hold the process's memory hostage. */
const MAX_TOTAL_BYTES = 256 * 1024 * 1024

const TOKEN = /^[A-Za-z0-9_-]{43}$/
/** A 3MF is a zip. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

interface Entry {
  owner: string
  bytes: Buffer
  filename: string
  expiresAt: number
}

/** The in-memory store both routers share. `now` is injectable for tests. */
export class PrintLinkStore {
  private readonly entries = new Map<string, Entry>()
  private readonly now: () => number

  constructor(now: () => number = Date.now) { this.now = now }

  put(owner: string, bytes: Buffer, filename: string): { token: string; expiresAt: number } {
    this.sweep()
    const mine = [...this.entries].filter(([, e]) => e.owner === owner)
    for (const [token] of mine.slice(0, Math.max(0, mine.length - MAX_LINKS_PER_OWNER + 1))) this.entries.delete(token)
    // Oldest first out until there is room.
    for (const [token] of this.entries) {
      if (this.totalBytes() + bytes.byteLength <= MAX_TOTAL_BYTES) break
      this.entries.delete(token)
    }
    if (this.totalBytes() + bytes.byteLength > MAX_TOTAL_BYTES) {
      throw new ApiError(503, 'busy', 'too many files waiting to be opened; try again in a few minutes')
    }
    const token = randomBytes(32).toString('base64url')
    const expiresAt = this.now() + PRINT_LINK_TTL_MS
    this.entries.set(token, { owner, bytes, filename, expiresAt })
    return { token, expiresAt }
  }

  get(token: string): Entry | undefined {
    this.sweep()
    return this.entries.get(token)
  }

  get size(): number { return this.entries.size }

  private totalBytes(): number {
    let total = 0
    for (const e of this.entries.values()) total += e.bytes.byteLength
    return total
  }

  private sweep(): void {
    const now = this.now()
    for (const [token, e] of this.entries) if (e.expiresAt <= now) this.entries.delete(token)
  }
}

type Handler = (req: Request, res: Response) => void

const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction): void => {
  try { handler(req, res) } catch (error) { next(error) }
}

/** Letters, digits, dot, dash, underscore; never empty, always .3mf. */
export function printLinkFilename(raw: unknown): string {
  const stem = (typeof raw === 'string' ? raw : '')
    .replace(/\.3mf$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+|_+$/g, '')
    .slice(0, 80)
  return `${stem || 'model'}.3mf`
}

/** The signed-in side: POST a 3MF, get back the path Studio should fetch. */
export function createPrintLinkRouter(store: PrintLinkStore): Router {
  const router = Router()
  router.post('/', raw({ type: () => true, limit: MAX_PRINT_LINK_BYTES }), route((req, res) => {
    const { tenantId, oid } = ownerOf(req)
    const body: unknown = req.body
    if (!Buffer.isBuffer(body) || body.byteLength === 0) {
      throw new ApiError(400, 'bad_request', 'a 3MF body is required', { field: 'body' })
    }
    if (!ZIP_MAGIC.every((b, i) => body[i] === b)) {
      throw new ApiError(400, 'bad_request', 'the body is not a 3MF file', { field: 'body' })
    }
    const filename = printLinkFilename(req.query.name)
    const { token, expiresAt } = store.put(`${tenantId}/${oid}`, body, filename)
    res.status(201).json({
      path: `/api/print-links/files/${token}/${encodeURIComponent(filename)}`,
      expiresAt: new Date(expiresAt).toISOString(),
    })
  }))
  return router
}

/** Studio's side: the file behind a live token, to whoever has the link. */
export function createPrintLinkFileRouter(store: PrintLinkStore): Router {
  const router = Router()
  router.get('/:token/:file', route((req, res) => {
    const token = String(req.params.token)
    const entry = TOKEN.test(token) ? store.get(token) : undefined
    if (!entry) throw ApiError.notFound('this link has expired; open it from ShapePilot again')
    res.setHeader('content-type', 'model/3mf')
    res.setHeader('content-length', String(entry.bytes.byteLength))
    res.setHeader('content-disposition', `attachment; filename="${entry.filename}"`)
    res.setHeader('cache-control', 'no-store')
    res.setHeader('referrer-policy', 'no-referrer')
    res.setHeader('x-robots-tag', 'noindex')
    res.end(entry.bytes)
  }))
  return router
}
