// Finds organized model folders (those holding a model.json) and maps ids to folders.

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { MODEL_JSON, readModelJson } from './modeljson.js'

/** Yields every folder under `root` (max 4 levels) that contains model.json. */
export function* walkModelJsons(root, maxDepth = 4) {
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
    if (dir !== root && entries.some((e) => e.isFile() && e.name === MODEL_JSON)) {
      yield dir
      continue
    }
    if (depth >= maxDepth) continue
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== '_Library') stack.push([join(dir, e.name), depth + 1])
    }
  }
}

/** Map of model id -> folder path. */
export function modelIndex(root) {
  const index = new Map()
  for (const dir of walkModelJsons(root)) {
    const json = readModelJson(dir)
    if (json) index.set(json.id, dir)
  }
  return index
}
