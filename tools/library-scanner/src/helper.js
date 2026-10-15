// Local helper: a tiny HTTP server on 127.0.0.1 that lets the ShapePilot web
// app act on files on this Mac (open in Bambu Studio, reveal, file into a
// category, apply the reorganization plan, undo, stream bytes for the 3D view).
//
// Only pages whose Origin is in `allowedOrigins` get a CORS grant, and every
// request must carry that Origin, so other websites cannot drive it. Paths are
// only ever resolved from a model id plus a path inside that model's folder.

import { createServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { ScanCache } from './scan.js'
import { listBatches, undoBatch } from './fsops.js'
import { createCategory, deleteCategory, listCategoryDetails, mergeCategory, renameCategory } from './categories.js'
import {
  applySavedPlan, exclusive, fileModel, listCategories, modelFilePath, resolveModelTarget, runSync, trashModelFile,
} from './run.js'

const VERSION = 2
const MAX_BODY = 64 * 1024

export function allowedOrigins(config) {
  return new Set([
    new URL(config.serverUrl).origin,
    'http://localhost:5173',
    'http://localhost:3006',
    ...(config.allowedOrigins ?? []),
  ])
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

function openWith(args) {
  return new Promise((resolve, reject) => {
    execFile('open', args, (err) => (err ? reject(err) : resolve()))
  })
}

export function createHelper(config, { cache = new ScanCache(config.cacheDir), afterChange } = {}) {
  const origins = allowedOrigins(config)
  let syncing = null

  // Re-sync after a change so the Library reflects it; coalesce bursts.
  const resync = () => {
    if (!config.deviceToken) return
    if (syncing) return
    syncing = setTimeout(() => {
      syncing = null
      exclusive(() => runSync(config, { cache })).catch((err) => console.error('[helper] sync failed:', err.message))
    }, 1500)
  }

  const routes = {
    'GET /health': async () => ({ ok: true, version: VERSION, library: basename(config.libraryRoot), connected: Boolean(config.deviceToken) }),
    'GET /categories': async () => ({ categories: listCategories(config), details: listCategoryDetails(config) }),
    'POST /categories/create': async ({ name }) => {
      const result = await exclusive(() => createCategory(config, String(name ?? '')))
      resync()
      return result
    },
    'POST /categories/rename': async ({ from, to }) => {
      const result = await exclusive(() => renameCategory(config, String(from ?? ''), String(to ?? '')))
      resync()
      return result
    },
    'POST /categories/merge': async ({ from, into }) => {
      const result = await exclusive(() => mergeCategory(config, String(from ?? ''), String(into ?? '')))
      resync()
      return result
    },
    'POST /categories/delete': async ({ name }) => {
      const result = await exclusive(() => deleteCategory(config, String(name ?? '')))
      resync()
      return result
    },
    'GET /batches': async () => ({ batches: listBatches(config.libraryRoot).slice(-50).reverse() }),
    'POST /open': async ({ modelId, relPath }) => {
      const target = resolveModelTarget(config, modelId, relPath)
      await openWith(relPath ? ['-a', config.slicerApp ?? 'BambuStudio', target] : [target])
      return { ok: true }
    },
    'POST /reveal': async ({ modelId, relPath }) => {
      await openWith(['-R', resolveModelTarget(config, modelId, relPath)])
      return { ok: true }
    },
    'POST /file': async ({ modelId, category, status }) => {
      const result = await exclusive(() => fileModel(config, modelId, category, { status }))
      resync()
      return result
    },
    'POST /trash-file': async ({ modelId, relPath }) => {
      const result = await exclusive(() => trashModelFile(config, modelId, relPath))
      resync()
      return result
    },
    'POST /apply-plan': async ({ ids }) => {
      if (!Array.isArray(ids) || !ids.length) throw Object.assign(new Error('Choose at least one model'), { status: 400 })
      const result = await exclusive(() => applySavedPlan(config, ids))
      resync()
      return { batch: result.batch, results: result.results }
    },
    'POST /undo': async ({ batch }) => {
      const count = await exclusive(() => undoBatch(config.libraryRoot, String(batch)))
      resync()
      return { reversed: count }
    },
    'POST /sync': async () => exclusive(() => runSync(config, { cache })),
  }

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin
    const url = new URL(req.url, 'http://localhost')
    const allowed = origin && origins.has(origin)
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      // Chrome's Private Network Access preflight for https page -> localhost.
      res.setHeader('Access-Control-Allow-Private-Network', 'true')
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(allowed ? 204 : 403).end()
      return
    }
    if (!allowed) {
      res.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'origin not allowed' }))
      return
    }
    try {
      if (req.method === 'GET' && url.pathname === '/file') {
        const { full } = modelFilePath(config, url.searchParams.get('modelId'), url.searchParams.get('relPath'))
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': statSync(full).size, 'Cache-Control': 'no-store' })
        createReadStream(full).pipe(res)
        return
      }
      const handler = routes[`${req.method} ${url.pathname}`]
      if (!handler) {
        res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'not found' }))
        return
      }
      const body = req.method === 'POST' ? await readBody(req) : {}
      const result = await handler(body)
      afterChange?.(url.pathname)
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result))
    } catch (err) {
      res.writeHead(Number.isInteger(err.status) ? err.status : 500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
  })
  return server
}
