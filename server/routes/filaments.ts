// Filament HTTP routes.
//
// Orders are the inventory. What an account owns -- `GET /` -- is derived on
// every read from the orders it logged, the grams its printer used and the
// rolls it marked empty, so the colour pickers and the reorder check read the
// same shelf the Filaments page shows. Nothing writes the owned list directly
// any more.
//
// The catalogue itself never travels -- the client already has it, compiled in.
import { createHash } from 'node:crypto'
import { Router, raw } from 'express'
import type { Request } from 'express'
import type { Repositories } from '../../lib/db/repositories/contracts.ts'
import { ownerOf } from '../auth/requireAuth.ts'
import { validateFilamentUsageMappingsInput } from '../validation/filamentUsage.ts'
import {
  validateFilamentOrderInput, validateRollAdjustmentInput,
} from '../validation/filamentOrders.ts'
import { shelfOf } from '../filaments/shelf.ts'
import { ownedOf } from '../../lib/contracts/filamentOrders.ts'
import { requireRole } from '../auth/requireRole.ts'
import { computeFilamentUsage } from '../../lib/contracts/filamentUsage.ts'
import type { FilamentUsageReport } from '../../lib/contracts/filamentUsage.ts'
import { amsStockOf } from '../../lib/contracts/filamentStock.ts'
import { REPORT_JOB_LIMIT } from '../element/synchronization.ts'
import { ApiError } from '../errors/ApiError.ts'
import type { AssetStore } from '../../lib/assets/assetStore.ts'
import { AssetStoreError, assetKey } from '../../lib/assets/assetStore.ts'
import type { FilamentOrderInvoice } from '../../lib/contracts/filamentOrders.ts'

/** A scanned receipt or a store PDF; far more than either needs. */
export const MAX_INVOICE_BYTES = 15 * 1024 * 1024

/** What the file is, from its first bytes rather than from what it claims. */
function invoiceType(bytes: Buffer): FilamentOrderInvoice['contentType'] | null {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  return null
}

export function createFilamentRouter(
  repos: Repositories,
  /** Where kept invoices live; resolved on first use, as design assets are. */
  store?: () => AssetStore,
): Router {
  const router = Router()

  const audit = (req: Request, action: string, status: number, detail: Record<string, number | string>) => {
    void repos.audit.record({
      owner: ownerOf(req),
      category: 'filament',
      action,
      outcome: 'success',
      httpMethod: req.method,
      httpPath: req.path,
      httpStatus: status,
      requestId: req.requestId ?? null,
      detail,
    }).catch(() => { /* audit must never break a response */ })
  }

  router.get('/', (req, res, next) => {
    void (async () => {
      res.json({ owned: ownedOf(await shelfOf(repos, ownerOf(req))) })
    })().catch(next)
  })

  // The ticks this replaced. Refused rather than silently ignored, so a page
  // left open across the deploy says so instead of losing what it sends.
  router.put('/', () => {
    throw new ApiError(410, 'gone',
      'Owned filament now comes from your orders. Reload the page to log an order instead.')
  })

  router.get('/orders', (req, res, next) => {
    void (async () => {
      const owner = ownerOf(req)
      const [orders, adjustments] = await Promise.all([
        repos.filamentOrders.list(owner),
        repos.filamentOrders.listAdjustments(owner),
      ])
      res.json({ orders, adjustments })
    })().catch(next)
  })

  router.post('/orders', (req, res, next) => {
    void (async () => {
      const order = validateFilamentOrderInput(req.body)
      const stored = await repos.filamentOrders.create(ownerOf(req), order)
      if (!stored) {
        throw new ApiError(409, 'duplicate_order',
          `Order ${order.orderNumber} is already logged.`, { field: 'orderNumber' })
      }
      // Counts, not contents: what someone bought is not an audit record.
      audit(req, 'order_logged', 201, {
        lines: stored.lines.length, source: stored.source,
      })
      res.status(201).json({ order: stored })
    })().catch(next)
  })

  router.delete('/orders/:id', (req, res, next) => {
    void (async () => {
      const id = String(req.params.id)
      if (!(await repos.filamentOrders.delete(ownerOf(req), id))) {
        throw new ApiError(404, 'not_found', 'No such order.')
      }
      audit(req, 'order_deleted', 204, {})
      res.status(204).end()
    })().catch(next)
  })

  // The original invoice, kept with its order for reference. Owner-scoped and
  // content-addressed in the asset store like a set photograph, and like one
  // not authoritative: the order is the record, this is the receipt.
  router.put('/orders/:id/invoice', raw({ type: () => true, limit: MAX_INVOICE_BYTES }), (req, res, next) => {
    void (async () => {
      const owner = ownerOf(req)
      const id = String(req.params.id)
      const body: unknown = req.body
      if (!Buffer.isBuffer(body) || body.byteLength === 0) {
        throw new ApiError(400, 'bad_request', 'a request body is required', { field: 'body' })
      }
      const contentType = invoiceType(body)
      if (!contentType) {
        throw new ApiError(400, 'bad_request', 'an invoice must be a PDF, PNG or JPEG', { field: 'body' })
      }
      const raw = typeof req.query.filename === 'string' ? req.query.filename.trim() : ''
      // Display only; the stored object is named by its hash.
      const filename = raw.replace(/[/\\]/g, '_').slice(0, 200) || 'invoice'
      if (!store) throw new ApiError(503, 'asset_store_unavailable', 'the file store is not available')
      // Checked before the bytes are stored, so a wrong id leaves nothing behind.
      if (!(await repos.filamentOrders.list(owner)).some(order => order.id === id)) {
        throw new ApiError(404, 'not_found', 'No such order.')
      }
      const hash = createHash('sha256').update(body).digest('hex')
      try {
        await store().put(assetKey(owner, hash), body)
      } catch (cause) {
        if (cause instanceof AssetStoreError) {
          throw new ApiError(503, 'asset_store_unavailable',
            'the file store is not available; the order itself is saved', { reason: cause.code })
        }
        throw cause
      }
      const invoice = { filename, contentType, byteLength: body.byteLength }
      if (!(await repos.filamentOrders.attachInvoice(owner, id, { ...invoice, hash }))) {
        throw new ApiError(404, 'not_found', 'No such order.')
      }
      audit(req, 'invoice_kept', 200, { bytes: body.byteLength })
      res.json({ invoice })
    })().catch(next)
  })

  router.get('/orders/:id/invoice', (req, res, next) => {
    void (async () => {
      const owner = ownerOf(req)
      const found = await repos.filamentOrders.findInvoice(owner, String(req.params.id))
      if (!found || !store) throw ApiError.notFound('no invoice is kept with this order')
      let bytes: Uint8Array
      try {
        bytes = await store().get(assetKey(owner, found.hash))
      } catch (cause) {
        // Kept files are not authoritative; a missing one is absent, not broken.
        if (cause instanceof AssetStoreError) throw ApiError.notFound('the invoice file is no longer stored')
        throw cause
      }
      res.setHeader('content-type', found.contentType)
      res.setHeader('content-length', String(bytes.byteLength))
      res.setHeader('content-disposition', `inline; filename="${found.filename.replace(/[^\x20-\x7e]|"/g, '_')}"`)
      res.setHeader('cache-control', 'private, no-store')
      res.setHeader('x-content-type-options', 'nosniff')
      res.end(Buffer.from(bytes))
    })().catch(next)
  })

  router.put('/adjustments', (req, res, next) => {
    void (async () => {
      const { key, finished } = validateRollAdjustmentInput(req.body)
      const adjustments = await repos.filamentOrders.setAdjustment(ownerOf(req), key, finished)
      audit(req, 'rolls_marked', 200, { finished })
      res.json({ adjustments })
    })().catch(next)
  })

  // Usage comes from the EL-ement Statistics history, which is administrator
  // data about the household printer rather than anything owned by one account,
  // so it is gated exactly as that page is. The links, by contrast, are the
  // account's own -- an administrator's links do not rewrite anyone else's.
  const adminOnly = requireRole('admin', repos.memberships)

  router.get('/usage', adminOnly, (req, res, next) => {
    void (async () => {
      const owner = ownerOf(req)
      const [jobs, mappings, settings] = await Promise.all([
        repos.elementStatistics.listJobs(null, REPORT_JOB_LIMIT + 1),
        repos.filamentUsageMappings.list(owner),
        repos.elementStatistics.getSettings(),
      ])
      if (jobs.length > REPORT_JOB_LIMIT) {
        throw new ApiError(413, 'report_limit',
          'The recorded history exceeds 50,000 jobs, so usage cannot be totalled in one pass.')
      }
      // The AMS of the printer the statistics page is recording, as last saved.
      // Reported even when old: the panel shows when it was taken, and a stale
      // percentage is still the best reading there is.
      const snapshot = settings.activeConnectionId
        ? await repos.elementStatistics.getSnapshot(settings.activeConnectionId)
        : null
      const report: FilamentUsageReport = {
        ...computeFilamentUsage(jobs, mappings),
        ams: amsStockOf(snapshot),
      }
      res.json(report)
    })().catch(next)
  })

  router.put('/usage/mappings', adminOnly, (req, res, next) => {
    void (async () => {
      const owner = ownerOf(req)
      const mappings = validateFilamentUsageMappingsInput(req.body)
      const stored = await repos.filamentUsageMappings.replace(owner, mappings)
      void repos.audit.record({
        owner,
        category: 'filament',
        action: 'usage_mappings_updated',
        outcome: 'success',
        httpMethod: req.method,
        httpPath: req.path,
        httpStatus: 200,
        requestId: req.requestId ?? null,
        detail: { mappings: stored.length },
      }).catch(() => { /* audit must never break a response */ })
      res.json({ mappings: stored })
    })().catch(next)
  })

  return router
}
