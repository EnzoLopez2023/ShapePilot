// High-level jobs shared by the CLI, launchd agent and local helper.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'
import { ScanCache, scanAll } from './scan.js'
import { applyPlan, buildPlan } from './plan.js'
import { MODEL_JSON, readModelJson, serializeModelJson } from './modeljson.js'
import { OpLog, move, rewrite, trash } from './fsops.js'
import { modelIndex } from './models.js'
import { LibraryClient, buildSnapshot, pullEdits, pushSnapshot } from './sync.js'
import { safeComponent } from './names.js'

let queue = Promise.resolve()

/** Serializes filesystem-changing jobs (launchd runs and helper requests can overlap). */
export function exclusive(job) {
  const run = queue.then(job, job)
  queue = run.catch(() => undefined)
  return run
}

export function planPath(config) {
  return join(config.libraryRoot, '_Library', 'migration-plan.json')
}

export function readSavedPlan(config) {
  const path = planPath(config)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

function savePlan(config, plan) {
  const path = planPath(config)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(plan, null, 2))
}

/** Files settled downloads. Returns { batch, filed, failed, waiting }. */
export function runIntake(config, { cache = new ScanCache(config.cacheDir), dryRun = false } = {}) {
  const roots = [{ path: config.libraryRoot, type: 'library' }, ...config.intakeRoots.map((path) => ({ path, type: 'intake' }))]
  const { records } = scanAll(config, { cache, roots })
  const plan = buildPlan(config, records, { intakeOnly: true })
  const waiting = plan.skipped.filter((s) => s.reason.startsWith('still downloading')).length
  if (!plan.models.length) return { batch: null, filed: [], failed: [], waiting }
  const result = applyPlan(config, plan, { dryRun, kind: 'intake' })
  return {
    batch: result.batch,
    filed: result.results.filter((r) => r.ok).map((r) => r.title),
    failed: result.results.filter((r) => !r.ok),
    waiting,
  }
}

/** Pull edits -> scan -> refresh plan -> push. */
export async function runSync(config, { cache = new ScanCache(config.cacheDir), fetchImpl } = {}) {
  const client = new LibraryClient(config, fetchImpl)
  const startedAt = new Date().toISOString()
  const edits = await pullEdits(config, client, modelIndex(config.libraryRoot))
  const { records } = scanAll(config, { cache })
  const plan = buildPlan(config, records)
  savePlan(config, plan)
  const models = buildSnapshot(config, records)
  const pushed = await pushSnapshot(config, client, { models, plan, cache, startedAt })
  return { edits, ...pushed, planModels: plan.models.length }
}

export function applySavedPlan(config, ids) {
  const plan = readSavedPlan(config)
  if (!plan) throw new Error('No reorganization plan yet — run a sync first')
  return applyPlan(config, plan, { ids })
}

export function listCategories(config) {
  if (!existsSync(config.libraryRoot)) return []
  return readdirSync(config.libraryRoot, { withFileTypes: true })
    // Legacy status folders (Review, Want to Print…) are migration sources, not categories.
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== '_Library' && !config.legacyFolders[e.name])
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
}

function modelDir(config, modelId) {
  const dir = modelIndex(config.libraryRoot).get(modelId)
  if (!dir) throw Object.assign(new Error('Model folder not found on this Mac'), { status: 404 })
  return dir
}

export function withKind(log, kind) {
  const record = log.record.bind(log)
  log.record = (op) => record({ ...op, kind })
  return log
}

/** Moves a model folder into another category (creating it if new). */
export function fileModel(config, modelId, category, { status } = {}) {
  const name = safeComponent(category)
  if (name === '_Library') throw Object.assign(new Error('Invalid category'), { status: 400 })
  const dir = modelDir(config, modelId)
  const log = withKind(new OpLog(config.libraryRoot), 'file')
  const current = relative(config.libraryRoot, dir).split(sep)[0]
  const finalDir = current === name ? dir : move(log, dir, join(config.libraryRoot, name, basename(dir)))
  const json = readModelJson(finalDir)
  rewrite(log, join(finalDir, MODEL_JSON), serializeModelJson({ ...json, category: name, ...(status ? { status } : {}) }))
  return { batch: log.batch, dir: relative(config.libraryRoot, finalDir) }
}

/** Absolute path of one file inside a model folder, refusing anything outside it. */
export function modelFilePath(config, modelId, relPath) {
  const dir = modelDir(config, modelId)
  const full = join(config.libraryRoot, relPath)
  if (!full.startsWith(dir + sep) || !existsSync(full) || !statSync(full).isFile()) {
    throw Object.assign(new Error('File not found in this model'), { status: 404 })
  }
  return { dir, full }
}

export function trashModelFile(config, modelId, relPath) {
  const { full } = modelFilePath(config, modelId, relPath)
  const log = withKind(new OpLog(config.libraryRoot), 'trash')
  trash(log, full, config.trashDir, 'removed from the Library')
  return { batch: log.batch }
}

/** Moves a whole model folder to the Trash; undo from History brings it (and the model) back. */
export function trashModel(config, modelId) {
  const dir = modelDir(config, modelId)
  const log = withKind(new OpLog(config.libraryRoot), 'trash')
  trash(log, dir, config.trashDir, 'deleted from the Library')
  return { batch: log.batch }
}

export function resolveModelTarget(config, modelId, relPath) {
  return relPath ? modelFilePath(config, modelId, relPath).full : modelDir(config, modelId)
}
