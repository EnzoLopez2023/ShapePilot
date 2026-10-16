// Logged, reversible filesystem operations. Nothing here deletes user data:
// "trash" moves into ~/.Trash (so undo can bring it back), and every op is
// appended to <libraryRoot>/_Library/moves-YYYY-MM-DD.jsonl before returning.

import {
  appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync,
  renameSync, rmdirSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { uniqueName } from './names.js'

export const IGNORABLE = new Set(['.DS_Store', 'Icon\r', 'desktop.ini'])

export class OpLog {
  constructor(libraryRoot, { batch = newBatchId(), dryRun = false } = {}) {
    this.dir = join(libraryRoot, '_Library')
    this.batch = batch
    this.dryRun = dryRun
    this.ops = []
  }

  record(op) {
    const entry = { batch: this.batch, at: new Date().toISOString(), ...op }
    this.ops.push(entry)
    if (this.dryRun) return entry
    mkdirSync(this.dir, { recursive: true })
    appendFileSync(join(this.dir, `moves-${entry.at.slice(0, 10)}.jsonl`), `${JSON.stringify(entry)}\n`)
    return entry
  }
}

export function newBatchId() {
  return `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-${randomUUID().slice(0, 6)}`
}

/** Creates `dir` and any missing parents, logging each so undo can remove them again. */
export function ensureDir(log, dir) {
  if (existsSync(dir)) return
  ensureDir(log, dirname(dir))
  if (!log.dryRun) mkdirSync(dir)
  log.record({ op: 'mkdir', to: dir })
}

/** Moves a file or folder, never overwriting. Returns the final destination path. */
export function move(log, from, to) {
  const dir = dirname(to)
  ensureDir(log, dir)
  const finalTo = join(dir, uniqueName(basename(to), (n) => existsSync(join(dir, n)) && !sameFile(join(dir, n), from)))
  if (finalTo === from) return from
  if (!log.dryRun) {
    try {
      renameSync(from, finalTo)
    } catch (err) {
      if (err.code !== 'EXDEV' || statSync(from).isDirectory()) throw err
      copyFileSync(from, finalTo)
      if (statSync(finalTo).size !== statSync(from).size) throw new Error(`Copy verification failed for ${from}`)
      unlinkSync(from)
    }
  }
  log.record({ op: 'move', from, to: finalTo })
  return finalTo
}

/** True when both paths are the same file (APFS is case-insensitive: "a.stl" and "A.stl"). */
export function sameFile(a, b) {
  try {
    const sa = statSync(a)
    const sb = statSync(b)
    return sa.ino === sb.ino && sa.dev === sb.dev
  } catch {
    return false
  }
}

/**
 * Renames a file or folder. OneDrive's File Provider refuses to move a folder
 * out of its domain when the caller is a launchd agent (errno -11), though each
 * file moves fine, so a folder that cannot move whole moves file by file.
 */
export function renameTree(from, to) {
  try {
    renameSync(from, to)
  } catch (err) {
    if (err.code === 'ENOENT' || existsSync(to) || !statSync(from).isDirectory()) throw err
    mkdirSync(to)
    for (const name of readdirSync(from)) renameTree(join(from, name), join(to, name))
    rmdirSync(from)
  }
}

/** Moves to the user's Trash (recoverable, and reversible via undo). */
export function trash(log, path, trashDir, reason) {
  const to = join(trashDir, uniqueName(basename(path), (n) => existsSync(join(trashDir, n))))
  if (!log.dryRun) renameTree(path, to)
  log.record({ op: 'trash', from: path, to, reason })
  return to
}

/** Writes a new file (used for model.json and extracted ZIP entries). Refuses to overwrite. */
export function writeNew(log, path, data, op = 'write') {
  ensureDir(log, dirname(path))
  if (existsSync(path)) throw new Error(`Refusing to overwrite ${path}`)
  if (!log.dryRun) writeFileSync(path, data)
  log.record({ op, to: path })
  return path
}

/** Rewrites a file the organizer owns (model.json). The previous content is kept in the log for undo. */
export function rewrite(log, path, data) {
  const previous = existsSync(path) ? readFileSync(path, 'utf8') : null
  if (!log.dryRun) writeFileSync(path, data)
  log.record({ op: 'rewrite', to: path, previous })
}

/** Removes empty subfolders below `dir` (deepest first), so a moved-out model leaves no husk. */
function pruneEmptyChildren(log, dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const child = join(dir, entry.name)
    pruneEmptyChildren(log, child)
    const left = readdirSync(child).filter((n) => !IGNORABLE.has(n))
    if (left.length) continue
    if (!log.dryRun) {
      for (const n of readdirSync(child)) unlinkSync(join(child, n))
      rmdirSync(child)
    }
    log.record({ op: 'rmdir', from: child })
  }
}

/** Removes a directory (and empty folders inside it) only if nothing but Finder/OneDrive litter is left. */
export function removeIfEmpty(log, dir, stopAt) {
  if (dir !== stopAt && dir.startsWith(stopAt)) pruneEmptyChildren(log, dir)
  let current = dir
  while (current && current !== stopAt && current.startsWith(stopAt) && existsSync(current)) {
    const entries = readdirSync(current).filter((n) => !IGNORABLE.has(n))
    if (entries.length) return
    if (!log.dryRun) {
      for (const n of readdirSync(current)) unlinkSync(join(current, n))
      rmdirSync(current)
    }
    log.record({ op: 'rmdir', from: current })
    current = dirname(current)
  }
}

export function readLog(libraryRoot) {
  const dir = join(libraryRoot, '_Library')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => /^moves-.*\.jsonl$/.test(n))
    .sort()
    .flatMap((n) => readFileSync(join(dir, n), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)))
}

export function listBatches(libraryRoot) {
  const batches = new Map()
  for (const entry of readLog(libraryRoot)) {
    if (entry.op === 'undo') {
      const undone = batches.get(entry.undoes)
      if (undone) undone.undone = true
      continue
    }
    const b = batches.get(entry.batch) ?? { batch: entry.batch, at: entry.at, ops: 0, undone: false, kind: entry.kind ?? null }
    b.ops += 1
    b.kind ??= entry.kind ?? null
    batches.set(entry.batch, b)
  }
  return [...batches.values()]
}

/** Reverses every op of `batch`, newest first. Returns the number of ops reversed. */
export function undoBatch(libraryRoot, batch, { dryRun = false } = {}) {
  const entries = readLog(libraryRoot).filter((e) => e.batch === batch && e.op !== 'undo').reverse()
  if (!entries.length) throw new Error(`No operations found for batch ${batch}`)
  if (readLog(libraryRoot).some((e) => e.op === 'undo' && e.undoes === batch)) throw new Error(`Batch ${batch} was already undone`)
  const log = new OpLog(libraryRoot, { dryRun })
  for (const e of entries) {
    switch (e.op) {
      case 'move':
      case 'trash':
        if (!existsSync(e.to)) throw new Error(`Cannot undo: ${e.to} no longer exists`)
        if (!dryRun) {
          mkdirSync(dirname(e.from), { recursive: true })
          if (existsSync(e.from) && !sameFile(e.from, e.to)) throw new Error(`Cannot undo: ${e.from} exists again`)
          renameTree(e.to, e.from)
        }
        break
      case 'write':
      case 'extract':
        if (!dryRun && existsSync(e.to)) unlinkSync(e.to)
        break
      case 'rewrite':
        if (dryRun) break
        if (e.previous != null) writeFileSync(e.to, e.previous)
        else if (existsSync(e.to)) unlinkSync(e.to)
        break
      case 'mkdir':
        if (!dryRun && existsSync(e.to)) {
          const left = readdirSync(e.to).filter((n) => !IGNORABLE.has(n))
          if (!left.length) {
            for (const n of readdirSync(e.to)) unlinkSync(join(e.to, n))
            rmdirSync(e.to)
          }
        }
        break
      case 'rmdir':
        if (!dryRun) mkdirSync(e.from, { recursive: true })
        break
      default:
        break
    }
  }
  log.record({ op: 'undo', undoes: batch, count: entries.length })
  return entries.length
}
