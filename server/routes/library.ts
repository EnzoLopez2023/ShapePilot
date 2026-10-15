// The model Library's routes: the signed-in pages, and the organizer on the
// owner's Mac.
//
// The organizer cannot hold an Entra session, so it presents a device token
// (`Authorization: Device spl1.<secret>`) created in Settings. Only a digest is
// stored, the token unlocks nothing but /api/library/sync/*, and the owning
// membership is re-read on every call, so removing the account's access stops
// its Macs as well.
//
// Print history is the household printer's job ledger (EL-ement Statistics),
// which only an administrator can read. So only an administrator's Library
// links prints from it; anyone can still log a print by hand.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import express, { Router } from 'express'
import type { Request } from 'express'
import type { Owner, Repositories } from '../../lib/db/repositories/contracts.ts'
import type { LibraryImportedJob, LibraryModelEdit } from '../../lib/db/repositories/library.ts'
import { AssetStoreError } from '../../lib/assets/assetStore.ts'
import type { AssetStore } from '../../lib/assets/assetStore.ts'
import {
  LIBRARY_LIMITS, LIBRARY_SORTS, LIBRARY_STATUSES, SHA256_RE, cleanCollectionName, cleanSmartQuery, cleanSyncedModel,
  cleanTags, num,
} from '../../lib/contracts/library.ts'
import type {
  LibraryMatchCounts, LibraryModelQuery, LibraryOverview, LibraryStatus, SyncedModel,
} from '../../lib/contracts/library.ts'
import { ownerOf } from '../auth/requireAuth.ts'
import { ApiError } from '../errors/ApiError.ts'
import { integrationPrintJob } from './integrations.ts'

interface LibraryRouterOptions {
  repos: Repositories
  store: () => AssetStore
}

const DEVICE_TOKEN_RE = /^spl1\.([A-Za-z0-9_-]{43})$/
const MAX_THUMB_BYTES = 4 * 1024 * 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** Jobs are re-read for this long before the cursor, so a late result (active -> completed) still lands. */
const HISTORY_OVERLAP_MS = 3 * 24 * 60 * 60 * 1000
const HISTORY_LIMIT = 5_000

export const hashDeviceSecret = (secret: string): string =>
  createHash('sha256').update(`shapepilot-library-device:${secret}`).digest('hex')

/** Thumbnails sit beside design assets in the same store, under their own prefix. */
export const libraryThumbKey = (owner: Owner, hash: string): string =>
  join('library-thumbs', owner.tenantId, owner.oid, hash)

const text = (value: unknown, max: number): string | null =>
  value == null ? null : String(value).slice(0, max)

/**
 * Copies the household printer's jobs into the owner's Library and re-matches
 * them. Reads from just before the last cursor, so the overlap catches jobs
 * whose result arrived after they were first seen.
 */
export async function importPrintHistory(repos: Repositories, owner: Owner): Promise<LibraryMatchCounts & { imported: number }> {
  const cursor = await repos.library.printHistoryCursor(owner)
  const since = cursor ? Date.parse(cursor) : NaN
  const now = new Date().toISOString()
  const jobs = await repos.elementStatistics.listJobs(null, HISTORY_LIMIT, Number.isFinite(since)
    ? { fromInclusive: new Date(since - HISTORY_OVERLAP_MS).toISOString() }
    : undefined)
  const imported: LibraryImportedJob[] = jobs.map(job => {
    const projected = integrationPrintJob(job)
    return {
      key: projected.id,
      title: projected.title,
      result: projected.result === 'completed' ? 'completed'
        : projected.result === 'failed_or_aborted' ? 'failed'
          : projected.result === 'active' ? 'active' : 'unknown',
      startedAt: projected.startedAt,
      endedAt: projected.endedAt,
      seconds: projected.seconds,
      grams: projected.grams,
      materials: projected.materials,
    }
  })
  const counts = await repos.library.importJobs(owner, imported, now, now)
  return { imported: imported.length, ...counts }
}

// ── The organizer ────────────────────────────────────────────────────────────

declare module 'express-serve-static-core' {
  interface Request {
    libraryDevice?: { id: string; owner: Owner; name: string }
  }
}

/**
 * Mounted at /api/library/sync BEFORE the Entra middleware and before the
 * app's own JSON parser: a sync batch is larger than the app-wide limit.
 */
export function createLibrarySyncRouter({ repos, store }: LibraryRouterOptions): Router {
  const router = Router()
  const syncJson = express.json({ limit: '8mb' })

  router.use(async (req, res, next) => {
    res.setHeader('cache-control', 'no-store')
    const match = /^Device (\S+)$/.exec(req.get('authorization') ?? '')
    const token = match ? DEVICE_TOKEN_RE.exec(match[1]) : null
    if (!token) throw ApiError.unauthorized('A Library device token is required.')
    const device = await repos.library.deviceByHash(hashDeviceSecret(token[1]))
    if (!device || !await repos.memberships.find(device.owner)) {
      throw ApiError.unauthorized('This device token was revoked or is not valid. Create a new one in Settings.')
    }
    req.libraryDevice = device
    next()
  })

  const ownerOfDevice = (req: Request): Owner => req.libraryDevice!.owner

  router.post('/models', syncJson, async (req, res) => {
    const { startedAt, models } = (req.body ?? {}) as { startedAt?: unknown; models?: unknown }
    if (typeof startedAt !== 'string' || !Array.isArray(models)) {
      throw ApiError.badRequest('startedAt and models are required.')
    }
    const accepted: SyncedModel[] = []
    const errors: { id: unknown; error: string }[] = []
    for (const raw of models.slice(0, LIBRARY_LIMITS.modelsPerSync)) {
      try {
        accepted.push(cleanSyncedModel(raw))
      } catch (error) {
        errors.push({ id: (raw as { id?: unknown } | null)?.id ?? null, error: (error as Error).message })
      }
    }
    await repos.library.syncModels(ownerOfDevice(req), accepted, startedAt)
    res.json({ accepted: accepted.length, errors })
  })

  router.post('/commit', syncJson, async (req, res) => {
    const { startedAt, plan, batches, stats } = (req.body ?? {}) as Record<string, unknown>
    if (typeof startedAt !== 'string') throw ApiError.badRequest('startedAt is required.')
    const owner = ownerOfDevice(req)
    const { missing } = await repos.library.commitSync(owner, {
      startedAt,
      plan,
      batches: Array.isArray(batches) ? batches : undefined,
      lastSync: { at: new Date().toISOString(), device: req.libraryDevice!.name, stats: stats ?? null },
    })
    const member = await repos.memberships.find(owner)
    const matches = member?.role === 'admin'
      ? await importPrintHistory(repos, owner)
      : await repos.library.matchPrints(owner)
    res.json({ missing, matches })
  })

  router.post('/thumbs/missing', syncJson, async (req, res) => {
    const raw = (req.body as { hashes?: unknown } | null)?.hashes
    const hashes = (Array.isArray(raw) ? raw : [])
      .filter((h): h is string => typeof h === 'string' && SHA256_RE.test(h))
      .slice(0, 5_000)
    const known = await repos.library.knownThumbs(ownerOfDevice(req), hashes)
    res.json({ missing: hashes.filter(h => !known.has(h)) })
  })

  router.put('/thumbs/:hash', express.raw({ type: 'image/png', limit: MAX_THUMB_BYTES }), async (req, res) => {
    const { hash } = req.params
    const body: unknown = req.body
    if (!SHA256_RE.test(hash) || !Buffer.isBuffer(body) || !body.subarray(0, 8).equals(PNG_SIGNATURE)) {
      throw ApiError.badRequest('A PNG body is required.')
    }
    if (createHash('sha256').update(body).digest('hex') !== hash) throw ApiError.badRequest('The body does not match its hash.')
    const owner = ownerOfDevice(req)
    await store().put(libraryThumbKey(owner, hash), body)
    await repos.library.recordThumb(owner, hash)
    res.status(204).end()
  })

  router.get('/edits', async (req, res) => {
    res.json({ edits: await repos.library.pendingEdits(ownerOfDevice(req)) })
  })

  return router
}

// ── The pages ────────────────────────────────────────────────────────────────

function modelQuery(raw: Request['query']): LibraryModelQuery {
  const str = (key: string) => (typeof raw[key] === 'string' ? raw[key] as string : '')
  const status = str('status')
  const sort = str('sort')
  const collection = Number(str('collection'))
  return {
    q: str('q').slice(0, 200),
    status: status.split(',').every(s => (LIBRARY_STATUSES as readonly string[]).includes(s)) ? status as LibraryStatus : '',
    category: str('category').slice(0, LIBRARY_LIMITS.category),
    format: str('format').slice(0, 20),
    tag: str('tag').slice(0, LIBRARY_LIMITS.tag),
    favorite: str('favorite') === '1',
    sort: (LIBRARY_SORTS as readonly string[]).includes(sort) ? sort as LibraryModelQuery['sort'] : 'recent',
    state: str('state') === 'missing' ? 'missing' : 'present',
    ...(Number.isSafeInteger(collection) && collection > 0 ? { collection } : {}),
  }
}

const positiveId = (value: string, what: string): number => {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw ApiError.badRequest(`Invalid ${what} ID.`)
  return id
}

/** A link to a project page elsewhere: http(s) only, so it can never run script when clicked. */
function hubUrl(value: unknown): string | null {
  if (value === null || value === '') return null
  if (typeof value !== 'string' || value.length > LIBRARY_LIMITS.sourceUrl) throw ApiError.badRequest('Enter a link of up to 2,000 characters.')
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw ApiError.badRequest('Enter the full link to the Bambu Hub project, starting with https://.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw ApiError.badRequest('The link must start with https://.')
  return url.toString()
}

function modelEdit(body: unknown): LibraryModelEdit {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw ApiError.badRequest('A JSON object is required.')
  const b = body as Record<string, unknown>
  const edit: LibraryModelEdit = {}
  if (b.title !== undefined) {
    const title = text(b.title, LIBRARY_LIMITS.title)?.trim()
    if (!title) throw ApiError.badRequest('A title is required.')
    edit.title = title
  }
  if (b.status !== undefined) {
    if (!(LIBRARY_STATUSES as readonly unknown[]).includes(b.status)) throw ApiError.badRequest('Invalid status.')
    edit.status = b.status as LibraryStatus
  }
  if (b.tags !== undefined) edit.tags = cleanTags(b.tags)
  if (b.notes !== undefined) edit.notes = text(b.notes, LIBRARY_LIMITS.notes) ?? ''
  if (b.favorite !== undefined) edit.favorite = Boolean(b.favorite)
  if (b.designer !== undefined) edit.designer = text(b.designer, LIBRARY_LIMITS.designer)
  if (b.sourceUrl !== undefined) edit.sourceUrl = text(b.sourceUrl, LIBRARY_LIMITS.sourceUrl)
  if (b.bambuHubUrl !== undefined) edit.bambuHubUrl = hubUrl(b.bambuHubUrl)
  return edit
}

/** Always mounted behind Entra authentication. */
export function createLibraryRouter({ repos, store }: LibraryRouterOptions): Router {
  const router = Router()
  const isAdmin = (req: Request) => req.role === 'admin'

  router.get('/overview', async (req, res) => {
    const { printHistoryLastSync, ...overview } = await repos.library.overview(ownerOf(req))
    res.json({
      ...overview,
      printHistory: { available: isAdmin(req), lastSync: printHistoryLastSync },
    } satisfies LibraryOverview)
  })

  router.get('/models', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200)
    const offset = Math.max(Number(req.query.offset) || 0, 0)
    const models = await repos.library.queryModels(ownerOf(req), modelQuery(req.query))
    res.json({ total: models.length, items: models.slice(offset, offset + limit) })
  })

  // Every matching id in order (unpaged), so a model page can step to its neighbours.
  router.get('/model-ids', async (req, res) => {
    const models = await repos.library.queryModels(ownerOf(req), modelQuery(req.query))
    res.json({ ids: models.map(m => m.id) })
  })

  router.get('/models/:id', async (req, res) => {
    const model = await repos.library.getModel(ownerOf(req), req.params.id)
    if (!model) throw ApiError.notFound('Model not found.')
    res.json(model)
  })

  router.put('/models/:id', async (req, res) => {
    const model = await repos.library.editModel(ownerOf(req), req.params.id, modelEdit(req.body))
    if (!model) throw ApiError.notFound('Model not found.')
    res.json(model)
  })

  router.post('/models/:id/prints', async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const print = await repos.library.logPrint(ownerOf(req), req.params.id, {
      result: b.result === 'failed' ? 'failed' : 'completed',
      startedAt: text(b.startedAt, 40) ?? new Date().toISOString(),
      notes: text(b.notes, 4_000) ?? '',
      grams: num(b.grams),
      seconds: num(b.seconds),
    })
    if (!print) throw ApiError.notFound('Model not found.')
    res.status(201).json(print)
  })

  router.delete('/prints/:id', async (req, res) => {
    if (!await repos.library.deleteManualPrint(ownerOf(req), positiveId(req.params.id, 'print'))) {
      throw ApiError.notFound('Only a print logged by hand can be deleted.')
    }
    res.status(204).end()
  })

  router.get('/matches', async (req, res) => {
    res.json(await repos.library.listMatches(ownerOf(req)))
  })

  router.post('/matches/:id/confirm', async (req, res) => {
    const modelId = (req.body as { modelId?: unknown } | undefined)?.modelId
    const result = await repos.library.confirmMatch(ownerOf(req), positiveId(req.params.id, 'print'),
      typeof modelId === 'string' && modelId ? modelId : null)
    if (result === 'not_found') throw ApiError.notFound('Print job not found.')
    if (result === 'no_model') throw ApiError.badRequest('Choose a model for this print.')
    res.json(result)
  })

  router.post('/matches/:id/reject', async (req, res) => {
    const print = await repos.library.rejectMatch(ownerOf(req), positiveId(req.params.id, 'print'))
    if (!print) throw ApiError.notFound('Print job not found.')
    res.json(print)
  })

  router.post('/print-history/sync', async (req, res) => {
    if (!isAdmin(req)) throw ApiError.forbidden('Print history comes from the household printer, which only an administrator can read.')
    res.json(await importPrintHistory(repos, ownerOf(req)))
  })

  // ── Collections ──

  router.get('/collections', async (req, res) => {
    res.json(await repos.library.listCollections(ownerOf(req)))
  })

  router.post('/collections', async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const name = cleanCollectionName(b.name)
    if (!name) throw ApiError.badRequest('Name the collection.')
    const kind = b.kind === 'smart' ? 'smart' : 'manual'
    const result = await repos.library.createCollection(ownerOf(req), {
      name,
      kind,
      query: kind === 'smart' ? cleanSmartQuery(b.query) : null,
      modelIds: kind === 'manual' && Array.isArray(b.modelIds) ? b.modelIds.map(String).slice(0, 5_000) : [],
    })
    if (result === 'exists') throw ApiError.conflict(`A collection named "${name}" already exists.`)
    if (result === 'not_found') throw ApiError.notFound('Collection not found.')
    res.status(201).json(result)
  })

  router.put('/collections/:id', async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const name = cleanCollectionName(b.name)
    if (!name) throw ApiError.badRequest('Name the collection.')
    const result = await repos.library.updateCollection(ownerOf(req), positiveId(req.params.id, 'collection'), {
      name, ...(b.query !== undefined ? { query: cleanSmartQuery(b.query) } : {}),
    })
    if (result === 'exists') throw ApiError.conflict(`A collection named "${name}" already exists.`)
    if (result === 'not_found') throw ApiError.notFound('Collection not found.')
    res.json(result)
  })

  // Deleting a collection never touches its models.
  router.delete('/collections/:id', async (req, res) => {
    if (!await repos.library.deleteCollection(ownerOf(req), positiveId(req.params.id, 'collection'))) {
      throw ApiError.notFound('Collection not found.')
    }
    res.status(204).end()
  })

  for (const [method, member] of [['put', true], ['delete', false]] as const) {
    router[method]('/collections/:id/models/:modelId', async (req, res) => {
      const result = await repos.library.setMembership(
        ownerOf(req), positiveId(req.params.id, 'collection'), req.params.modelId, member)
      if (result === 'not_found') throw ApiError.notFound('Collection not found.')
      if (result === 'no_model') throw ApiError.notFound('Model not found.')
      if (result === 'smart') throw ApiError.badRequest('Smart collections fill themselves from their filters.')
      res.status(204).end()
    })
  }

  router.get('/duplicates', async (req, res) => {
    res.json(await repos.library.duplicates(ownerOf(req)))
  })

  router.get('/plan', async (req, res) => {
    res.json(await repos.library.plan(ownerOf(req)))
  })

  // ── Devices ──

  router.get('/devices', async (req, res) => {
    res.json(await repos.library.listDevices(ownerOf(req)))
  })

  router.post('/devices', async (req, res) => {
    const owner = ownerOf(req)
    const name = text((req.body as { name?: unknown } | undefined)?.name, 80)?.trim() || 'Mac'
    const secret = randomBytes(32).toString('base64url')
    const device = await repos.library.createDevice(owner, randomUUID(), name, hashDeviceSecret(secret))
    await repos.audit.record({
      owner, category: 'library_device', action: 'created', outcome: 'success', requestId: req.requestId,
    })
    res.setHeader('cache-control', 'no-store')
    // The only time the token exists outside the Mac it is pasted into.
    res.status(201).json({ ...device, token: `spl1.${secret}` })
  })

  router.delete('/devices/:id', async (req, res) => {
    if (!/^[a-f0-9-]{36}$/.test(req.params.id)) throw ApiError.badRequest('Invalid device ID.')
    const owner = ownerOf(req)
    if (!await repos.library.revokeDevice(owner, req.params.id)) throw ApiError.notFound('Device not found.')
    await repos.audit.record({
      owner, category: 'library_device', action: 'revoked', outcome: 'success', requestId: req.requestId,
    })
    res.status(204).end()
  })

  // Content-addressed, so a hash names bytes and a cached copy is never stale.
  router.get('/thumbs/:hash', async (req, res) => {
    const { hash } = req.params
    if (!SHA256_RE.test(hash)) throw ApiError.notFound('Thumbnail not found.')
    const owner = ownerOf(req)
    if (!(await repos.library.knownThumbs(owner, [hash])).has(hash)) throw ApiError.notFound('Thumbnail not found.')
    let bytes: Uint8Array
    try {
      bytes = await store().get(libraryThumbKey(owner, hash))
    } catch (error) {
      if (error instanceof AssetStoreError && error.code === 'ASSET_NOT_FOUND') throw ApiError.notFound('Thumbnail not found.')
      throw error
    }
    res.setHeader('content-type', 'image/png')
    res.setHeader('cache-control', 'private, max-age=31536000, immutable')
    res.setHeader('x-content-type-options', 'nosniff')
    res.send(Buffer.from(bytes))
  })

  return router
}
