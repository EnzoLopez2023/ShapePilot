// Reorganization planner. Turns scan records (plus model-bearing ZIPs and
// folders in Downloads) into a per-model plan: where each model goes, what it
// is called, which copies are exact duplicates. Nothing moves until `applyPlan`
// runs with the ids you approved.

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import { unzipSync } from 'fflate'
import { guessCategory } from './config.js'
import { cleanFilename, cleanStem, groupKey, isGenericTitle, isModelFile, modelExtension, safeComponent, uniqueName } from './names.js'
import { findModelDir, newModelJson, readModelJson, serializeModelJson } from './modeljson.js'
import { OpLog, move, removeIfEmpty, trash, writeNew } from './fsops.js'

const STATUS_RANK = { printed: 5, failed: 4, want: 3, queued: 3, inbox: 2, skip: 1 }
const COMPANION_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.pdf', '.txt', '.md', '.html', '.json', '.csv',
  '.f3d', '.f3z', '.scad', '.fcstd', '.skp', '.dxf', '.svg', '.3ds', '.blend', '.gcode', '.py',
])
const LITTER = new Set(['.DS_Store', 'Icon\r', 'desktop.ini', 'Thumbs.db'])
const MAX_ZIP_BYTES = 1024 * 1024 * 1024

export function isCompanionFile(name) {
  return COMPANION_EXT.has(extname(name).toLowerCase())
}

/** Lists files below a folder; `ok` is false if anything is neither a model nor a companion file. */
export function inspectFolder(dir) {
  const files = []
  let ok = true
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (LITTER.has(entry.name) || entry.name.startsWith('._')) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== '__MACOSX') stack.push(full)
      } else if (isModelFile(entry.name)) {
        files.push({ path: full, model: true })
      } else {
        if (!isCompanionFile(entry.name)) ok = false
        files.push({ path: full, model: false })
      }
    }
  }
  return { ok, files, modelCount: files.filter((f) => f.model).length }
}

/** Reads a ZIP's listing; returns model/companion entries or null if it is not a model download. */
export function inspectZip(path) {
  const size = statSync(path).size
  if (size > MAX_ZIP_BYTES) return null
  let entries
  try {
    entries = unzipSync(new Uint8Array(readFileSync(path)), { filter: (f) => !f.name.endsWith('/') && !f.name.startsWith('__MACOSX/') })
  } catch {
    return null
  }
  const names = Object.keys(entries).filter((n) => !LITTER.has(basename(n)) && !basename(n).startsWith('._'))
  const models = names.filter((n) => isModelFile(basename(n)))
  if (!models.length || names.some((n) => !isModelFile(basename(n)) && !isCompanionFile(n))) return null
  // Strip a single shared top-level folder ("thing/files/a.stl" -> "files/a.stl").
  const tops = new Set(names.map((n) => n.split('/')[0]))
  const strip = tops.size === 1 && names.every((n) => n.includes('/')) ? `${[...tops][0]}/` : ''
  return names.map((name) => ({
    name,
    rel: name.slice(strip.length),
    model: isModelFile(basename(name)),
    size: entries[name].length,
    sha256: createHash('sha256').update(entries[name]).digest('hex'),
  }))
}

function newUnit(source) {
  return { files: [], extras: [], zip: null, sourceDirs: new Set(), ...source }
}

/**
 * Builds the plan. `records` come from `scanAll`. Intake folders/ZIPs are
 * discovered here. Returns a JSON-serializable plan.
 */
export function buildPlan(config, records, { intakeOnly = false, now = Date.now() } = {}) {
  const root = config.libraryRoot
  const memo = new Map()
  const organized = [] // records already inside a model folder
  const units = new Map() // key -> unit
  const skipped = []
  const settleMs = (config.settleSeconds ?? 10) * 1000

  const unitFor = (key, init) => {
    if (!units.has(key)) units.set(key, newUnit({ key, ...init }))
    return units.get(key)
  }

  for (const r of records) {
    if (r.rootType === 'indexOnly') continue
    if (r.rootType === 'library') {
      const modelDir = findModelDir(r.path, root, memo)
      if (modelDir) {
        organized.push({ ...r, modelDir })
        continue
      }
      if (intakeOnly) {
        // Not being reorganized now, but still the copy to keep if a download duplicates it.
        organized.push({ ...r, modelDir: null })
        continue
      }
      const parts = r.relPath.split(sep)
      const top = parts.length > 1 ? parts[0] : null
      const legacy = top ? config.legacyFolders[top] : null
      if (legacy?.leave) {
        skipped.push({ path: r.path, reason: `${top} is left as-is` })
        continue
      }
      const category = top === '_Inbox' ? '_Inbox' : top === '_Archive' ? '_Archive' : legacy ? legacy.category : top
      const status = legacy?.status ?? (top === '_Archive' ? 'skip' : 'inbox')
      const base = { origin: 'library', sourceLabel: top ?? '(library root)', category, status }
      if (parts.length >= 3) {
        const folder = join(root, parts[0], parts[1])
        const unit = unitFor(`dir:${folder}`, { ...base, folder, folderName: parts[1] })
        unit.files.push(r)
      } else {
        const unit = unitFor(`loose:${top ?? ''}:${looseKey(r)}`, base)
        unit.files.push(r)
        unit.sourceDirs.add(dirname(r.path))
      }
    } else if (r.rootType === 'intake') {
      if (now - r.mtimeMs < settleMs) {
        skipped.push({ path: r.path, reason: 'still downloading (recently modified)' })
        continue
      }
      const parts = r.relPath.split(sep)
      const base = { origin: 'intake', sourceLabel: basename(r.root), category: null, status: 'inbox' }
      if (parts.length >= 2) {
        const folder = join(r.root, parts[0])
        const unit = unitFor(`dir:${folder}`, { ...base, folder, folderName: parts[0] })
        unit.files.push(r)
      } else {
        const unit = unitFor(`loose:intake:${looseKey(r)}`, base)
        unit.files.push(r)
      }
    }
  }

  // Intake folders must contain only model + companion files; otherwise leave them alone.
  for (const [key, unit] of units) {
    if (!unit.folder) continue
    const info = inspectFolder(unit.folder)
    if (unit.origin === 'intake' && !info.ok) {
      units.delete(key)
      skipped.push({ path: unit.folder, reason: 'folder has non-model files; not moved' })
      continue
    }
    unit.extras = info.files.filter((f) => !f.model).map((f) => ({ path: f.path, rel: relative(unit.folder, f.path) }))
    unit.sourceDirs.add(unit.folder)
  }

  // Model ZIPs at the top of intake roots.
  for (const intakeRoot of config.intakeRoots) {
    if (!existsSync(intakeRoot)) continue
    for (const name of readdirSync(intakeRoot)) {
      if (!name.toLowerCase().endsWith('.zip')) continue
      const path = join(intakeRoot, name)
      const stat = statSync(path)
      if (now - stat.mtimeMs < settleMs) continue
      const entries = inspectZip(path)
      if (!entries) continue
      const unit = unitFor(`zip:${path}`, { origin: 'intake', sourceLabel: basename(intakeRoot), category: null, status: 'inbox' })
      unit.zip = { path, size: stat.size, entries }
      unit.folderName = name.replace(/\.zip$/i, '')
    }
  }

  // Merge units that are obviously the same model (x.zip + unzipped x/ folder, x.stl + x (2).3mf across folders).
  const byTitle = new Map()
  for (const unit of units.values()) {
    unit.title = unitTitle(unit)
    const k = groupKey(unit.title)
    if (!byTitle.has(k)) byTitle.set(k, [])
    byTitle.get(k).push(unit)
  }
  for (const [k, group] of byTitle) {
    // Generic titles ("Untitled model", "Plate") say nothing about identity; never merge on them.
    if (group.length < 2 || isGenericTitle(k)) continue
    group.sort((a, b) => unitRank(b) - unitRank(a))
    const [keep, ...rest] = group
    for (const other of rest) {
      // A download joins a library model only with hard evidence, not just a shared title.
      if (keep.origin !== other.origin && !sameModelEvidence(keep, other)) continue
      keep.files.push(...other.files)
      keep.extras.push(...other.extras)
      for (const d of other.sourceDirs) keep.sourceDirs.add(d)
      if (other.zip && !keep.zip) keep.zip = other.zip
      else if (other.zip) keep.mergedZips = [...(keep.mergedZips ?? []), other.zip]
      keep.mergedFrom = [...(keep.mergedFrom ?? []), other.key]
      units.delete(other.key)
    }
  }

  // Exact duplicates (sha256): keep one copy, send the rest to the Trash.
  const winners = new Map() // sha -> { path, unitKey|null }
  for (const r of organized) if (!winners.has(r.sha256)) winners.set(r.sha256, { path: r.path, unitKey: null })
  const ordered = [...units.values()].sort((a, b) => unitRank(b) - unitRank(a))
  for (const unit of ordered) {
    unit.files.sort((a, b) => fileRank(b) - fileRank(a))
    const kept = []
    unit.trash = []
    for (const f of unit.files) {
      const winner = winners.get(f.sha256)
      if (winner) {
        unit.trash.push({ path: f.path, size: f.size, reason: `identical to ${winner.path}` })
      } else {
        winners.set(f.sha256, { path: f.path, unitKey: unit.key })
        kept.push(f)
      }
    }
    unit.files = kept
    if (unit.zip) {
      unit.zip.entries = unit.zip.entries.map((e) => {
        if (!e.model) return e
        const winner = winners.get(e.sha256)
        if (winner) return { ...e, skip: `identical to ${winner.path}` }
        winners.set(e.sha256, { path: `${unit.zip.path}:${e.name}`, unitKey: unit.key })
        return e
      })
    }
    for (const z of unit.mergedZips ?? []) unit.trash.push({ path: z.path, size: z.size, reason: 'ZIP of a model already being filed' })
  }

  // Destinations.
  const takenDirs = new Set()
  const plannedModels = []
  for (const unit of ordered) {
    const zipModels = unit.zip ? unit.zip.entries.filter((e) => e.model && !e.skip) : []
    const hasContent = unit.files.length || zipModels.length
    const lead = unit.files.find((f) => f.meta?.Title) ?? unit.files[0] ?? null
    const texts = [unit.title, unit.folderName, ...unit.files.flatMap((f) => [f.filename, f.relPath, ...(f.plates ?? []).flatMap((p) => p.objects ?? [])]), ...(unit.zip?.entries ?? []).map((e) => e.name)]
    const suggestedCategory = unit.files.some((f) => f.generator === 'shapepilot') ? 'ShapePilot' : guessCategory(config, texts)
    let category = unit.category
    if (unit.status === 'skip') category = '_Archive'
    else if (unit.origin === 'intake') category = suggestedCategory === 'ShapePilot' ? 'ShapePilot' : '_Inbox'
    else if (!category) category = suggestedCategory ?? '_Inbox'

    const model = {
      id: createHash('sha1').update([...unit.files.map((f) => f.path), unit.zip?.path ?? '', unit.key].sort().join('\n')).digest('hex').slice(0, 16),
      title: unit.title,
      origin: unit.origin,
      sourceLabel: unit.sourceLabel,
      category,
      suggestedCategory,
      status: unit.status,
      dest: null,
      thumb: lead?.thumb ?? unit.files.find((f) => f.thumb)?.thumb ?? null,
      designer: lead?.meta?.Designer ?? null,
      moves: [],
      extract: null,
      trash: unit.trash,
      removeDirs: [...unit.sourceDirs],
      leadRecord: lead ? { meta: lead.meta, generator: lead.generator } : null,
    }
    if (hasContent) {
      const destDir = uniqueDir(join(root, category), safeComponent(unit.title), takenDirs, unit.folder)
      takenDirs.add(destDir)
      model.dest = destDir
      const names = new Set()
      const claim = (name) => {
        const final = uniqueName(name, (n) => names.has(n.toLowerCase()))
        names.add(final.toLowerCase())
        return final
      }
      for (const f of unit.files) model.moves.push({ from: f.path, to: join(destDir, claim(cleanFilename(f.filename))), sha256: f.sha256, size: f.size, kind: 'model' })
      for (const e of unit.extras) model.moves.push({ from: e.path, to: join(destDir, e.rel), kind: 'extra' })
      if (unit.zip) {
        model.extract = {
          zip: unit.zip.path,
          entries: unit.zip.entries
            .filter((e) => !e.skip)
            .map((e) => ({ name: e.name, to: join(destDir, e.model ? claim(cleanFilename(basename(e.rel))) : e.rel), sha256: e.sha256, size: e.size })),
          skipped: unit.zip.entries.filter((e) => e.skip).map((e) => ({ name: e.name, reason: e.skip })),
        }
      }
      // Moves whose source already equals the destination are no-ops; drop them.
      model.moves = model.moves.filter((m) => m.from !== m.to)
    } else if (unit.zip) {
      model.trash.push({ path: unit.zip.path, size: unit.zip.size, reason: 'every model in this ZIP is already in the library' })
    }
    if (model.moves.length || model.extract || model.trash.length) plannedModels.push(model)
  }

  return {
    version: 1,
    createdAt: new Date(now).toISOString(),
    libraryRoot: root,
    intakeOnly,
    models: plannedModels,
    skipped,
    summary: summarize(plannedModels, new Set(organized.filter((r) => r.modelDir).map((r) => r.modelDir)).size),
  }
}

function unitTitle(unit) {
  // Folders and ZIPs are named by the person who made them; loose files by their best metadata.
  if (unit.folderName) {
    const folderTitle = folderStem(unit.folderName)
    if (!isGenericTitle(folderTitle) && !MAKERWORLD_ID.test(folderTitle)) return safeComponent(folderTitle)
  }
  const withTitle = unit.files.find((f) => f.meta?.Title && !isGenericTitle(f.meta.Title))
  return withTitle?.title ?? unit.files[0]?.title ?? 'Untitled model'
}

/** Loose files group by cleaned name, except generic names ("Untitled_model (3)") which stay separate. */
function looseKey(r) {
  return isGenericTitle(r.groupKey) ? `file:${r.path}` : r.groupKey
}

/** Identical bytes, identical geometry, or the same MakerWorld design. */
function sameModelEvidence(a, b) {
  const keys = (unit) => {
    const set = new Set()
    for (const f of unit.files) {
      set.add(`sha:${f.sha256}`)
      if (f.geomHash) set.add(`geom:${f.geomHash}`)
      if (f.meta?.DesignModelId) set.add(`mw:${f.meta.DesignModelId}`)
    }
    for (const e of unit.zip?.entries ?? []) set.add(`sha:${e.sha256}`)
    return set
  }
  const ka = keys(a)
  for (const k of keys(b)) if (ka.has(k)) return true
  return false
}

const MAKERWORLD_ID = /^US[0-9a-f]{10,}\b/i

/** Folder names from downloads often end in "_stls" / "files": drop that noise. */
export function folderStem(name) {
  return cleanStem(name.replace(/[\s_+-]*(?:stls?|stl files|3mfs?|files)$/i, '') || name)
}

function unitRank(unit) {
  return (STATUS_RANK[unit.status] ?? 0) * 10 + (unit.origin === 'library' ? 5 : 0) + (unit.folder ? 1 : 0)
}

function fileRank(f) {
  // Prefer names without browser copy suffixes, then files with real metadata, then newer.
  const copy = /\(\d+\)\.[^.]+(?:\.[^.]+)?$/.test(f.filename) ? 0 : 4
  const meta = f.meta?.Title ? 2 : 0
  return copy + meta + f.mtimeMs / 1e14
}

function uniqueDir(parent, name, taken, currentFolder) {
  const candidate = (n) => join(parent, n)
  const final = uniqueName(name, (n) => {
    const p = candidate(n)
    return taken.has(p) || (existsSync(p) && p !== currentFolder)
  })
  return candidate(final)
}

function summarize(models, organizedCount) {
  const count = (fn) => models.reduce((n, m) => n + fn(m), 0)
  const byCategory = {}
  for (const m of models) if (m.dest) byCategory[m.category] = (byCategory[m.category] ?? 0) + 1
  return {
    models: models.filter((m) => m.dest).length,
    moves: count((m) => m.moves.length),
    extracts: count((m) => m.extract?.entries.length ?? 0),
    trash: count((m) => m.trash.length),
    trashBytes: count((m) => m.trash.reduce((n, t) => n + (t.size ?? 0), 0)),
    alreadyOrganized: organizedCount,
    byCategory,
  }
}

/**
 * Applies the selected plan entries. Each model is applied independently: a
 * stale entry (source changed since planning) is skipped and reported.
 */
export function applyPlan(config, plan, { ids = null, dryRun = false, kind = 'migrate', notify } = {}) {
  const log = new OpLog(config.libraryRoot, { dryRun })
  const tagged = (op) => ({ ...op, kind })
  const record = log.record.bind(log)
  log.record = (op) => record(tagged(op))
  const results = []
  const selected = plan.models.filter((m) => !ids || ids.includes(m.id))
  for (const model of selected) {
    try {
      const stale = [...model.moves, ...model.trash].find((m) => !existsSync(m.from ?? m.path))
      if (stale) throw new Error(`source changed since planning: ${stale.from ?? stale.path} is missing`)
      if (model.extract && !existsSync(model.extract.zip)) throw new Error(`ZIP is gone: ${model.extract.zip}`)
      const moved = []
      for (const m of model.moves) moved.push({ ...m, to: move(log, m.from, m.to) })
      if (model.extract) {
        const data = unzipSync(new Uint8Array(readFileSync(model.extract.zip)))
        for (const e of model.extract.entries) {
          const buf = data[e.name]
          if (!buf) continue
          const to = join(dirname(e.to), uniqueName(basename(e.to), (n) => existsSync(join(dirname(e.to), n))))
          writeNew(log, to, Buffer.from(buf), 'extract')
          moved.push({ to, sha256: e.sha256, kind: modelExtension(e.to) ? 'model' : 'extra' })
        }
        trash(log, model.extract.zip, config.trashDir, 'extracted into library')
      }
      for (const t of model.trash) if (existsSync(t.path)) trash(log, t.path, config.trashDir, t.reason)
      if (model.dest && !readModelJson(model.dest)) {
        const data = newModelJson({
          title: model.title,
          category: model.category,
          status: model.status,
          record: model.leadRecord,
          files: moved.filter((m) => m.kind === 'model').map((m) => ({ name: basename(m.to), sha256: m.sha256 })),
          origin: [...model.moves.map((m) => m.from), ...(model.extract ? [model.extract.zip] : [])],
        })
        writeNew(log, join(model.dest, 'model.json'), serializeModelJson(data))
      }
      for (const dir of model.removeDirs) {
        const stopAt = [config.libraryRoot, ...config.intakeRoots].find((r) => dir.startsWith(r + sep)) ?? dir
        removeIfEmpty(log, dir, stopAt)
      }
      results.push({ id: model.id, title: model.title, ok: true })
    } catch (err) {
      results.push({ id: model.id, title: model.title, ok: false, error: err.message })
    }
  }
  notify?.(results)
  return { batch: log.batch, results, ops: log.ops.length }
}
