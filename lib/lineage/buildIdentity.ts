// Immutable build and source lineage.
//
// version.json is written once at build time and never mutated at runtime.
// /api/version and /version.json both serve exactly this object, so a running
// instance can always be tied back to the commit and the Hearth source it was
// extracted from.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export interface SourceLineage {
  repository: string
  commit: string
  tree: string
  version: string
  build: number
  imageDigest: string
}

export interface BuildIdentity {
  app: string
  version: string
  build: string
  commit: string
  builtAt: string
  sourceLineage: SourceLineage
}

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

let cached: BuildIdentity | null = null

function readVersionFile(): BuildIdentity {
  const raw = readFileSync(join(REPO_ROOT, 'version.json'), 'utf8')
  const parsed = JSON.parse(raw) as BuildIdentity
  if (!parsed.app || !parsed.version || !parsed.sourceLineage?.commit) {
    throw new Error('version.json is missing required build identity fields')
  }
  return Object.freeze({
    ...parsed,
    sourceLineage: Object.freeze(parsed.sourceLineage),
  })
}

/** Environment overrides let CI stamp a build without rewriting the file in place. */
export function buildIdentity(env: NodeJS.ProcessEnv = process.env): BuildIdentity {
  if (cached) return cached
  const base = readVersionFile()
  cached = Object.freeze({
    ...base,
    build: env.SHAPEPILOT_BUILD_ID?.trim() || base.build,
    commit: env.SHAPEPILOT_COMMIT_SHA?.trim() || base.commit,
    builtAt: env.SHAPEPILOT_BUILT_AT?.trim() || base.builtAt,
  })
  return cached
}

/** Test-only: forget the memoized identity. */
export const resetBuildIdentityCache = (): void => { cached = null }
