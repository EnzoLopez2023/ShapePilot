// The single better-sqlite3 handle.
//
// One process, one worker, one instance, one connection. Nothing outside
// lib/db opens a database: routes and features go through the async repository
// contracts so the synchronous driver stays an implementation detail.
//
// Invariants applied on every connection:
//   journal_mode = DELETE   WAL needs shared memory Azure Files (SMB) cannot
//                           provide; enabling it there corrupts the file.
//   foreign_keys = ON       the pocket cascade is load-bearing.
//   busy_timeout = bounded  a stuck writer must fail, not hang a request.
//
// Deliberately absent: integrity scans, repair, backup, or any unbounded work.
// Those live in the explicit recovery and import commands only.
import {
  closeSync, fstatSync, mkdirSync, openSync, statSync,
} from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type DatabaseConstructor from 'better-sqlite3'
import { MIGRATIONS, codeIdentity, codeLedger, migrate } from './migrate.ts'
import type { DatabaseIdentity } from './identity.ts'
import {
  APP_MARKER, SCHEMA_MARKER_FORMAT, IdentityError, assertIdentityMatches,
  readAuthorityId, readDatabaseIdentity, readIdentityMarker, readMigrationLedger,
  schemaObjectsHash,
} from './identity.ts'
import { verifyNativeFileIdentity } from './nativeIdentity.ts'

export type SqliteDatabase = DatabaseConstructor.Database

export interface ConnectionOptions {
  /** Absolute or repo-relative path to the app-owned database file. */
  path: string
  busyTimeoutMs: number
  /**
   * Production refuses to create an empty database: an absent file means the
   * persistent volume did not mount, and silently starting on a blank authority
   * is worse than not starting.
   */
  createIfMissing: boolean
  /** Deterministic test seam for a path changing after its first read-only proof. */
  beforeWritableOpen?: () => void
  /** Deterministic test seam immediately before SQLite resolves the pathname. */
  beforeSqliteWritableOpen?: () => void
  /** Deterministic test seam for an ABA rename after SQLite resolves the path. */
  afterWritableOpenBeforeIdentity?: () => void
}

export interface AppDatabase {
  readonly handle: SqliteDatabase
  readonly path: string
  /** Read back out of the database after migrating, never assumed from code. */
  readonly schemaIdentity: string
  readonly identity: DatabaseIdentity
  close(): void
}

export class DatabaseOpenError extends Error {
  readonly code: string
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DatabaseOpenError'
    this.code = code
  }
}

interface FileFingerprint {
  dev: bigint
  ino: bigint
  size: bigint
  mtimeNs: bigint
  ctimeNs: bigint
}

interface DatabasePreflight {
  fingerprint: FileFingerprint
  schemaIdentity: string
  identity: DatabaseIdentity | null
}

type PreflightRequirement = 'approved-prefix' | 'current'

const fingerprintFromPath = (path: string): FileFingerprint => {
  const stats = statSync(path, { bigint: true })
  if (!stats.isFile()) {
    throw new DatabaseOpenError('DATABASE_UNAVAILABLE', `${path} is not a regular file`)
  }
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeNs: stats.mtimeNs,
    ctimeNs: stats.ctimeNs,
  }
}

const fingerprintFromDescriptor = (descriptor: number, path: string): FileFingerprint => {
  const stats = fstatSync(descriptor, { bigint: true })
  if (!stats.isFile()) {
    throw new DatabaseOpenError('DATABASE_UNAVAILABLE', `${path} is not a regular file`)
  }
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeNs: stats.mtimeNs,
    ctimeNs: stats.ctimeNs,
  }
}

const fingerprintsEqual = (left: FileFingerprint, right: FileFingerprint): boolean =>
  left.dev === right.dev
  && left.ino === right.ino
  && left.size === right.size
  && left.mtimeNs === right.mtimeNs
  && left.ctimeNs === right.ctimeNs

function assertUnchangedFingerprint(
  expected: FileFingerprint,
  actual: FileFingerprint,
  path: string,
): void {
  if (!fingerprintsEqual(expected, actual)) {
    throw new DatabaseOpenError(
      'DATABASE_CHANGED_DURING_OPEN',
      `${path} changed while its ShapePilot identity was being proved`,
    )
  }
}

function assertApprovedExistingSchema(
    handle: SqliteDatabase, path: string, allowEmpty: boolean,
  ): string {
    const objectCount = Number((handle.prepare<[], { count: number }>(
      "SELECT COUNT(*) AS count FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
    ).get()?.count) ?? 0)
    if (objectCount === 0) {
      if (allowEmpty) return 'empty'
      throw new DatabaseOpenError(
        'EMPTY_DATABASE_REQUIRES_CREATE',
        `${path} is empty; explicit create mode is required to initialize it`,
      )
    }

    const ledger = readMigrationLedger(handle)
    const expectedLedger = codeLedger()
    const ledgerColumns = new Set(
      (handle.prepare('PRAGMA table_info(schema_migrations)').all() as { name: string }[])
        .map((column) => column.name))
    const differences: string[] = []
    if (ledger.length === 0 || ledger.length > expectedLedger.length) {
      differences.push(`migration ledger length ${ledger.length} is not an approved prefix`)
    }
    const depth = Math.min(ledger.length, expectedLedger.length)
    for (let index = 0; index < depth; index += 1) {
      const actual = ledger[index]
      const expected = expectedLedger[index]
      if (actual.ordinal !== expected.ordinal
        || actual.id !== expected.id
        || actual.checksum !== expected.checksum) {
        differences.push(`migration ledger entry ${index} is not the approved migration`)
      }
      if (ledgerColumns.has('name')
        && actual.name !== expected.name
        && actual.name !== '') {
        differences.push(`migration ledger entry ${index} has an unapproved name`)
      }
    }

    if (ledger.length > 0 && ledger.length <= MIGRATIONS.length) {
      const expected = codeIdentity(MIGRATIONS.slice(0, ledger.length))
      if (schemaObjectsHash(handle) !== expected.schemaObjectsSha256) {
        differences.push('sqlite_schema is not the approved migration-prefix schema')
      }
      if (ledger.some((entry) => entry.id === '002-app-identity')) {
        if (readIdentityMarker(handle, 'app') !== APP_MARKER) {
          differences.push('app identity marker is not ShapePilot')
        }
        if (readIdentityMarker(handle, 'schema_format') !== SCHEMA_MARKER_FORMAT) {
          differences.push('schema format marker is not approved')
        }
        try {
          readAuthorityId(handle)
        } catch {
          differences.push('authority identifier is missing or malformed')
        }
      }
    }

    if (differences.length > 0) {
      throw new IdentityError(
        'SCHEMA_IDENTITY_MISMATCH',
        `${path} is not an approved ShapePilot migration prefix: ${differences.join('; ')}`,
      )
    }
    const expected = codeIdentity(MIGRATIONS.slice(0, ledger.length))
    const authorityId = ledger.some((entry) => entry.id === '002-app-identity')
      ? `:${readAuthorityId(handle)}`
      : ''
    return `${expected.schemaMarker}:${expected.schemaObjectsSha256}${authorityId}`
  }

function preflightExistingDatabase(
  path: string,
  requirement: PreflightRequirement,
  allowEmpty: boolean,
): DatabasePreflight {
    let descriptor: number
    try {
      descriptor = openSync(path, 'r')
    } catch (cause) {
      throw new DatabaseOpenError(
        'DATABASE_UNAVAILABLE',
        `could not inspect the existing database at ${path}`,
        { cause },
      )
    }

    let handle: SqliteDatabase | null = null
    try {
      const fingerprint = fingerprintFromDescriptor(descriptor, path)
      handle = new Database(path, { readonly: true, fileMustExist: true })
      handle.pragma('query_only = ON')
      if (handle.pragma('query_only', { simple: true }) !== 1) {
        throw new DatabaseOpenError(
          'QUERY_ONLY_REJECTED',
          `query_only could not be enabled while inspecting ${path}`,
        )
      }

      let identity: DatabaseIdentity | null = null
      let schemaIdentity: string
      if (requirement === 'current') {
        identity = readDatabaseIdentity(handle)
        assertIdentityMatches(codeIdentity(), identity, `${path} is not a compatible write target`)
        schemaIdentity = `${identity.schemaMarker}:${identity.schemaObjectsSha256}`
          + `:${readAuthorityId(handle)}`
      } else {
        schemaIdentity = assertApprovedExistingSchema(handle, path, allowEmpty)
      }

      assertUnchangedFingerprint(fingerprint, fingerprintFromDescriptor(descriptor, path), path)
      assertUnchangedFingerprint(fingerprint, fingerprintFromPath(path), path)
      return { fingerprint, schemaIdentity, identity }
    } finally {
      handle?.close()
      closeSync(descriptor)
    }
}

interface WritableCandidate extends DatabasePreflight {
  reservationDescriptor: number | null
  created: boolean
}

function reserveOrPreflightWritableCandidate(
  path: string,
  createIfMissing: boolean,
  requirement: PreflightRequirement,
  allowEmpty: boolean,
): WritableCandidate {
  if (createIfMissing) mkdirSync(dirname(path), { recursive: true })

  if (createIfMissing) {
    try {
      const reservationDescriptor = openSync(path, 'wx+', 0o600)
      const fingerprint = fingerprintFromDescriptor(reservationDescriptor, path)
      assertUnchangedFingerprint(fingerprint, fingerprintFromPath(path), path)
      return {
        fingerprint,
        schemaIdentity: 'empty',
        identity: null,
        reservationDescriptor,
        created: true,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }

  return {
    ...preflightExistingDatabase(path, requirement, allowEmpty),
    reservationDescriptor: null,
    created: false,
  }
}

function cleanupCandidateReservation(candidate: WritableCandidate): void {
  if (candidate.reservationDescriptor !== null) {
    closeSync(candidate.reservationDescriptor)
    candidate.reservationDescriptor = null
  }
}

function closeCandidateReservation(candidate: WritableCandidate): void {
  if (candidate.reservationDescriptor !== null) {
    closeSync(candidate.reservationDescriptor)
    candidate.reservationDescriptor = null
  }
}

function openPreflightedWritableHandle(
  options: ConnectionOptions,
  requirement: PreflightRequirement,
  allowEmpty: boolean,
): { handle: SqliteDatabase; identity: DatabaseIdentity | null } {
  const candidate = reserveOrPreflightWritableCandidate(
    options.path,
    options.createIfMissing,
    requirement,
    allowEmpty,
  )

  let handle: SqliteDatabase | null = null
  try {
    options.beforeWritableOpen?.()

    const revalidated = preflightExistingDatabase(options.path, requirement, allowEmpty)
    assertUnchangedFingerprint(candidate.fingerprint, revalidated.fingerprint, options.path)
    if (candidate.schemaIdentity !== revalidated.schemaIdentity) {
      throw new DatabaseOpenError(
        'DATABASE_CHANGED_DURING_OPEN',
        `${options.path} changed ShapePilot schema identity before writable use`,
      )
    }

    // This is the final pathname operation before SQLite receives the path.
    assertUnchangedFingerprint(candidate.fingerprint, fingerprintFromPath(options.path), options.path)
    options.beforeSqliteWritableOpen?.()
    handle = new Database(options.path, { fileMustExist: true })
    options.afterWritableOpenBeforeIdentity?.()
    try {
      verifyNativeFileIdentity(handle, candidate.fingerprint)
    } catch (cause) {
      throw new DatabaseOpenError(
        'DATABASE_CHANGED_DURING_OPEN',
        `${options.path} did not open the preflighted database file`,
        { cause },
      )
    }
    assertUnchangedFingerprint(candidate.fingerprint, fingerprintFromPath(options.path), options.path)

    // The native proof above inspects SQLite's actual descriptor without reading
    // a database page, so even a raced hot journal cannot recover before refusal.
    handle.pragma('query_only = ON')
    let identity: DatabaseIdentity | null = null
    let handleSchemaIdentity: string
    if (requirement === 'current') {
      identity = readDatabaseIdentity(handle)
      assertIdentityMatches(
        codeIdentity(),
        identity,
        `${options.path} is not a compatible write target`,
      )
      handleSchemaIdentity = `${identity.schemaMarker}:${identity.schemaObjectsSha256}`
        + `:${readAuthorityId(handle)}`
    } else {
      handleSchemaIdentity = assertApprovedExistingSchema(handle, options.path, allowEmpty)
    }
    if (handleSchemaIdentity !== candidate.schemaIdentity) {
      throw new DatabaseOpenError(
        'DATABASE_CHANGED_DURING_OPEN',
        `${options.path} no longer refers to the preflighted ShapePilot authority`,
      )
    }
    assertUnchangedFingerprint(candidate.fingerprint, fingerprintFromPath(options.path), options.path)
    handle.pragma('query_only = OFF')
    closeCandidateReservation(candidate)
    return { handle, identity }
  } catch (error) {
    handle?.close()
    cleanupCandidateReservation(candidate)
    throw error
  }
}

/** Apply the connection invariants. Exported so tests can assert them directly. */
export function applyConnectionPragmas(
  handle: SqliteDatabase,
  busyTimeoutMs: number,
  path = 'file',
): void {
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs <= 0 || busyTimeoutMs > 60_000) {
    throw new DatabaseOpenError(
      'BUSY_TIMEOUT_OUT_OF_RANGE',
      'busy_timeout must be a positive integer of at most 60000 ms',
    )
  }
  handle.pragma('journal_mode = DELETE')
  handle.pragma('foreign_keys = ON')
  handle.pragma(`busy_timeout = ${busyTimeoutMs}`)

  // An in-memory database has no rollback journal to write and SQLite pins it
  // to "memory"; the DELETE requirement exists to keep WAL off a file on an SMB
  // share, which cannot apply here.
  if (path !== ':memory:') {
    const journalMode = String(handle.pragma('journal_mode', { simple: true })).toLowerCase()
    if (journalMode !== 'delete') {
      throw new DatabaseOpenError(
        'JOURNAL_MODE_REJECTED',
        `journal_mode is "${journalMode}"; ShapePilot requires DELETE`,
      )
    }
  }
  if (handle.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new DatabaseOpenError('FOREIGN_KEYS_REJECTED', 'foreign_keys could not be enabled')
  }
}

/**
 * Open the app-owned database, apply invariants, run pending migrations, and
 * return the handle plus its schema identity. Fast and bounded by construction.
 */
export function openDatabase(options: ConnectionOptions): AppDatabase {
  const { path, busyTimeoutMs, createIfMissing } = options
  let handle: SqliteDatabase
  if (path === ':memory:') {
    handle = new Database(path)
  } else {
    try {
      handle = openPreflightedWritableHandle(options, 'approved-prefix', createIfMissing).handle
    } catch (cause) {
      if (cause instanceof IdentityError || cause instanceof DatabaseOpenError) throw cause
      throw new DatabaseOpenError(
        'DATABASE_UNAVAILABLE',
        `could not open the ShapePilot database at ${path}`,
        { cause },
      )
    }
  }

  try {
    applyConnectionPragmas(handle, busyTimeoutMs, path)
    migrate(handle)

    // Identity is read back from the file the process is about to serve, and
    // includes the actual sqlite_schema catalog rather than trusting the ledger.
    const identity = readDatabaseIdentity(handle)
    assertIdentityMatches(codeIdentity(), identity, `${path} is not a compatible authority`)

    return {
      handle,
      path,
      schemaIdentity: identity.schemaMarker,
      identity,
      close: () => handle.close(),
    }
  } catch (error) {
    handle.close()
    throw error
  }
}

/**
 * Open an already-initialized, current ShapePilot authority for an operator
 * write. Identity is proved before any persistent pragma or migration can touch
 * the file; initialization and upgrades belong to the explicit bootstrap path.
 */
export function openExistingCompatibleDatabase(
  options: Omit<ConnectionOptions, 'createIfMissing' | 'readonly'>,
): AppDatabase {
  const { path, busyTimeoutMs } = options
  let opened: { handle: SqliteDatabase; identity: DatabaseIdentity | null }
  try {
    opened = openPreflightedWritableHandle(
      { ...options, createIfMissing: false },
      'current',
      false,
    )
  } catch (cause) {
    if (cause instanceof IdentityError || cause instanceof DatabaseOpenError) throw cause
    throw new DatabaseOpenError(
      'DATABASE_UNAVAILABLE',
      `could not open the ShapePilot database at ${path}`,
      { cause },
    )
  }
  const { handle } = opened

  try {
    const identity = opened.identity
    if (identity === null) {
      throw new DatabaseOpenError(
        'DATABASE_UNAVAILABLE',
        `could not prove the ShapePilot identity at ${path}`,
      )
    }
    applyConnectionPragmas(handle, busyTimeoutMs, path)
    return {
      handle,
      path,
      schemaIdentity: identity.schemaMarker,
      identity,
      close: () => handle.close(),
    }
  } catch (error) {
    handle.close()
    throw error
  }
}

/** In-memory database with the same invariants; used by tests and dry runs. */
export const openEphemeralDatabase = (): AppDatabase =>
  openDatabase({ path: ':memory:', busyTimeoutMs: 5_000, createIfMissing: true })
