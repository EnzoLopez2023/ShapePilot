// Strictly read-only inspection of an existing ShapePilot database.
//
// This is the path a dry run uses. It is deliberately not `openDatabase`:
//
//   * it never creates a directory, a file or a database
//   * it never sets a persistent pragma (`journal_mode` lives in the file
//     header; `query_only` and `busy_timeout` are connection state only)
//   * it never runs a migration
//   * SQLite itself refuses writes twice over — `readonly` on the handle and
//     `query_only = ON` on the connection
//
// An absent or incompatible target fails here, before anything can touch the
// filesystem. Creating an empty authority is an explicit, separate command
// (`npm run db:init`) or the server's own bootstrap.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import type { SqliteDatabase } from './connection.ts'
import { codeIdentity } from './migrate.ts'
import type { DatabaseIdentity } from './identity.ts'
import { assertIdentityMatches, readDatabaseIdentity } from './identity.ts'

export class ReadOnlyOpenError extends Error {
  readonly code: string
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ReadOnlyOpenError'
    this.code = code
  }
}

export interface ReadOnlyOptions {
  path: string
  busyTimeoutMs?: number
  /**
   * Compare the file's identity against the identity this build would produce.
   * Always on for operator commands; tests turn it off to inspect a foreign
   * database on purpose.
   */
  requireCompatibleIdentity?: boolean
}

export interface ReadOnlyDatabase {
  readonly handle: SqliteDatabase
  readonly path: string
  readonly identity: DatabaseIdentity
  close(): void
}

/**
 * Open an existing database read-only and prove it is a compatible ShapePilot
 * authority before the caller is allowed to plan anything against it.
 */
export function openReadOnlyDatabase(options: ReadOnlyOptions): ReadOnlyDatabase {
  const path = resolve(options.path)
  const busyTimeoutMs = options.busyTimeoutMs ?? 5_000

  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs <= 0 || busyTimeoutMs > 60_000) {
    throw new ReadOnlyOpenError(
      'BUSY_TIMEOUT_OUT_OF_RANGE',
      'busy_timeout must be a positive integer of at most 60000 ms',
    )
  }
  if (!existsSync(path)) {
    throw new ReadOnlyOpenError(
      'TARGET_MISSING',
      `no ShapePilot database exists at ${path}; a dry run never creates one — `
      + 'initialize the target explicitly with `npm run db:init` first',
    )
  }

  let handle: SqliteDatabase
  try {
    handle = new Database(path, { readonly: true, fileMustExist: true })
  } catch (cause) {
    throw new ReadOnlyOpenError(
      'TARGET_UNREADABLE', `could not open ${path} read-only`, { cause })
  }

  try {
    handle.pragma(`busy_timeout = ${busyTimeoutMs}`)
    handle.pragma('query_only = ON')
    if (handle.pragma('query_only', { simple: true }) !== 1) {
      throw new ReadOnlyOpenError(
        'QUERY_ONLY_REJECTED', 'query_only could not be enabled on the target connection')
    }

    const identity = readDatabaseIdentity(handle)
    if (options.requireCompatibleIdentity !== false) {
      assertIdentityMatches(codeIdentity(), identity, `${path} is not a compatible target`)
    }
    return { handle, path, identity, close: () => handle.close() }
  } catch (error) {
    handle.close()
    throw error
  }
}
