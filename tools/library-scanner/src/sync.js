// Sync with ShapePilot: pull edits made in the app into model.json, then push
// the organized models, their thumbnails and the pending reorganization plan.

import { readFileSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { MODEL_JSON, findModelDir, readModelJson, serializeModelJson } from './modeljson.js'
import { OpLog, listBatches, rewrite } from './fsops.js'
import { walkModelJsons } from './models.js'

const MAX_BODY_BYTES = 6 * 1024 * 1024

export class LibraryClient {
  constructor(config, fetchImpl = fetch) {
    if (!config.deviceToken) throw new Error('Not connected to ShapePilot. Run: npm run library -- connect <device token>')
    if (!config.deviceToken.startsWith('spl1.')) {
      throw new Error('This Mac still has a Workshop device token. Create one in ShapePilot → Settings → Library, then run: npm run library -- connect <token>')
    }
    this.base = config.serverUrl.replace(/\/$/, '')
    this.token = config.deviceToken
    this.fetch = fetchImpl
  }

  async call(method, path, body, headers = {}) {
    const init = { method, headers: { Authorization: `Device ${this.token}`, ...headers } }
    if (body instanceof Uint8Array) init.body = body
    else if (body !== undefined) {
      init.body = JSON.stringify(body)
      init.headers['Content-Type'] = 'application/json'
    }
    const res = await this.fetch(`${this.base}${path}`, init)
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`${method} ${path} → ${res.status} ${detail.slice(0, 200)}`)
    }
    return res.status === 204 ? null : res.json()
  }
}

/** Groups scan records into organized models (folders with model.json) ready to upload. */
export function buildSnapshot(config, records) {
  const root = config.libraryRoot
  const memo = new Map()
  const byDir = new Map()
  for (const r of records) {
    if (r.rootType !== 'library') continue
    const dir = findModelDir(r.path, root, memo)
    if (!dir) continue
    if (!byDir.has(dir)) byDir.set(dir, [])
    byDir.get(dir).push(r)
  }
  // Model folders whose files all vanished still sync (as empty) so they are not marked missing by mistake.
  for (const dir of walkModelJsons(root)) if (!byDir.has(dir)) byDir.set(dir, [])

  const models = []
  for (const [dir, files] of byDir) {
    const json = readModelJson(dir)
    if (!json) continue
    const folder = relative(root, dir)
    const ordered = [...files].sort((a, b) => (b.meta?.Title ? 1 : 0) - (a.meta?.Title ? 1 : 0) || (b.triangles ?? 0) - (a.triangles ?? 0))
    const hero = json.thumb ?? ordered.find((f) => f.kind === '3mf' && f.thumb)?.thumb ?? ordered.find((f) => f.thumb)?.thumb ?? null
    const gallery = [...new Set(files.flatMap((f) => [f.thumb, ...(f.plateThumbs ?? []).map((p) => p.thumb)]).filter((h) => h && h !== hero))]
    models.push({
      id: json.id,
      title: json.title,
      category: folder.split(sep)[0],
      folder,
      status: json.status,
      tags: json.tags ?? [],
      notes: json.notes ?? '',
      designer: json.designer ?? null,
      license: json.license ?? null,
      description: json.description ?? null,
      source: json.source ?? {},
      workshopVersion: json.workshopVersion ?? 0,
      createdAt: json.createdAt ?? null,
      thumb: hero,
      gallery,
      files: files.map((f) => ({
        relPath: relative(root, f.path),
        filename: f.filename,
        kind: f.kind,
        size: f.size,
        sha256: f.sha256,
        geomHash: f.geomHash,
        mtimeMs: f.mtimeMs,
        triangles: f.triangles,
        bbox: f.bbox,
        isSliced: f.isSliced,
        printer: f.printer,
        seconds: f.seconds,
        grams: f.grams,
        plates: f.plates,
        profileTitle: f.meta?.ProfileTitle ?? null,
        filaments: f.filaments,
        generator: f.generator,
        thumb: f.thumb,
      })),
    })
  }
  return models
}

/** Compact plan for the app's review screen (the full plan stays on disk). */
export function condensePlan(config, plan) {
  if (!plan) return null
  const rel = (p) => (p.startsWith(config.libraryRoot) ? relative(config.libraryRoot, p) : p.replace(process.env.HOME ?? '', '~'))
  return {
    createdAt: plan.createdAt,
    intakeOnly: plan.intakeOnly,
    summary: plan.summary,
    skipped: plan.skipped.length,
    models: plan.models.map((m) => ({
      id: m.id,
      title: m.title,
      origin: m.origin,
      sourceLabel: m.sourceLabel,
      category: m.category,
      suggestedCategory: m.suggestedCategory,
      status: m.status,
      dest: m.dest ? rel(m.dest) : null,
      thumb: m.thumb,
      designer: m.designer,
      moves: m.moves.filter((x) => x.kind === 'model').slice(0, 12).map((x) => ({ from: rel(x.from), to: basename(x.to) })),
      moveCount: m.moves.length,
      extractCount: m.extract?.entries.length ?? 0,
      trash: m.trash.slice(0, 12).map((t) => ({ path: rel(t.path), reason: t.reason.replace(config.libraryRoot + sep, '') })),
      trashCount: m.trash.length,
    })),
  }
}

/** Writes edits made in the app into model.json. Returns the number applied. */
export async function pullEdits(config, client, index) {
  const { edits } = await client.call('GET', '/api/library/sync/edits')
  if (!edits.length) return 0
  const log = new OpLog(config.libraryRoot)
  const record = log.record.bind(log)
  log.record = (op) => record({ ...op, kind: 'edit' })
  let applied = 0
  for (const edit of edits) {
    const dir = index.get(edit.id)
    if (!dir) continue
    const json = readModelJson(dir)
    if (!json) continue
    const next = {
      ...json,
      title: edit.title,
      status: edit.status,
      tags: edit.tags,
      notes: edit.notes,
      designer: edit.designer,
      source: { ...(json.source ?? {}), url: edit.sourceUrl ?? null },
      workshopVersion: edit.workshopVersion,
    }
    rewrite(log, join(dir, MODEL_JSON), serializeModelJson(next))
    applied += 1
  }
  return applied
}

function chunkBySize(items, maxBytes) {
  const chunks = []
  let current = []
  let size = 0
  for (const item of items) {
    const bytes = Buffer.byteLength(JSON.stringify(item))
    if (current.length && size + bytes > maxBytes) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(item)
    size += bytes
  }
  if (current.length) chunks.push(current)
  return chunks
}

/** Uploads models + thumbnails + plan, then commits (marking unseen models missing). */
export async function pushSnapshot(config, client, { models, plan, cache, startedAt }) {
  const thumbs = new Set()
  for (const m of models) {
    if (m.thumb) thumbs.add(m.thumb)
    for (const h of m.gallery) thumbs.add(h)
    for (const f of m.files) if (f.thumb) thumbs.add(f.thumb)
  }
  for (const m of plan?.models ?? []) if (m.thumb) thumbs.add(m.thumb)
  const hashes = [...thumbs]
  let uploaded = 0
  for (let i = 0; i < hashes.length; i += 1000) {
    const { missing } = await client.call('POST', '/api/library/sync/thumbs/missing', { hashes: hashes.slice(i, i + 1000) })
    for (const hash of missing) {
      let png
      try {
        png = readFileSync(cache.thumbPath(hash))
      } catch {
        continue
      }
      await client.call('PUT', `/api/library/sync/thumbs/${hash}`, new Uint8Array(png), { 'Content-Type': 'image/png' })
      uploaded += 1
    }
  }
  for (const chunk of chunkBySize(models, MAX_BODY_BYTES)) {
    const res = await client.call('POST', '/api/library/sync/models', { startedAt, models: chunk })
    if (res.errors?.length) console.warn('ShapePilot rejected some models:', res.errors)
  }
  const batches = listBatches(config.libraryRoot).slice(-100).reverse()
  const commit = await client.call('POST', '/api/library/sync/commit', {
    startedAt,
    plan: condensePlan(config, plan),
    batches,
    stats: { models: models.length, files: models.reduce((n, m) => n + m.files.length, 0) },
  })
  return { models: models.length, thumbsUploaded: uploaded, ...commit }
}

