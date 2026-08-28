// Artifact store boundary.
//
// Backup bundles and export artifacts live outside SQLite and outside the
// repository. Wave 1 ships a filesystem adapter pointed at a configured
// external destination; the interface is deliberately object-store shaped so an
// app-owned Blob adapter can be added later without the database or any feature
// module learning about Azure.
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { closeSync, fstatSync, lstatSync, openSync } from 'node:fs'
import {
  access, lstat, mkdir, open,
} from 'node:fs/promises'
import { spawn } from 'node:child_process'
import type { ChildProcess, StdioOptions } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { basename, dirname, isAbsolute, normalize, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import type { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

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
  /**
   * Materialize into an exclusive invocation-owned temporary path. The caller
   * owns cleanup of that temporary directory on every outcome.
   */
  fetchToFile(key: string, destinationPath: string): Promise<StoredObject>
  list(prefix: string): Promise<string[]>
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
    if (segment === '.shapepilot-staging' || segment.startsWith('.shapepilot-tmp-')) {
      throw new ArtifactStoreError('ARTIFACT_KEY_INVALID', 'artifact key uses a reserved segment')
    }
  }
  return segments.join('/')
}

const sha256Of = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const guardPath = resolve(import.meta.dirname, '../../native/build/artifact-store-guard')
const MAX_BUFFERED_OBJECT_BYTES = 1024 * 1024

interface GuardProcess {
  child: ChildProcess
  input: Writable
  output: Readable
  control?: Writable
  completion: Promise<void>
}

export function createFilesystemArtifactStore(root: string): ArtifactStore {
  const base = resolve(root)
  let rootFd: number
  try {
    rootFd = openSync(base, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    const held = fstatSync(rootFd, { bigint: true })
    const named = lstatSync(base, { bigint: true })
    if (named.isSymbolicLink() || !named.isDirectory()
      || held.dev !== named.dev || held.ino !== named.ino) {
      closeSync(rootFd)
      throw new ArtifactStoreError(
        'ARTIFACT_ROOT_CHANGED',
        'artifact store root changed while its authority descriptor was acquired',
      )
    }
  } catch (cause) {
    if (cause instanceof ArtifactStoreError) throw cause
    throw new ArtifactStoreError(
      'ARTIFACT_ROOT_INVALID',
      `could not acquire the artifact store root: ${
        cause instanceof Error ? cause.message : 'open failed'
      }`,
    )
  }

  const startGuard = (
    operation: 'put' | 'get' | 'list' | 'fetch',
    key: string,
    value?: number | string,
    destinationParentFd?: number,
  ): GuardProcess => {
    const safe = key ? assertSafeKey(key) : ''
    const args = [operation, safe]
    if (value !== undefined) args.push(String(value))
    const stdio: StdioOptions = operation === 'put'
      ? ['pipe', 'pipe', 'pipe', rootFd, 'pipe']
      : operation === 'fetch'
        ? ['pipe', 'pipe', 'pipe', rootFd, destinationParentFd as number]
        : ['pipe', 'pipe', 'pipe', rootFd]
    const child: ChildProcess = spawn(guardPath, args, {
      stdio,
    })
    if (!child.stdin || !child.stdout || !child.stderr) {
      throw new ArtifactStoreError(
        'ARTIFACT_GUARD_UNAVAILABLE',
        'artifact-store guard did not expose its required pipes',
      )
    }
    const input = child.stdin
    const output = child.stdout
    const control = operation === 'put' ? child.stdio[4] : undefined
    if (operation === 'put' && (!control || !('end' in control))) {
      throw new ArtifactStoreError(
        'ARTIFACT_GUARD_UNAVAILABLE',
        'artifact-store guard did not expose its commit pipe',
      )
    }
    const stderr: Buffer[] = []
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.reduce((total, part) => total + part.byteLength, 0) < 64 * 1024) {
        stderr.push(chunk)
      }
    })
    const completion = new Promise<void>((resolveCompletion, rejectCompletion) => {
      child.once('error', (cause) => rejectCompletion(new ArtifactStoreError(
        'ARTIFACT_GUARD_UNAVAILABLE',
        `could not start the artifact-store guard: ${cause.message}`,
      )))
      child.once('close', (code) => {
        if (code === 0) resolveCompletion()
        else rejectCompletion(new ArtifactStoreError(
          'ARTIFACT_OPERATION_FAILED',
          Buffer.concat(stderr).toString('utf8').trim() || `artifact-store guard exited ${code}`,
        ))
      })
    })
    input.on('error', () => undefined)
    if (control && 'on' in control) control.on('error', () => undefined)
    return { child, input, output, control: control as Writable | undefined, completion }
  }

  return {
    description: `filesystem:${base}`,

    async put(key, data) {
      const safe = assertSafeKey(key)
      const guard = startGuard('put', safe, data.byteLength)
      guard.input.end(data)
      guard.control?.end('C')
      await guard.completion
      return { key: assertSafeKey(key), bytes: data.byteLength, sha256: sha256Of(data) }
    },

    async putFile(key, sourcePath) {
      const safe = assertSafeKey(key)
      const source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const before = await source.stat({ bigint: true })
        if (!before.isFile()) {
          throw new ArtifactStoreError(
            'ARTIFACT_SOURCE_INVALID',
            'artifact source is not a regular file',
          )
        }
        if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new ArtifactStoreError(
            'ARTIFACT_SOURCE_INVALID',
            'artifact source exceeds the supported file size',
          )
        }
        const hash = createHash('sha256')
        let bytes = 0
        const guard = startGuard('put', safe, before.size.toString())
        let decisionSent = false
        const hashing = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            hash.update(chunk)
            bytes += chunk.byteLength
            callback(null, chunk)
          },
        })
        const transfer = pipeline(
          before.size === 0n
            ? Readable.from([])
            : createReadStream(sourcePath, {
                fd: source.fd,
                autoClose: false,
                start: 0,
                end: Number(before.size - 1n),
              }),
          hashing,
          guard.input,
        )
        try {
          try {
            await transfer
          } catch (cause) {
            throw new ArtifactStoreError(
              'ARTIFACT_SOURCE_UNREADABLE',
              `could not stream the artifact source: ${
                cause instanceof Error ? cause.message : 'read failed'
              }`,
            )
          }
          let after: Awaited<ReturnType<typeof source.stat>>
          try {
            after = await source.stat({ bigint: true })
          } catch (cause) {
            throw new ArtifactStoreError(
              'ARTIFACT_SOURCE_UNREADABLE',
              `could not revalidate the artifact source: ${
                cause instanceof Error ? cause.message : 'stat failed'
              }`,
            )
          }
          if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
            || before.ctimeNs !== after.ctimeNs || before.mtimeNs !== after.mtimeNs
            || BigInt(bytes) !== before.size) {
            throw new ArtifactStoreError(
              'ARTIFACT_SOURCE_CHANGED',
              'artifact source changed while it was being copied',
            )
          }
          guard.control?.end('C')
          decisionSent = true
          await guard.completion
          return { key: safe, bytes, sha256: hash.digest('hex') }
        } catch (cause) {
          if (!decisionSent) guard.control?.end('A')
          await guard.completion.catch(() => undefined)
          throw cause
        }
      } finally {
        await source.close()
      }
    },

    async get(key) {
      const guard = startGuard('get', assertSafeKey(key))
      guard.input.end()
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const raw of guard.output) {
        const chunk = Buffer.from(raw)
        bytes += chunk.byteLength
        if (bytes > MAX_BUFFERED_OBJECT_BYTES) {
          guard.child.kill()
          await guard.completion.catch(() => undefined)
          throw new ArtifactStoreError(
            'ARTIFACT_OBJECT_TOO_LARGE',
            'buffered artifact objects are limited to 1 MiB; use fetchToFile for files',
          )
        }
        chunks.push(chunk)
      }
      await guard.completion
      return Buffer.concat(chunks)
    },

    async fetchToFile(key, destinationPath) {
      const safe = assertSafeKey(key)
      const parentPath = dirname(destinationPath)
      const parent = await open(
        parentPath,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      )
      let guard: GuardProcess | undefined
      try {
        const [held, named] = await Promise.all([
          parent.stat({ bigint: true }),
          lstat(parentPath, { bigint: true }),
        ])
        if (named.isSymbolicLink() || !named.isDirectory()
          || held.dev !== named.dev || held.ino !== named.ino) {
          throw new ArtifactStoreError(
            'ARTIFACT_DESTINATION_CHANGED',
            'materialized artifact parent changed while its descriptor was acquired',
          )
        }
        guard = startGuard('fetch', safe, basename(destinationPath), parent.fd)
        guard.input.end()
        const hash = createHash('sha256')
        let bytes = 0
        for await (const raw of guard.output) {
          const chunk = Buffer.from(raw)
          hash.update(chunk)
          bytes += chunk.byteLength
        }
        await guard.completion
        return { key: safe, bytes, sha256: hash.digest('hex') }
      } catch (cause) {
        guard?.output.destroy()
        guard?.child.kill()
        await guard?.completion.catch(() => undefined)
        throw cause
      } finally {
        await parent.close()
      }
    },

    async list(prefix) {
      try {
        const safePrefix = prefix ? assertSafeKey(prefix) : ''
        const guard = startGuard('list', safePrefix)
        guard.input.end()
        const chunks: Buffer[] = []
        for await (const raw of guard.output) chunks.push(Buffer.from(raw))
        await guard.completion
        return Buffer.concat(chunks).toString('utf8').split('\n').filter(Boolean)
          .map((entry) => safePrefix ? `${safePrefix}/${entry}` : entry)
          .sort()
      } catch (error) {
        if (error instanceof ArtifactStoreError
          && /No such file or directory/.test(error.message)) return []
        throw error
      }
    },
  }
}

export async function assertDirectory(path: string, label: string): Promise<void> {
  try {
    const details = await lstat(path)
    if (details.isSymbolicLink()) {
      throw new ArtifactStoreError('ARTIFACT_ROOT_INVALID', `${label} must not be a symbolic link`)
    }
    if (!details.isDirectory()) {
      throw new ArtifactStoreError('ARTIFACT_ROOT_INVALID', `${label} is not a directory`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await mkdir(path, { recursive: true })
      const created = await lstat(path)
      if (created.isSymbolicLink() || !created.isDirectory()) {
        throw new ArtifactStoreError('ARTIFACT_ROOT_INVALID', `${label} is not a safe directory`)
      }
      await access(guardPath, constants.X_OK)
      return
    }
    throw error
  }
  await access(guardPath, constants.X_OK)
}
