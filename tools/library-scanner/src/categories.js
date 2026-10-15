// Category management. Categories are the library's top-level folders, so
// creating, renaming, merging and deleting them are folder operations on this
// Mac. Every change is logged (and undoable from Organize → History), every
// affected model.json is rewritten to the new category, and nothing is ever
// deleted: only a folder with nothing left in it can be removed.

import { existsSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { IGNORABLE, OpLog, ensureDir, move, removeIfEmpty, rewrite, sameFile } from './fsops.js'
import { MODEL_JSON, readModelJson, serializeModelJson } from './modeljson.js'
import { modelIndex } from './models.js'
import { safeComponent } from './names.js'
import { listCategories, withKind } from './run.js'

// Intake and the organizer file into these by name, so they can't be renamed or removed.
export const PROTECTED_CATEGORIES = new Set(['_Inbox', '_Archive', 'ShapePilot'])

const fail = (status, message) => Object.assign(new Error(message), { status })

/** Every category with how many model folders it holds (empty categories included). */
export function listCategoryDetails(config) {
  const counts = new Map()
  for (const dir of modelIndex(config.libraryRoot).values()) {
    const top = relative(config.libraryRoot, dir).split(sep)[0]
    counts.set(top, (counts.get(top) ?? 0) + 1)
  }
  return listCategories(config).map((name) => ({
    name,
    models: counts.get(name) ?? 0,
    protected: PROTECTED_CATEGORIES.has(name),
  }))
}

export function cleanCategoryName(config, raw) {
  const name = safeComponent(raw, '')
  if (!name) throw fail(400, 'Enter a category name')
  if (name.startsWith('_') || name === '_Library') throw fail(400, 'Names starting with "_" are reserved for the organizer')
  if (config.legacyFolders[name]) throw fail(400, `"${name}" is a legacy folder the organizer migrates from`)
  return name
}

function existingCategory(config, name) {
  const match = listCategories(config).find((c) => c === name)
  if (!match) throw fail(404, `Category "${name}" not found on this Mac`)
  return join(config.libraryRoot, match)
}

function assertEditable(name) {
  if (PROTECTED_CATEGORIES.has(name)) throw fail(400, `${name} is managed by the organizer and can't be changed`)
}

/** A folder already using `name` (case-insensitively, as APFS does), other than `except`. */
function clash(config, name, except) {
  const lower = name.toLowerCase()
  const hit = readdirSync(config.libraryRoot).find((n) => n.toLowerCase() === lower)
  if (!hit) return null
  const path = join(config.libraryRoot, hit)
  return except && sameFile(path, except) ? null : hit
}

/** Points every model.json under `dir` at `category`. */
function rewriteCategory(log, config, dir, category) {
  let count = 0
  for (const modelDir of modelIndex(config.libraryRoot).values()) {
    if (modelDir !== dir && !modelDir.startsWith(dir + sep)) continue
    count += 1
    const json = readModelJson(modelDir)
    if (json && json.category !== category) {
      rewrite(log, join(modelDir, MODEL_JSON), serializeModelJson({ ...json, category }))
    }
  }
  return count
}

export function createCategory(config, raw) {
  const name = cleanCategoryName(config, raw)
  const existing = clash(config, name)
  if (existing) throw fail(409, `"${existing}" already exists`)
  const log = withKind(new OpLog(config.libraryRoot), 'category')
  ensureDir(log, join(config.libraryRoot, name))
  return { batch: log.batch, name }
}

export function renameCategory(config, from, raw) {
  assertEditable(from)
  const src = existingCategory(config, from)
  const name = cleanCategoryName(config, raw)
  if (name === from) return { batch: null, name, models: 0 }
  const existing = clash(config, name, src)
  if (existing) throw fail(409, `"${existing}" already exists. Merge into it instead.`)
  const log = withKind(new OpLog(config.libraryRoot), 'category')
  const dest = move(log, src, join(config.libraryRoot, name))
  const models = rewriteCategory(log, config, dest, name)
  return { batch: log.batch, name, models }
}

/** Moves everything in `from` into `into` (model folders keep unique names), then removes `from`. */
export function mergeCategory(config, from, into) {
  assertEditable(from)
  const src = existingCategory(config, from)
  const target = existingCategory(config, into)
  if (src === target) throw fail(400, 'Choose a different category to merge into')
  const log = withKind(new OpLog(config.libraryRoot), 'category')
  let moved = 0
  for (const entry of readdirSync(src)) {
    if (IGNORABLE.has(entry)) continue
    move(log, join(src, entry), join(target, entry))
    moved += 1
  }
  rewriteCategory(log, config, target, into)
  removeIfEmpty(log, src, config.libraryRoot)
  return { batch: log.batch, name: into, moved }
}

/** Removes a category folder only when nothing but Finder/OneDrive litter is left in it. */
export function deleteCategory(config, name) {
  assertEditable(name)
  const src = existingCategory(config, name)
  const left = readdirSync(src).filter((n) => !IGNORABLE.has(n))
  if (left.length) throw fail(409, `${name} still holds ${left.length} item${left.length === 1 ? '' : 's'}. Merge it into another category instead.`)
  const log = withKind(new OpLog(config.libraryRoot), 'category')
  removeIfEmpty(log, src, config.libraryRoot)
  return { batch: log.batch, name, removed: !existsSync(src) }
}
