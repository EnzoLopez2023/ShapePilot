// model.json sidecar: the on-disk identity of a model folder. Its `id` is the
// id the Library uses, so metadata survives renames and moves made in Finder.
// `workshopVersion` keeps its old name because every model.json already on disk
// carries it: it is the last app-side edit this folder has applied.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const MODEL_JSON = 'model.json'
export const STATUSES = ['inbox', 'want', 'queued', 'printed', 'failed', 'skip']

export function readModelJson(dir) {
  const path = join(dir, MODEL_JSON)
  if (!existsSync(path)) return null
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    return data && typeof data.id === 'string' ? data : null
  } catch {
    return null
  }
}

export function newModelJson({ title, category, status = 'inbox', record, files = [], origin = [] }) {
  const meta = record?.meta ?? {}
  return {
    schema: 1,
    id: randomUUID(),
    title,
    category,
    status: STATUSES.includes(status) ? status : 'inbox',
    tags: [],
    notes: '',
    designer: meta.Designer ?? null,
    license: meta.License ?? null,
    description: meta.Description ?? null,
    source: {
      site: meta.DesignModelId || meta.DesignerUserId ? 'makerworld' : record?.generator === 'shapepilot' ? 'shapepilot' : null,
      url: null,
      modelId: meta.DesignModelId ?? null,
      designerUserId: meta.DesignerUserId ?? null,
    },
    files,
    origin,
    createdAt: new Date().toISOString(),
  }
}

export function serializeModelJson(data) {
  return `${JSON.stringify(data, null, 2)}\n`
}

/** Finds the nearest ancestor (up to and including `root`'s children) that holds a model.json. */
export function findModelDir(filePath, root, memo = new Map()) {
  let dir = dirname(filePath)
  const seen = []
  while (dir.startsWith(root) && dir !== root) {
    if (memo.has(dir)) {
      const hit = memo.get(dir)
      for (const d of seen) memo.set(d, hit)
      return hit
    }
    seen.push(dir)
    if (existsSync(join(dir, MODEL_JSON))) {
      for (const d of seen) memo.set(d, dir)
      return dir
    }
    dir = dirname(dir)
  }
  for (const d of seen) memo.set(d, null)
  return null
}
