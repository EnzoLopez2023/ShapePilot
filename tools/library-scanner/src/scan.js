// Walks the configured roots and analyzes every model file: hashes, 3MF
// metadata, dimensions and thumbnails. Results are cached by path + size +
// mtime so repeat scans only touch new or changed files.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { readStl, shapePilotName } from './stl.js'
import { readThreeMf } from './threemf.js'
import { boundingBox, geometryHash, volume } from './mesh.js'
import { renderThumbnail } from './render.js'
import { cleanFilename, cleanStem, groupKey, isModelFile, modelKind, pickTitle } from './names.js'

const SKIP_DIRS = new Set(['node_modules', '.git', '$RECYCLE.BIN', '_Library', '__MACOSX', '.Trash'])
const CACHE_VERSION = 4
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Yields absolute paths of model files below `root` (skips hidden and tool folders). */
export function* walkModels(root, { maxDepth = 12 } = {}) {
  if (!existsSync(root)) return
  const stack = [[root, 0]]
  while (stack.length) {
    const [dir, depth] = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && depth < maxDepth) stack.push([full, depth + 1])
      } else if (entry.isFile() && isModelFile(entry.name) && !/^bbl-3dp-/i.test(entry.name)) {
        yield full
      }
    }
  }
}

export class ScanCache {
  constructor(cacheDir) {
    this.dir = cacheDir
    this.thumbDir = join(cacheDir, 'thumbs')
    this.file = join(cacheDir, 'index.json')
    mkdirSync(this.thumbDir, { recursive: true })
    this.entries = {}
    if (existsSync(this.file)) {
      try {
        const data = JSON.parse(readFileSync(this.file, 'utf8'))
        if (data.version === CACHE_VERSION) this.entries = data.entries
      } catch {
        this.entries = {}
      }
    }
  }

  get(path, stat) {
    const hit = this.entries[path]
    return hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs ? hit.record : null
  }

  set(path, stat, record) {
    this.entries[path] = { size: stat.size, mtimeMs: stat.mtimeMs, record }
  }

  /** Stores a PNG by content hash; returns the hash. */
  putThumb(png) {
    // Only real PNGs: the Library serves thumbnails as image/png, and some slicers embed JPEGs or junk.
    if (!png || png.length < 16 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return null
    const hash = createHash('sha256').update(png).digest('hex')
    const path = join(this.thumbDir, `${hash}.png`)
    if (!existsSync(path)) writeFileSync(path, png)
    return hash
  }

  thumbPath(hash) {
    return join(this.thumbDir, `${hash}.png`)
  }

  prune(livePaths) {
    for (const path of Object.keys(this.entries)) if (!livePaths.has(path)) delete this.entries[path]
  }

  save() {
    writeFileSync(this.file, JSON.stringify({ version: CACHE_VERSION, entries: this.entries }))
  }
}

/** Analyzes one model file. Never throws: parse problems are reported in `error`. */
export function analyzeFile(path, cache, { render = true } = {}) {
  const stat = statSync(path)
  const cached = cache?.get(path, stat)
  if (cached) return cached
  const filename = basename(path)
  const buffer = readFileSync(path)
  const record = {
    path,
    filename,
    kind: modelKind(filename),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    geomHash: null,
    triangles: null,
    bbox: null,
    volume: null,
    isSliced: false,
    generator: null,
    meta: {},
    plates: [],
    printer: null,
    nozzle: null,
    layerHeight: null,
    printProfile: null,
    filaments: [],
    seconds: null,
    grams: null,
    thumb: null,
    plateThumbs: [],
    title: null,
    cleanName: cleanFilename(filename),
    groupKey: groupKey(filename),
    error: null,
  }
  try {
    let tris = null
    let headerName = null
    let objectNames = []
    if (record.kind === 'stl') {
      const stl = readStl(buffer)
      tris = stl.tris
      headerName = shapePilotName(stl.header)
      if (headerName) record.generator = 'shapepilot'
    } else if (record.kind === '3mf') {
      const mf = readThreeMf(buffer)
      tris = mf.tris
      objectNames = mf.objectNames
      const m = mf.metadata
      record.meta = pick(m, ['Title', 'Designer', 'DesignerUserId', 'DesignModelId', 'DesignProfileId', 'DesignRegion', 'License', 'Description', 'ProfileTitle', 'CreationDate', 'Origin'])
      record.generator = /shapepilot/i.test(mf.application ?? '') ? 'shapepilot' : /bambu/i.test(mf.application ?? '') ? 'bambustudio' : /orca/i.test(mf.application ?? '') ? 'orcaslicer' : mf.application ? 'other' : null
      record.isSliced = mf.isSliced
      record.plates = mf.plates.map(({ index, name, objects, seconds, grams, filaments }) => ({ index, name, objects, seconds, grams, filaments }))
      record.printer = mf.printer
      record.nozzle = mf.nozzle
      record.layerHeight = mf.layerHeight
      record.printProfile = mf.printProfile
      record.filaments = mf.filaments
      record.seconds = mf.seconds
      record.grams = mf.grams
      if (cache) {
        record.thumb = cache.putThumb(mf.hero)
        record.plateThumbs = mf.plateImages.map((p) => ({ index: p.index, thumb: cache.putThumb(p.png) }))
      }
    }
    if (tris && tris.length) {
      record.triangles = tris.length / 9
      const box = boundingBox(tris)
      record.bbox = box?.size ?? null
      record.volume = volume(tris)
      record.geomHash = geometryHash(tris)
      if (render && cache && !record.thumb) record.thumb = cache.putThumb(renderThumbnail(tris))
    }
    record.title = pickTitle({ filename, metaTitle: record.meta.Title, headerName, objectNames })
  } catch (err) {
    record.error = err.message
    record.title = pickTitle({ filename })
  }
  record.cleanTitle = cleanStem(filename)
  cache?.set(path, stat, record)
  return record
}

/**
 * Scans every configured root. Returns `{ records, errors }`, where each record
 * carries `root`, `rootType` (library | intake | indexOnly) and `relPath`.
 */
export function scanAll(config, { cache = new ScanCache(config.cacheDir), onProgress, roots } = {}) {
  const plan = roots ?? [
    { path: config.libraryRoot, type: 'library' },
    ...config.intakeRoots.map((path) => ({ path, type: 'intake' })),
    ...config.indexOnlyRoots.map((path) => ({ path, type: 'indexOnly' })),
  ]
  const records = []
  const live = new Set()
  for (const root of plan) {
    // Intake roots: only files near the top (Downloads/<file> or Downloads/<folder>/...).
    const maxDepth = root.type === 'intake' ? 4 : 12
    for (const path of walkModels(root.path, { maxDepth })) {
      live.add(path)
      const record = analyzeFile(path, cache)
      records.push({ ...record, root: root.path, rootType: root.type, relPath: relative(root.path, path) })
      onProgress?.(records.length, path)
    }
  }
  if (!roots) cache.prune(live)
  cache.save()
  return { records, errors: records.filter((r) => r.error) }
}

function pick(obj, keys) {
  const out = {}
  for (const k of keys) if (obj[k] != null) out[k] = obj[k]
  return out
}
