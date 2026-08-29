// Verify and restore.
//
// `verify` reads a stored backup back out of the artifact store, proves the
// bytes and hash still match the manifest, re-derives the app/schema identity
// from the read-back bytes, restores those bytes into a *disposable*
// destination, re-derives the identity there too, re-runs the database checks
// and reconciles table counts.
//
// Identity is re-derived at every stage from the file in front of it, and
// compared against the manifest — never against the running build's ledger, and
// never accepted just because the head migration id matches.
//
// `restore` is forward-only: it refuses to write over an active destination and
// always materializes a new file, which is then verified before an operator
// promotes it. Neither runs at startup or inside an HTTP request.
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, open, rm, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { basename, dirname, join, parse, resolve, sep } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import Database from 'better-sqlite3'
import type { DatabaseIdentity } from '../db/identity.ts'
import {
  identityDifferences, readAuthorityId, readDatabaseIdentity,
} from '../db/identity.ts'
import type { ArtifactStore } from './artifactStore.ts'
import { sha256File, runSnapshotChecks } from './backup.ts'
import type { BackupManifest } from './manifest.ts'
import {
  BACKUP_DATABASE_FILE, BACKUP_MANIFEST_FILE, RecoveryError, manifestIdentity,
  artifactIdFor, validateBackupManifest,
} from './manifest.ts'

interface AuthorityIdentity extends DatabaseIdentity {
  authorityId: string
}

/** Re-derive the identity of a database file on disk. */
function identityOf(path: string): AuthorityIdentity {
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    db.pragma('query_only = ON')
    return { ...readDatabaseIdentity(db), authorityId: readAuthorityId(db) }
  } finally {
    db.close()
  }
}

export interface VerifyOptions {
  store: ArtifactStore
  artifactId: string
  /** Disposable scratch root; defaults beside the store's own working area. */
  workRoot?: string
}

export interface VerifyReport {
  artifactId: string
  ok: boolean
  bytes: number
  sha256: string
  manifestSha256: string
  /** Identity re-derived from the bytes fetched back out of the store. */
  readBackIdentity: AuthorityIdentity
  /** Identity re-derived from the disposable restore. */
  restoredIdentity: AuthorityIdentity
  tables: { name: string; manifestRowCount: number; restoredRowCount: number; ok: boolean }[]
  checks: ReturnType<typeof runSnapshotChecks>
  differences: string[]
}

export async function readManifest(
  store: ArtifactStore, artifactId: string,
): Promise<BackupManifest> {
  const raw = await store.get(`${artifactId}/${BACKUP_MANIFEST_FILE}`)
  const manifest = validateBackupManifest(JSON.parse(Buffer.from(raw).toString('utf8')))
  if (artifactIdFor(manifest.sourceCreatedUtc, manifest) !== artifactId) {
    throw new RecoveryError(
      'ARTIFACT_ID_MISMATCH',
      'the requested artifact id is not the content address of its manifest',
    )
  }
  return manifest
}

/**
 * Full read-back: bytes, hash, disposable restore, offline integrity checks and
 * a per-table count reconciliation against the manifest.
 */
export async function verifyBackup(options: VerifyOptions): Promise<VerifyReport> {
  const manifest = await readManifest(options.store, options.artifactId)
  const workRoot = options.workRoot ?? resolve('artifacts', '.verify-work')
  await mkdir(workRoot, { recursive: true })
  const work = await mkdtemp(join(workRoot, 'verify-'))
  // Two distinct stages on purpose: the bytes read back out of the external
  // store, and a disposable restore made from those bytes.
  const readBackDir = join(work, 'read-back')
  const restoreDir = join(work, 'restore')
  await mkdir(readBackDir, { recursive: true })
  await mkdir(restoreDir, { recursive: true })
  const readBack = join(readBackDir, BACKUP_DATABASE_FILE)
  const restored = join(restoreDir, BACKUP_DATABASE_FILE)
  const differences: string[] = []
  const expectedIdentity = manifestIdentity(manifest)

  try {
    const fetched = await options.store.fetchToFile(
      `${options.artifactId}/${BACKUP_DATABASE_FILE}`, readBack)
    const details = await stat(readBack)
    const sha256 = await sha256File(readBack)

    if (details.size !== manifest.database.bytes) {
      differences.push(
        `restored size ${details.size} does not match manifest ${manifest.database.bytes}`)
    }
    if (sha256 !== manifest.database.sha256) {
      differences.push('restored SHA-256 does not match the manifest')
    }
    if (fetched.sha256 !== sha256) {
      differences.push('the artifact store returned different bytes than were written to disk')
    }

    const readBackIdentity = identityOf(readBack)
    for (const difference of identityDifferences(expectedIdentity, readBackIdentity)) {
      differences.push(`read-back identity: ${difference}`)
    }
    if (readBackIdentity.authorityId !== manifest.database.authorityId) {
      differences.push('read-back identity: authority id does not match the manifest')
    }

    await copyFile(readBack, restored)
    const restoredIdentity = identityOf(restored)
    for (const difference of identityDifferences(expectedIdentity, restoredIdentity)) {
      differences.push(`disposable restore identity: ${difference}`)
    }
    if (restoredIdentity.authorityId !== manifest.database.authorityId) {
      differences.push('disposable restore identity: authority id does not match the manifest')
    }

    const db = new Database(restored, { fileMustExist: true, readonly: true })
    let checks: ReturnType<typeof runSnapshotChecks>
    const tables: VerifyReport['tables'] = []
    try {
      checks = runSnapshotChecks(db)
      for (const table of manifest.database.tables) {
        const row = db.prepare(`SELECT COUNT(*) AS count FROM "${table.name.replaceAll('"', '""')}"`)
          .get() as { count: number }
        const restoredRowCount = Number(row.count)
        const ok = restoredRowCount === table.rowCount
        if (!ok) {
          differences.push(
            `${table.name}: manifest ${table.rowCount} rows, restored ${restoredRowCount}`)
        }
        tables.push({
          name: table.name,
          manifestRowCount: table.rowCount,
          restoredRowCount,
          ok,
        })
      }
    } finally {
      db.close()
    }

    return {
      artifactId: options.artifactId,
      ok: differences.length === 0,
      bytes: details.size,
      sha256,
      manifestSha256: manifest.database.sha256,
      readBackIdentity,
      restoredIdentity,
      tables,
      checks,
      differences,
    }
  } finally {
    // The restore destination is disposable by construction.
    await rm(work, { recursive: true, force: true })
  }
}

export interface RestoreOptions {
  store: ArtifactStore
  artifactId: string
  /** New path. Must not exist and must not be the running authority. */
  destinationPath: string
  /** Path of the database this process would serve, so it can be refused. */
  activePath?: string
  /** Injectable only so cleanup of each failed offline check is regression-tested. */
  snapshotChecks?: typeof runSnapshotChecks
  /** Deterministic test seam for cleanup before the work descriptor is acquired. */
  afterWorkCreated?: () => void | Promise<void>
  /** Deterministic test seam for a path replacement after exclusive creation. */
  afterDestinationReserved?: () => void | Promise<void>
}

export interface RestoreResult {
  artifactId: string
  destinationPath: string
  bytes: number
  sha256: string
  /** Re-derived from the restored file, before anything may promote it. */
  identity: AuthorityIdentity
  checks: ReturnType<typeof runSnapshotChecks>
}

interface ReservedFileIdentity {
  dev: bigint
  ino: bigint
}

interface RestoreWorkIdentity {
  directory: ReservedFileIdentity
  source: ReservedFileIdentity | null
}

const fileIdentity = (
  details: { dev: bigint; ino: bigint },
): ReservedFileIdentity => ({
  dev: details.dev,
  ino: details.ino,
})

async function pathIsReservedFile(
  path: string, expected: ReservedFileIdentity,
): Promise<boolean> {
  try {
    const details = await lstat(path, { bigint: true })
    const actual = fileIdentity(details)
    return details.isFile()
      && actual.dev === expected.dev
      && actual.ino === expected.ino
  } catch {
    return false
  }
}

async function pathEntryExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw cause
  }
}

const restoreGuardPath = resolve(
  import.meta.dirname,
  '../../native/build/artifact-store-guard',
)

async function pathHasOnlyRealDirectories(path: string): Promise<boolean> {
  const absolute = resolve(path)
  const root = parse(absolute).root
  let current = root
  for (const segment of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, segment)
    try {
      const details = await lstat(current)
      if (details.isSymbolicLink() || !details.isDirectory()) return false
    } catch {
      return false
    }
  }
  return true
}

async function parentPathMatches(
  parent: FileHandle,
  parentPath: string,
): Promise<boolean> {
  if (!await pathHasOnlyRealDirectories(parentPath)) return false
  try {
    const held = await parent.stat({ bigint: true })
    const named = await lstat(parentPath, { bigint: true })
    return named.isDirectory()
      && !named.isSymbolicLink()
      && held.dev === named.dev
      && held.ino === named.ino
  } catch {
    return false
  }
}

async function publishRestoreDestination(options: {
  parent: FileHandle
  leaf: string
  sourcePath: string
  expectedBytes: number
  afterReserved?: (identity: ReservedFileIdentity) => void | Promise<void>
}): Promise<{ identity: ReservedFileIdentity; bytes: number; sha256: string }> {
  const source = await open(options.sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const child = spawn(
      restoreGuardPath,
      ['restore', options.leaf, String(options.expectedBytes)],
      {
        stdio: ['ignore', 'pipe', 'pipe', options.parent.fd, source.fd, 'pipe', 'pipe'],
      },
    )
    if (!child.stdout || !child.stderr) {
      throw new RecoveryError(
        'RESTORE_GUARD_UNAVAILABLE',
        'the restore guard did not expose its verification streams',
      )
    }
    const streams = child.stdio as unknown as (Readable | Writable | null)[]
    const control = streams[5] as Writable | null
    const readiness = streams[6] as Readable | null
    if (!control || !readiness) {
      throw new RecoveryError(
        'RESTORE_GUARD_UNAVAILABLE',
        'the restore guard did not expose its control streams',
      )
    }
    control.on('error', () => undefined)
    const output = child.stdout
    output.on('error', () => undefined)
    readiness.on('error', () => undefined)
    const stderr: Buffer[] = []
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    const completion = new Promise<void>((resolveCompletion, rejectCompletion) => {
      child.once('error', (cause) => rejectCompletion(new RecoveryError(
        'RESTORE_GUARD_UNAVAILABLE',
        `could not start the restore guard: ${cause.message}`,
      )))
      child.once('close', (code) => {
        const detail = Buffer.concat(stderr).toString('utf8').trim()
        if (code === 0) {
          resolveCompletion()
        } else if (code === 3) {
          rejectCompletion(new RecoveryError(
            'RESTORE_DESTINATION_EXISTS',
            'the restore destination was created concurrently',
          ))
        } else if (code === 4) {
          rejectCompletion(new RecoveryError(
            'RESTORE_DESTINATION_ACTIVE',
            'a SQLite sidecar appeared at the restore destination',
          ))
        } else {
          rejectCompletion(new RecoveryError(
            'RESTORE_DESTINATION_RACED',
            detail || `restore guard exited ${String(code)}`,
          ))
        }
      })
    })
    void completion.catch(() => undefined)
    const ready = new Promise<ReservedFileIdentity>((resolveReady, rejectReady) => {
      const chunks: Buffer[] = []
      readiness.on('data', (chunk: Buffer) => chunks.push(chunk))
      readiness.once('end', () => {
        const match = /^(\d+) (\d+)\n$/.exec(Buffer.concat(chunks).toString('ascii'))
        if (!match) {
          rejectReady(new RecoveryError(
            'RESTORE_GUARD_UNAVAILABLE',
            'the restore guard closed before reporting its reserved file',
          ))
          return
        }
        resolveReady({ dev: BigInt(match[1]), ino: BigInt(match[2]) })
      })
    })
    let identity: ReservedFileIdentity
    try {
      identity = await ready
    } catch {
      await completion
      throw new RecoveryError(
        'RESTORE_GUARD_UNAVAILABLE',
        'the restore guard did not reserve a destination',
      )
    }

    const hash = createHash('sha256')
    let bytes = 0
    const receive = (async () => {
      for await (const raw of output) {
        const chunk = Buffer.from(raw)
        bytes += chunk.byteLength
        hash.update(chunk)
      }
    })()
    void receive.catch(() => undefined)
    try {
      await options.afterReserved?.(identity)
      control.end('C')
      await Promise.all([receive, completion])
    } catch (cause) {
      if (!control.destroyed) control.end('A')
      await Promise.allSettled([receive, completion])
      throw cause
    }
    return { identity, bytes, sha256: hash.digest('hex') }
  } finally {
    await source.close()
  }
}

async function removeOwnedRestore(
  parent: FileHandle,
  leaf: string,
  identity: ReservedFileIdentity,
): Promise<void> {
  const child = spawn(
    restoreGuardPath,
    ['remove-restore', leaf, identity.dev.toString(), identity.ino.toString()],
    { stdio: ['ignore', 'ignore', 'pipe', parent.fd] },
  )
  const stderr: Buffer[] = []
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))
  await new Promise<void>((resolveCleanup, rejectCleanup) => {
    child.once('error', rejectCleanup)
    child.once('close', (code) => {
      if (code === 0) resolveCleanup()
      else rejectCleanup(new RecoveryError(
        'RESTORE_CLEANUP_FAILED',
        Buffer.concat(stderr).toString('utf8').trim() || 'restore cleanup guard failed',
      ))
    })
  })
}

async function removeOwnedRestoreWork(
  parent: FileHandle,
  workParent: FileHandle | null,
  workPath: string,
  sourcePath: string,
  identity: RestoreWorkIdentity,
): Promise<void> {
  const child = spawn(
    restoreGuardPath,
    [
      'remove-restore-work',
      basename(workPath),
      identity.directory.dev.toString(),
      identity.directory.ino.toString(),
      basename(sourcePath),
      (identity.source?.dev ?? 0n).toString(),
      (identity.source?.ino ?? 0n).toString(),
      workParent ? 'inherited' : 'open-by-name',
    ],
    {
      stdio: workParent
        ? ['ignore', 'ignore', 'pipe', parent.fd, workParent.fd]
        : ['ignore', 'ignore', 'pipe', parent.fd],
    },
  )
  const stderr: Buffer[] = []
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))
  await new Promise<void>((resolveCleanup, rejectCleanup) => {
    child.once('error', rejectCleanup)
    child.once('close', (code) => {
      if (code === 0) resolveCleanup()
      else rejectCleanup(new RecoveryError(
        'RESTORE_CLEANUP_FAILED',
        Buffer.concat(stderr).toString('utf8').trim() || 'restore work cleanup guard failed',
      ))
    })
  })
}

async function createRestoreWork(
  parent: FileHandle,
): Promise<{ name: string; identity: ReservedFileIdentity }> {
  const child = spawn(
    restoreGuardPath,
    ['create-restore-work', '_'],
    { stdio: ['ignore', 'pipe', 'pipe', parent.fd] },
  )
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk))
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))
  await new Promise<void>((resolveCreation, rejectCreation) => {
    child.once('error', rejectCreation)
    child.once('close', (code) => {
      if (code === 0) resolveCreation()
      else rejectCreation(new RecoveryError(
        'RESTORE_WORK_CREATE_FAILED',
        Buffer.concat(stderr).toString('utf8').trim() || 'restore work guard failed',
      ))
    })
  })
  const match = /^(\.shapepilot-restore-[A-Za-z0-9-]+) (\d+) (\d+)\n$/
    .exec(Buffer.concat(stdout).toString('ascii'))
  if (!match) {
    throw new RecoveryError(
      'RESTORE_WORK_CREATE_FAILED',
      'restore work guard returned an invalid directory identity',
    )
  }
  return {
    name: match[1],
    identity: { dev: BigInt(match[2]), ino: BigInt(match[3]) },
  }
}

/** Forward-only restore into a new file, verified before an operator promotes it. */
export async function restoreBackup(options: RestoreOptions): Promise<RestoreResult> {
  const destination = resolve(options.destinationPath)
  const destinationSidecars = [
    `${destination}-journal`,
    `${destination}-wal`,
    `${destination}-shm`,
  ]

  if (await pathEntryExists(destination)) {
    throw new RecoveryError(
      'RESTORE_DESTINATION_EXISTS',
      `${destination} already exists; restore is forward-only and never overwrites`,
    )
  }
  if (options.activePath && resolve(options.activePath) === destination) {
    throw new RecoveryError(
      'RESTORE_DESTINATION_ACTIVE',
      'refusing to restore over the active database authority',
    )
  }
  for (const sidecar of destinationSidecars) {
    if (await pathEntryExists(sidecar)) {
      throw new RecoveryError(
        'RESTORE_DESTINATION_ACTIVE',
        `${sidecar} exists, so the destination is in use`,
      )
    }
  }

  const manifest = await readManifest(options.store, options.artifactId)
  const parentPath = dirname(destination)
  await mkdir(parentPath, { recursive: true })
  let destinationParent: FileHandle | null = null
  let reservedIdentity: ReservedFileIdentity | null = null
  let workIdentity: RestoreWorkIdentity | null = null
  let workParent: FileHandle | null = null
  let work = ''
  let materialized = ''
  try {
    destinationParent = await open(
      parentPath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    if (!await parentPathMatches(destinationParent, parentPath)) {
      throw new RecoveryError(
        'RESTORE_DESTINATION_RACED',
        'the restore destination parent changed while its authority descriptor was acquired',
      )
    }
    const createdWork = await createRestoreWork(destinationParent)
    work = join(parentPath, createdWork.name)
    materialized = join(work, BACKUP_DATABASE_FILE)
    workIdentity = { directory: createdWork.identity, source: null }
    await options.afterWorkCreated?.()
    workParent = await open(
      work,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    const heldWork = await workParent.stat({ bigint: true })
    if (heldWork.dev !== createdWork.identity.dev || heldWork.ino !== createdWork.identity.ino
        || !await parentPathMatches(destinationParent, parentPath)) {
      throw new RecoveryError(
        'RESTORE_DESTINATION_RACED',
        'the restore work directory stopped referring to the descriptor-created directory',
      )
    }
    await options.store.fetchToFileAt(
      `${options.artifactId}/${BACKUP_DATABASE_FILE}`,
      { parent: workParent, leaf: BACKUP_DATABASE_FILE },
    )
    const details = await stat(materialized)
    const sha256 = await sha256File(materialized)
    if (details.size !== manifest.database.bytes || sha256 !== manifest.database.sha256) {
      throw new RecoveryError(
        'RESTORE_VERIFICATION_FAILED',
        'the materialized artifact does not match the manifest',
      )
    }

    // Identity is proved before an operator can promote anything. A file with
    // the same head migration but a different history is refused here.
    let identity: AuthorityIdentity
    try {
      identity = identityOf(materialized)
    } catch (cause) {
      throw new RecoveryError(
        'RESTORE_IDENTITY_UNREADABLE',
        'the materialized artifact carries no readable ShapePilot identity',
        { cause },
      )
    }
    const identityProblems = identityDifferences(manifestIdentity(manifest), identity)
    if (identity.authorityId !== manifest.database.authorityId) {
      identityProblems.push('authority id does not match the manifest')
    }
    if (identityProblems.length > 0) {
      throw new RecoveryError(
        'RESTORE_IDENTITY_MISMATCH',
        `the materialized artifact does not carry the manifest identity `
        + `(${identityProblems.join('; ')})`,
      )
    }

    const db = new Database(materialized, { fileMustExist: true, readonly: true })
    let checks: ReturnType<typeof runSnapshotChecks>
    try {
      checks = (options.snapshotChecks ?? runSnapshotChecks)(db)
    } finally {
      db.close()
    }

    if (!await parentPathMatches(destinationParent, parentPath)) {
      throw new RecoveryError(
        'RESTORE_DESTINATION_RACED',
        'the restore destination parent changed while its authority descriptor was acquired',
      )
    }
    const workDetails = await lstat(work, { bigint: true })
    const sourceDetails = await lstat(materialized, { bigint: true })
    if (!workDetails.isDirectory() || workDetails.isSymbolicLink()
        || !sourceDetails.isFile() || sourceDetails.isSymbolicLink()) {
      throw new RecoveryError(
        'RESTORE_DESTINATION_RACED',
        'the restore work files changed before descriptor-relative publication',
      )
    }
    workIdentity = {
      directory: fileIdentity(workDetails),
      source: fileIdentity(sourceDetails),
    }
    const published = await publishRestoreDestination({
      parent: destinationParent,
      leaf: basename(destination),
      sourcePath: materialized,
      expectedBytes: details.size,
      afterReserved: async (reserved) => {
        reservedIdentity = reserved
        await options.afterDestinationReserved?.()
        if (!await parentPathMatches(destinationParent as FileHandle, parentPath)) {
          throw new RecoveryError(
            'RESTORE_DESTINATION_RACED',
            'the restore destination parent stopped referring to the pinned directory',
          )
        }
        for (const sidecar of destinationSidecars) {
          if (await pathEntryExists(sidecar)) {
            throw new RecoveryError(
              'RESTORE_DESTINATION_ACTIVE',
              `${sidecar} appeared while the restore was being verified`,
            )
          }
        }
      },
    })
    reservedIdentity = published.identity
    if (published.bytes !== details.size || published.sha256 !== sha256) {
      throw new RecoveryError(
        'RESTORE_VERIFICATION_FAILED',
        'the exclusively created destination does not match the verified artifact',
      )
    }
    let lateSidecar: string | undefined
    for (const sidecar of destinationSidecars) {
      if (await pathEntryExists(sidecar)) {
        lateSidecar = sidecar
        break
      }
    }
    if (lateSidecar) {
      throw new RecoveryError(
        'RESTORE_DESTINATION_ACTIVE',
        `${lateSidecar} appeared while the destination was being written`,
      )
    }
    if (!await parentPathMatches(destinationParent, parentPath)
        || !await pathIsReservedFile(destination, reservedIdentity)) {
      throw new RecoveryError(
        'RESTORE_DESTINATION_RACED',
        'the destination path stopped referring to the exclusively created restore file',
      )
    }
    return {
      artifactId: options.artifactId,
      destinationPath: destination,
      bytes: published.bytes,
      sha256: published.sha256,
      identity,
      checks,
    }
  } catch (error) {
    if (destinationParent && reservedIdentity) {
      await removeOwnedRestore(destinationParent, basename(destination), reservedIdentity)
    }
    throw error
  } finally {
    let descriptorCleanupAttempted = false
    try {
      if (destinationParent && workIdentity && work && materialized) {
        descriptorCleanupAttempted = true
        await removeOwnedRestoreWork(
          destinationParent,
          workParent,
          work,
          materialized,
          workIdentity,
        )
      }
    } finally {
      await workParent?.close()
      await destinationParent?.close()
      if (!descriptorCleanupAttempted && work) {
        await rm(work, { recursive: true, force: true })
      }
    }
  }
}
