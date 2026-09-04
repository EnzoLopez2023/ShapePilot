// Append-only deterministic migrations.
//
// A migration is identified by its id and a checksum over its exact statements,
// and the ledger stores its ordinal, id, name and checksum. The schema identity
// of a database is a checksum over that ordered ledger, so readiness can compare
// a running database against the shipped code with one cheap read and no
// integrity scan — and so a database with the same head migration but a
// different history is recognised as the different lineage it is.
//
// This module supplies only the *expected* side of such a comparison. The actual
// side is always read out of a database file; see lib/db/identity.ts.
import { createHash } from 'node:crypto'
import DatabaseConstructor from 'better-sqlite3'
import { MIGRATION_LEDGER_DDL } from './schema.ts'
import { migration001 } from './migrations/001-initial.ts'
import { migration002 } from './migrations/002-app-identity.ts'
import { migration003 } from './migrations/003-design-documents.ts'
import { migration004 } from './migrations/004-design-assets.ts'
import { migration005 } from './migrations/005-keycap-projects.ts'
import { migration006 } from './migrations/006-corner-spacers.ts'
import {
  APP_MARKER, SCHEMA_MARKER_FORMAT, schemaMarkerOf, schemaObjectsHash,
} from './identity.ts'
import type { DatabaseIdentity, LedgerEntry } from './identity.ts'

type Database = DatabaseConstructor.Database

export interface Migration {
  readonly id: string
  /** Human-readable name, stored in the ledger beside the id. */
  readonly name: string
  readonly statements: readonly string[]
}

export const MIGRATIONS: readonly Migration[] =
  [migration001, migration002, migration003, migration004, migration005, migration006]

export const migrationChecksum = (migration: Migration): string =>
  createHash('sha256')
    .update(migration.id)
    .update('\u0000')
    .update(migration.statements.join('\u0000'))
    .digest('hex')

/** The ledger this build would write into an empty database. */
export const codeLedger = (migrations: readonly Migration[] = MIGRATIONS): LedgerEntry[] =>
  migrations.map((migration, index) => ({
    ordinal: index,
    id: migration.id,
    name: migration.name,
    checksum: migrationChecksum(migration),
  }))

/** Checksum over the ordered ledger; the value readiness compares. */
export const schemaIdentity = (migrations: readonly Migration[] = MIGRATIONS): string =>
  schemaMarkerOf(codeLedger(migrations))

/**
 * The identity this build expects a database it produced to carry. Used only as
 * the *expected* side of a comparison; the actual side is always read out of a
 * database file (see lib/db/identity.ts).
 */
export const codeIdentity = (migrations: readonly Migration[] = MIGRATIONS): DatabaseIdentity => {
  const ledger = codeLedger(migrations)
  const database = new DatabaseConstructor(':memory:')
  try {
    migrate(database, migrations)
    return {
      app: APP_MARKER,
      schemaFormat: SCHEMA_MARKER_FORMAT,
      schemaMarker: schemaMarkerOf(ledger),
      schemaObjectsSha256: schemaObjectsHash(database),
      headMigration: ledger.at(-1)?.id ?? '',
      ledger,
    }
  } finally {
    database.close()
  }
}

export const headMigrationId = (migrations: readonly Migration[] = MIGRATIONS): string =>
  migrations.at(-1)?.id ?? ''

export interface AppliedMigration {
  id: string
  name: string
  checksum: string
  ordinal: number
  applied_at: string
}

/**
 * Create the ledger table if it is absent and add the `name` column to a ledger
 * written by an older build. Bounded, idempotent, and reached only from
 * `migrate`, never from a request or a read-only inspection.
 */
export function ensureLedgerTable(database: Database): void {
  database.exec(MIGRATION_LEDGER_DDL)
  const columns = (database.prepare('PRAGMA table_info(schema_migrations)').all() as { name: string }[])
    .map((column) => column.name)
  if (!columns.includes('name')) {
    database.exec("ALTER TABLE schema_migrations ADD COLUMN name TEXT NOT NULL DEFAULT ''")
  }
}

/**
 * Read the ledger. Never writes, so readiness and any read-only handle can call
 * it; an absent ledger table reads as an empty ledger, and a ledger written
 * before the `name` column existed reports its id as its name.
 */
export const readAppliedMigrations = (database: Database): AppliedMigration[] => {
  const exists = database.prepare<[], { name: string }>(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations'").get()
  if (!exists) return []
  const columns = (database.prepare('PRAGMA table_info(schema_migrations)').all() as { name: string }[])
    .map((column) => column.name)
  return database
    .prepare<[], AppliedMigration>(
      `SELECT id, ${columns.includes('name') ? 'name' : 'id AS name'}, checksum, ordinal, applied_at
         FROM schema_migrations ORDER BY ordinal`)
    .all()
}

export class MigrationError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'MigrationError'
    this.code = code
  }
}

export interface MigrationResult {
  applied: string[]
  alreadyApplied: string[]
  schemaIdentity: string
}

/**
 * Apply every migration the database has not seen, in order, each in its own
 * transaction. Divergence is a hard failure: a checksum mismatch or an
 * out-of-order ledger means the database was not produced by this code.
 */
export function migrate(
  database: Database,
  migrations: readonly Migration[] = MIGRATIONS,
): MigrationResult {
  ensureLedgerTable(database)
  const applied = readAppliedMigrations(database)

  if (applied.length > migrations.length) {
    throw new MigrationError(
      'SCHEMA_AHEAD_OF_CODE',
      `database has ${applied.length} migrations but this build ships ${migrations.length}`,
    )
  }

  for (const [index, record] of applied.entries()) {
    const expected = migrations[index]
    if (record.id !== expected.id || record.ordinal !== index) {
      throw new MigrationError(
        'MIGRATION_LEDGER_DIVERGED',
        `migration ${index} is "${record.id}" in the database and "${expected.id}" in this build`,
      )
    }
    if (record.checksum !== migrationChecksum(expected)) {
      throw new MigrationError(
        'MIGRATION_CHECKSUM_MISMATCH',
        `migration "${record.id}" was applied from different statements than this build ships`,
      )
    }
    if (record.name !== expected.name) {
      // A ledger written before the name column existed stores ''. Backfilling
      // it is bookkeeping, not a schema change; any other name is divergence.
      if (record.name !== '') {
        throw new MigrationError(
          'MIGRATION_LEDGER_DIVERGED',
          `migration "${record.id}" is named "${record.name}" in the database `
          + `and "${expected.name}" in this build`,
        )
      }
      database.prepare('UPDATE schema_migrations SET name = ? WHERE id = ?')
        .run(expected.name, expected.id)
    }
  }

  const insert = database.prepare(
    'INSERT INTO schema_migrations (id, name, checksum, ordinal) VALUES (?, ?, ?, ?)',
  )
  const pending = migrations.slice(applied.length)
  for (const [offset, migration] of pending.entries()) {
    const ordinal = applied.length + offset
    const run = database.transaction(() => {
      for (const statement of migration.statements) database.exec(statement)
      insert.run(migration.id, migration.name, migrationChecksum(migration), ordinal)
    })
    run()
  }

  return {
    applied: pending.map((m) => m.id),
    alreadyApplied: applied.map((m) => m.id),
    schemaIdentity: schemaIdentity(migrations),
  }
}
