// Durable, snapshot-derived database identity.
//
// Everything here reads identity *out of a database file*: the app marker row
// written by the app-identity migration, and the append-only migration ledger
// with its ordinal, id, name and checksum. Nothing in this module consults the
// running build, so a snapshot, a restored copy and a live authority are all
// judged by the same evidence.
//
// The schema marker is a checksum over the ordered ledger. Two databases whose
// head migration id is identical but whose earlier entries differ in id, order
// or checksum produce different markers, which is exactly the divergence a
// backup or a restore has to refuse.
import { createHash } from 'node:crypto'
import type DatabaseConstructor from 'better-sqlite3'

type Database = DatabaseConstructor.Database

export const APP_MARKER = 'shapepilot'
export const SCHEMA_MARKER_FORMAT = 'shapepilot.schema-identity.v1'
export const APP_IDENTITY_TABLE = 'app_identity'
export const MIGRATION_LEDGER_TABLE = 'schema_migrations'

export class IdentityError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'IdentityError'
    this.code = code
  }
}

/** One row of the append-only ledger, as stored. */
export interface LedgerEntry {
  ordinal: number
  id: string
  name: string
  checksum: string
}

export interface DatabaseIdentity {
  app: string
  schemaFormat: string
  /** Checksum over the complete ordered ledger. */
  schemaMarker: string
  /** Checksum over the complete non-internal sqlite_schema catalog. */
  schemaObjectsSha256: string
  headMigration: string
  ledger: LedgerEntry[]
}

/**
 * The schema marker. Ordinal, id, name and checksum all participate, so a
 * reordered, renamed, truncated or re-checksummed ledger cannot collide with
 * the ledger this build ships.
 */
export function schemaMarkerOf(ledger: readonly LedgerEntry[]): string {
  const hash = createHash('sha256')
  hash.update(`${SCHEMA_MARKER_FORMAT}\u0000`)
  for (const entry of ledger) {
    hash.update(`${entry.ordinal}:${entry.id}:${entry.name}:${entry.checksum}\u0000`)
  }
  return hash.digest('hex')
}

/** Bind identity to the schema actually present, not only the claimed ledger. */
export function schemaObjectsHash(database: Database): string {
  const objects = database.prepare<[], {
    type: string
    name: string
    tableName: string
    sql: string | null
  }>(
    `SELECT type, name, tbl_name AS tableName, sql
       FROM sqlite_schema
      WHERE name NOT LIKE 'sqlite_%'
      ORDER BY type, name`,
  ).all().map((object) => {
    if (object.type !== 'table' || object.name !== MIGRATION_LEDGER_TABLE) {
      return {
        ...object,
        sql: object.sql?.replace(/\s+/g, ' ').trim() ?? null,
      }
    }

    const columns = database.prepare(`PRAGMA table_xinfo(${MIGRATION_LEDGER_TABLE})`)
      .all() as Record<string, unknown>[]
    if (!columns.some((column) => column.name === 'name')) {
      columns.push({
        cid: columns.length,
        name: 'name',
        type: 'TEXT',
        notnull: 1,
        dflt_value: "''",
        pk: 0,
        hidden: 0,
      })
    }
    return {
      type: object.type,
      name: object.name,
      tableName: object.tableName,
      columns: columns.map((column) => ({
        cid: Number(column.cid),
        name: String(column.name),
        type: String(column.type),
        notnull: Number(column.notnull),
        defaultValue: column.dflt_value == null ? null : String(column.dflt_value),
        primaryKey: Number(column.pk),
        hidden: Number(column.hidden),
      })),
    }
  })
  return createHash('sha256')
    .update('shapepilot.sqlite-schema-catalog.v1\u0000')
    .update(JSON.stringify(objects))
    .digest('hex')
}

const tableExists = (database: Database, name: string): boolean =>
  database.prepare<[string], { name: string }>(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name) != null

/**
 * Read the ledger exactly as stored, ordered by ordinal. Never creates the
 * table: this is safe to call on a read-only handle.
 */
export function readMigrationLedger(database: Database): LedgerEntry[] {
  if (!tableExists(database, MIGRATION_LEDGER_TABLE)) return []
  const columns = new Set(
    (database.prepare(`PRAGMA table_info(${MIGRATION_LEDGER_TABLE})`).all() as { name: string }[])
      .map((column) => column.name))
  const nameColumn = columns.has('name') ? 'name' : 'id AS name'
  return database.prepare<[], { ordinal: number | bigint; id: string; name: string; checksum: string }>(
    `SELECT ordinal, id, ${nameColumn}, checksum FROM ${MIGRATION_LEDGER_TABLE} ORDER BY ordinal`,
  ).all().map((row) => ({
    ordinal: Number(row.ordinal),
    id: String(row.id),
    name: String(row.name),
    checksum: String(row.checksum),
  }))
}

/** Read one app-identity marker, or null when the table or row is absent. */
export function readIdentityMarker(database: Database, key: string): string | null {
  if (!tableExists(database, APP_IDENTITY_TABLE)) return null
  const row = database.prepare<[string], { value: string }>(
    `SELECT value FROM ${APP_IDENTITY_TABLE} WHERE key = ?`).get(key)
  return row ? String(row.value) : null
}

/** Durable nonce distinguishing independently initialized authority files. */
export function readAuthorityId(database: Database): string {
  const authorityId = readIdentityMarker(database, 'authority_id')
  if (authorityId === null) {
    throw new IdentityError(
      'AUTHORITY_ID_MISSING',
      'the database carries no authority identifier',
    )
  }
  if (!/^[0-9a-f]{32}$/.test(authorityId)) {
    throw new IdentityError(
      'AUTHORITY_ID_INVALID',
      'the database authority identifier is malformed',
    )
  }
  return authorityId
}

/**
 * The complete identity of a database file. Fails closed: a database with no
 * app marker, no schema-format marker or an empty ledger has no identity and
 * must never be treated as a ShapePilot authority.
 */
export function readDatabaseIdentity(database: Database): DatabaseIdentity {
  const app = readIdentityMarker(database, 'app')
  const schemaFormat = readIdentityMarker(database, 'schema_format')
  const ledger = readMigrationLedger(database)

  if (app === null) {
    throw new IdentityError(
      'APP_MARKER_MISSING',
      'the database carries no app identity marker; it was not produced by ShapePilot',
    )
  }
  if (schemaFormat === null) {
    throw new IdentityError(
      'SCHEMA_MARKER_MISSING',
      'the database carries no schema identity format marker',
    )
  }
  if (ledger.length === 0) {
    throw new IdentityError('MIGRATION_LEDGER_EMPTY', 'the database has no migration ledger')
  }
  readAuthorityId(database)

  return {
    app,
    schemaFormat,
    schemaMarker: schemaMarkerOf(ledger),
    schemaObjectsSha256: schemaObjectsHash(database),
    headMigration: ledger.at(-1)?.id ?? '',
    ledger,
  }
}

/**
 * Compare two identities entry by entry. The head migration is compared last
 * and on purpose: an identical head with a divergent history is the failure
 * this function exists to catch, so every earlier entry is checked first.
 */
export function identityDifferences(
  expected: DatabaseIdentity, actual: DatabaseIdentity,
): string[] {
  const differences: string[] = []
  if (actual.app !== expected.app) {
    differences.push(`app marker is "${actual.app}", expected "${expected.app}"`)
  }
  if (actual.schemaFormat !== expected.schemaFormat) {
    differences.push(
      `schema format marker is "${actual.schemaFormat}", expected "${expected.schemaFormat}"`)
  }
  if (actual.ledger.length !== expected.ledger.length) {
    differences.push(
      `migration ledger has ${actual.ledger.length} entries, expected ${expected.ledger.length}`)
  }
  const depth = Math.min(actual.ledger.length, expected.ledger.length)
  for (let index = 0; index < depth; index += 1) {
    const want = expected.ledger[index]
    const have = actual.ledger[index]
    if (have.ordinal !== want.ordinal) {
      differences.push(`ledger entry ${index} has ordinal ${have.ordinal}, expected ${want.ordinal}`)
    }
    if (have.id !== want.id) {
      differences.push(`ledger entry ${index} is "${have.id}", expected "${want.id}"`)
    }
    if (have.name !== want.name) {
      differences.push(
        `ledger entry ${index} is named "${have.name}", expected "${want.name}"`)
    }
    if (have.checksum !== want.checksum) {
      differences.push(`ledger entry ${index} ("${want.id}") has a different checksum`)
    }
  }
  if (actual.schemaMarker !== expected.schemaMarker) {
    differences.push('schema marker does not match the expected ordered migration ledger')
  }
  if (actual.schemaObjectsSha256 !== expected.schemaObjectsSha256) {
    differences.push('sqlite_schema catalog does not match the expected application schema')
  }
  if (actual.headMigration !== expected.headMigration) {
    differences.push(
      `head migration is "${actual.headMigration}", expected "${expected.headMigration}"`)
  }
  return differences
}

export function assertIdentityMatches(
  expected: DatabaseIdentity, actual: DatabaseIdentity, context: string,
): void {
  const differences = identityDifferences(expected, actual)
  if (differences.length > 0) {
    throw new IdentityError(
      'SCHEMA_IDENTITY_MISMATCH',
      `${context}: ${differences.join('; ')}`,
    )
  }
}
