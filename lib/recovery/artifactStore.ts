// Artifact store boundary.
//
// Backup bundles and export artifacts live outside SQLite and outside the
// repository. Wave 1 ships a filesystem adapter pointed at a configured
// external destination; the interface is deliberately object-store shaped so an
// app-owned Blob adapter can be added later without the database or any feature
// module learning about Azure.
import { createHash } from 'node:crypto'
import {
  cp, mkdir, readFile, readdir, rm, stat, writeFile,
} from 'node:fs/promises'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'

export interface StoredObject {
  key: string
  bytes: number
  sha256: string
}

export interface ArtifactStore {
  readonly description: string
  put(key: string, data: Uint8Array): Promise<StoredObject>
  putFile(key: string, sourcePath: string): Promise<StoredObject>
  get(key: string): Promise<Uint8Array>
  /** Materialize an object on the local filesystem for restore/verification. */
  fetchToFile(key: string, destinationPath: string): Promise<StoredObject>
  list(prefix: string): Promise<string[]>
  remove(key: string): Promise<void>
}

export class ArtifactStoreError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ArtifactStoreError'
    this.code = code
  }
}

const KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Keys are relative, segment-checked paths: no traversal, no absolute roots. */
export function assertSafeKey(key: string): string {
  if (!key || isAbsolute(key)) {
    throw new ArtifactStoreError('ARTIFACT_KEY_INVALID', 'artifact keys must be relative')
  }
  const segments = normalize(key).split(/[\\/]/)
  for (const segment of segments) {
    if (!KEY_SEGMENT.test(segment)) {
      throw new ArtifactStoreError('ARTIFACT_KEY_INVALID', `invalid artifact key segment "${segment}"`)
    }
  }
  return segments.join('/')
}

const sha256Of = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

export function createFilesystemArtifactStore(root: string): ArtifactStore {
  const base = resolve(root)

  const pathFor = (key: string): string => {
    const safe = assertSafeKey(key)
    const full = resolve(base, safe)
    if (full !== base && !full.startsWith(base + sep)) {
      throw new ArtifactStoreError('ARTIFACT_KEY_ESCAPES_ROOT', 'artifact key escapes the store root')
    }
    return full
  }

  return {
    description: `filesystem:${base}`,

    async put(key, data) {
      const target = pathFor(key)
      await mkdir(join(target, '..'), { recursive: true })
      await writeFile(target, data)
      return { key: assertSafeKey(key), bytes: data.byteLength, sha256: sha256Of(data) }
    },

    async putFile(key, sourcePath) {
      const target = pathFor(key)
      await mkdir(join(target, '..'), { recursive: true })
      await cp(sourcePath, target)
      const data = await readFile(target)
      return { key: assertSafeKey(key), bytes: data.byteLength, sha256: sha256Of(data) }
    },

    async get(key) {
      return readFile(pathFor(key))
    },

    async fetchToFile(key, destinationPath) {
      const source = pathFor(key)
      await mkdir(join(destinationPath, '..'), { recursive: true })
      await cp(source, destinationPath)
      const data = await readFile(destinationPath)
      return { key: assertSafeKey(key), bytes: data.byteLength, sha256: sha256Of(data) }
    },

    async list(prefix) {
      const dir = prefix ? pathFor(prefix) : base
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        return entries.map((entry) => (prefix ? `${assertSafeKey(prefix)}/${entry.name}` : entry.name)).sort()
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      }
    },

    async remove(key) {
      await rm(pathFor(key), { force: true })
    },
  }
}

export async function assertDirectory(path: string, label: string): Promise<void> {
  try {
    const details = await stat(path)
    if (!details.isDirectory()) {
      throw new ArtifactStoreError('ARTIFACT_ROOT_INVALID', `${label} is not a directory`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await mkdir(path, { recursive: true })
      return
    }
    throw error
  }
}
