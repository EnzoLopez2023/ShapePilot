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
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, open, rm, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import type { DatabaseIdentity } from '../db/identity.ts'
import { identityDifferences, readDatabaseIdentity } from '../db/identity.ts'
import type { ArtifactStore } from './artifactStore.ts'
import { sha256File, runSnapshotChecks } from './backup.ts'
import type { BackupManifest } from './manifest.ts'
import {
  BACKUP_DATABASE_FILE, BACKUP_MANIFEST_FILE, RecoveryError, manifestIdentity,
  artifactIdFor, validateBackupManifest,
} from './manifest.ts'

/** Re-derive the identity of a database file on disk. */
function identityOf(path: string): DatabaseIdentity {
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    db.pragma('query_only = ON')
    return readDatabaseIdentity(db)
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
  readBackIdentity: DatabaseIdentity
  /** Identity re-derived from the disposable restore. */
  restoredIdentity: DatabaseIdentity
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

    await copyFile(readBack, restored)
    const restoredIdentity = identityOf(restored)
    for (const difference of identityDifferences(expectedIdentity, restoredIdentity)) {
      differences.push(`disposable restore identity: ${difference}`)
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
  /** Deterministic test seam for a path replacement after exclusive creation. */
  afterDestinationReserved?: () => void | Promise<void>
}

export interface RestoreResult {
  artifactId: string
  destinationPath: string
  bytes: number
  sha256: string
  /** Re-derived from the restored file, before anything may promote it. */
  identity: DatabaseIdentity
  checks: ReturnType<typeof runSnapshotChecks>
}

async function copyIntoHandle(sourcePath: string, destination: FileHandle): Promise<void> {
  const source = await open(sourcePath, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  let position = 0
  try {
    while (true) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) break
      let written = 0
      while (written < bytesRead) {
        const result = await destination.write(
          buffer, written, bytesRead - written, position + written)
        written += result.bytesWritten
      }
      position += bytesRead
    }
    await destination.sync()
  } finally {
    await source.close()
  }
}

async function hashHandle(handle: FileHandle): Promise<string> {
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  let position = 0
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
    if (bytesRead === 0) break
    hash.update(buffer.subarray(0, bytesRead))
    position += bytesRead
  }
  return hash.digest('hex')
}

interface ReservedFileIdentity {
  dev: number
  ino: number
  birthtimeMs: number
}

const fileIdentity = (
  details: { dev: number; ino: number; birthtimeMs: number },
): ReservedFileIdentity => ({
  dev: details.dev,
  ino: details.ino,
  birthtimeMs: details.birthtimeMs,
})

async function pathIsReservedFile(
  path: string, expected: ReservedFileIdentity,
): Promise<boolean> {
  try {
    const actual = fileIdentity(await stat(path))
    return actual.dev === expected.dev
      && actual.ino === expected.ino
      && actual.birthtimeMs === expected.birthtimeMs
  } catch {
    return false
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

  if (existsSync(destination)) {
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
    if (existsSync(sidecar)) {
      throw new RecoveryError(
        'RESTORE_DESTINATION_ACTIVE',
        `${sidecar} exists, so the destination is in use`,
      )
    }
  }

  const manifest = await readManifest(options.store, options.artifactId)
  await mkdir(dirname(destination), { recursive: true })
  const work = await mkdtemp(join(dirname(destination), '.shapepilot-restore-'))
  const materialized = join(work, BACKUP_DATABASE_FILE)
  let reservation: FileHandle | null = null
  let reservedIdentity: ReservedFileIdentity | null = null
  try {
    await options.store.fetchToFile(
      `${options.artifactId}/${BACKUP_DATABASE_FILE}`, materialized)
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
    let identity: DatabaseIdentity
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

    try {
      reservation = await open(destination, 'wx+')
      reservedIdentity = fileIdentity(await reservation.stat())
      await options.afterDestinationReserved?.()
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new RecoveryError(
          'RESTORE_DESTINATION_EXISTS',
          `${destination} was created while the restore was being verified; nothing was overwritten`,
          { cause },
        )
      }
      throw cause
    }
    const racedSidecar = destinationSidecars.find((sidecar) => existsSync(sidecar))
    if (racedSidecar) {
      throw new RecoveryError(
        'RESTORE_DESTINATION_ACTIVE',
        `${racedSidecar} appeared while the restore was being verified`,
      )
    }

    await copyIntoHandle(materialized, reservation)
    const finalDetails = await reservation.stat()
    const finalSha256 = await hashHandle(reservation)
    if (finalDetails.size !== details.size || finalSha256 !== sha256) {
      throw new RecoveryError(
        'RESTORE_VERIFICATION_FAILED',
        'the exclusively created destination does not match the verified artifact',
      )
    }
    const lateSidecar = destinationSidecars.find((sidecar) => existsSync(sidecar))
    if (lateSidecar) {
      throw new RecoveryError(
        'RESTORE_DESTINATION_ACTIVE',
        `${lateSidecar} appeared while the destination was being written`,
      )
    }
    if (!await pathIsReservedFile(destination, reservedIdentity)) {
      throw new RecoveryError(
        'RESTORE_DESTINATION_RACED',
        'the destination path stopped referring to the exclusively created restore file',
      )
    }
    return {
      artifactId: options.artifactId,
      destinationPath: destination,
      bytes: finalDetails.size,
      sha256: finalSha256,
      identity,
      checks,
    }
  } catch (error) {
    if (reservation && reservedIdentity) {
      await reservation.truncate(0)
      if (await pathIsReservedFile(destination, reservedIdentity)) {
        await rm(destination, { force: true })
      }
    }
    throw error
  } finally {
    await reservation?.close()
    await rm(work, { recursive: true, force: true })
  }
}
