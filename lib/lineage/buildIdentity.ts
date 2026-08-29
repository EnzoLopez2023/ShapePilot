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
  if (!parsed.app
    || !parsed.version
    || !parsed.build
    || !parsed.commit
    || !parsed.builtAt
    || !parsed.sourceLineage?.commit) {
    throw new Error('version.json is missing required build identity fields')
  }
  return Object.freeze({
    ...parsed,
    sourceLineage: Object.freeze(parsed.sourceLineage),
  })
}

/** Read the identity baked into the image. Runtime overrides are deliberately forbidden. */
export function buildIdentity(): BuildIdentity {
  if (cached) return cached
  cached = readVersionFile()
  return cached
}

export function assertProductionBuildIdentity(identity: BuildIdentity): void {
  if (!/^[0-9a-f]{40}$/.test(identity.commit)) {
    throw new Error('production build identity commit must be a full lowercase Git SHA')
  }
  if (!/^[0-9]+-[0-9]+$/.test(identity.build)) {
    throw new Error('production build identity build must be <run-id>-<run-attempt>')
  }
  const builtAt = new Date(identity.builtAt)
  if (!Number.isFinite(builtAt.valueOf()) || builtAt.toISOString() !== identity.builtAt) {
    throw new Error('production build identity builtAt must be canonical UTC ISO-8601')
  }
}

/** Test-only: forget the memoized identity. */
export const resetBuildIdentityCache = (): void => { cached = null }
