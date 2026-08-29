// Deterministic legacy export.
//
// Reads only a supplied immutable/quiesced SQLite backup, never the live
// production file and never a database this app can write. The source file is
// hashed before opening and again after closing; any difference aborts, which
// is how "immutable" is enforced given that better-sqlite3 does not expose
// SQLite's URI `immutable=1` flag.
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { statSync, existsSync } from 'node:fs'
import Database from 'better-sqlite3'
import type DatabaseConstructor from 'better-sqlite3'
import { OWNED_LEGACY_TABLES } from '../db/schema.ts'
import type { OwnedLegacyTable } from '../db/schema.ts'
import type { CanonicalRow, SqlValue } from './canonical.ts'
import {
  LEGACY_COLUMNS, PRIMARY_KEY, canonicalRow, rowId, rowsHash, sha256,
} from './canonical.ts'
import type { ExportBundle, ExportedTable, Relationship, SequenceEntry, SourceEvidence } from './manifest.ts'
import {
  EXPORT_CONTRACT, EXPORT_CONTRACT_VERSION, LegacyError, validateSourceEvidence,
} from './manifest.ts'
import {
  PRODUCT_CANONICAL_ALGORITHM, TABLE_CANONICAL_ALGORITHM,
  canonicalTableHashFromDatabase, primaryKeyColumns, productCanonicalHash,
} from './canonicalTable.ts'
import { APPROVED_SOURCE } from './approvedSource.ts'

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Uint8Array)
  return hash.digest('hex')
}

/** Ordering is by primary key so two exports of the same source are identical. */
const SELECT_ORDER: Record<OwnedLegacyTable, string> = {
  keycap_tray_designs: 'id',
  keycap_tray_pockets: 'design_id, sort_order, id',
  keycap_pocket_library: 'id',
}

export interface OpenImmutableResult {
  handle: DatabaseConstructor.Database
  bytes: number
  sha256: string
}

/**
 * Open a backup strictly read-only after proving it is quiesced and matches the
 * declared bytes and hash.
 */
export async function openImmutableSource(
  path: string,
  expected: { bytes: number; sha256: string },
): Promise<OpenImmutableResult> {
  if (!existsSync(path)) {
    throw new LegacyError('SOURCE_MISSING', `the supplied backup does not exist: ${path}`)
  }
  for (const sidecar of [`${path}-journal`, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(sidecar)) {
      throw new LegacyError(
        'SOURCE_NOT_QUIESCED',
        `the backup has a live ${sidecar.split('-').pop()} sidecar and is not quiesced`,
      )
    }
  }

  const stats = statSync(path)
  if (stats.size !== expected.bytes) {
    throw new LegacyError(
      'SOURCE_BYTES_MISMATCH',
      `the backup is ${stats.size} bytes; the supplied evidence says ${expected.bytes}`,
    )
  }
  const actual = await sha256File(path)
  if (actual !== expected.sha256) {
    throw new LegacyError(
      'SOURCE_HASH_MISMATCH',
      'the backup SHA-256 does not match the supplied source evidence',
    )
  }

  const handle = new Database(path, { readonly: true, fileMustExist: true })
  return { handle, bytes: stats.size, sha256: actual }
}

/** Re-hash after closing: proves nothing wrote to the source during the read. */
export async function assertSourceUnchanged(
  path: string,
  expected: { bytes: number; sha256: string },
): Promise<void> {
  const stats = statSync(path)
  const actual = await sha256File(path)
  if (stats.size !== expected.bytes || actual !== expected.sha256) {
    throw new LegacyError('SOURCE_MUTATED', 'the backup changed while it was being read')
  }
}

function readSchemaIdentity(handle: DatabaseConstructor.Database): Record<string, string> {
  const identity: Record<string, string> = {}
  for (const table of OWNED_LEGACY_TABLES) {
    const row = handle.prepare<[string], { sql: string | null }>(
      "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table)
    if (!row?.sql) {
      throw new LegacyError('SOURCE_SCHEMA_MISSING', `${table} is not present in the backup`)
    }
    const columns = handle.prepare<[], { name: string }>(
      `PRAGMA table_info(${table})`).all().map((c) => c.name)
    for (const expected of LEGACY_COLUMNS[table]) {
      if (!columns.includes(expected)) {
        throw new LegacyError(
          'SOURCE_SCHEMA_MISMATCH',
          `${table} is missing the pinned column ${expected}`,
        )
      }
    }
    identity[table] = sha256(row.sql)
  }
  return identity
}

function readTable(
  handle: DatabaseConstructor.Database,
  table: OwnedLegacyTable,
  createSqlSha256: string,
): ExportedTable {
  const columns = LEGACY_COLUMNS[table]
  const rows = handle.prepare<[], Record<string, SqlValue>>(
    `SELECT ${columns.join(', ')} FROM ${table} ORDER BY ${SELECT_ORDER[table]}`,
  ).all().map((row) => canonicalRow(table, row))

  // The canonical hash is computed straight from the source database, on the
  // same terms the independent oracle uses. The importer recomputes it from
  // these rows and the approved column metadata and refuses any disagreement,
  // so this value is evidence, never authority.
  const canonical = canonicalTableHashFromDatabase(handle, table)
  if (canonical.rowCount !== rows.length) {
    throw new LegacyError(
      'SOURCE_ROW_COUNT_UNSTABLE',
      `${table} returned ${rows.length} projected rows and ${canonical.rowCount} canonical rows`,
    )
  }

  return {
    name: table,
    columns,
    rowCount: rows.length,
    primaryKeys: rows.map((row) => rowId(row, table)),
    rowsHash: rowsHash(table, rows),
    schema: {
      createSqlSha256,
      primaryKey: primaryKeyColumns(canonical.columns).map((column) => column.name),
      columns: canonical.columns,
    },
    canonicalSha256: canonical.hash,
    rows,
  }
}

function readRelationships(handle: DatabaseConstructor.Database): Relationship[] {
  const pairs = handle.prepare<[], { id: number; design_id: number }>(
    'SELECT id, design_id FROM keycap_tray_pockets ORDER BY id',
  ).all()
  return [{
    child: 'keycap_tray_pockets',
    parent: 'keycap_tray_designs',
    column: 'design_id',
    pairs: pairs.map((p) => [Number(p.id), Number(p.design_id)] as [number, number]),
  }]
}

function readSequences(handle: DatabaseConstructor.Database): SequenceEntry[] {
  const exists = handle.prepare<[], { name: string }>(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'sqlite_sequence'").get()
  if (!exists) return OWNED_LEGACY_TABLES.map((name) => ({ name, seq: 0 }))
  const rows = new Map(
    handle.prepare<string[], { name: string; seq: number }>(
      `SELECT name, seq FROM sqlite_sequence WHERE name IN (${
        OWNED_LEGACY_TABLES.map(() => '?').join(', ')} )`,
    ).all(...OWNED_LEGACY_TABLES).map((row) => [row.name, Number(row.seq)]),
  )
  return OWNED_LEGACY_TABLES.map((name) => ({ name, seq: rows.get(name) ?? 0 }))
}

export interface ExportOptions {
  backupPath: string
  source: unknown
  /** Frozen for reproducibility in tests; defaults to now. */
  createdUtc?: string
  /** Product name used for the canonical product hash. Defaults to ShapePilot. */
  product?: string
}

export async function exportLegacyBundle(options: ExportOptions): Promise<ExportBundle> {
  const source: SourceEvidence = validateSourceEvidence(options.source)
  const opened = await openImmutableSource(options.backupPath, source)

  let bundle: ExportBundle
  try {
    const sourceSchema = readSchemaIdentity(opened.handle)
    const tables = OWNED_LEGACY_TABLES.map(
      (table) => readTable(opened.handle, table, sourceSchema[table]))
    bundle = {
      contract: EXPORT_CONTRACT,
      contractVersion: EXPORT_CONTRACT_VERSION,
      app: 'shapepilot',
      createdUtc: options.createdUtc ?? source.backupCreatedUtc,
      source,
      sourceSchema,
      canonical: {
        tableAlgorithm: TABLE_CANONICAL_ALGORITHM,
        productAlgorithm: PRODUCT_CANONICAL_ALGORITHM,
        product: options.product ?? APPROVED_SOURCE.product,
        productCanonicalSha256: productCanonicalHash(
          options.product ?? APPROVED_SOURCE.product,
          tables.map((table) => ({
            name: table.name,
            canonicalSha256: table.canonicalSha256,
            rowCount: table.rowCount,
          })),
        ),
      },
      tables,
      relationships: readRelationships(opened.handle),
      sqliteSequence: readSequences(opened.handle),
    }
  } finally {
    opened.handle.close()
  }

  await assertSourceUnchanged(options.backupPath, source)
  return bundle
}

export type { CanonicalRow, ExportBundle }
export { PRIMARY_KEY }
