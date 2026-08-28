// Export bundle contract.
//
// The bundle is one JSON document: mandatory source evidence, the canonical
// rows of the three owned tables, the parent/child relationships between them,
// and `sqlite_sequence`. Nothing about the source is inferred — every field
// below is supplied by the operator and checked, so an import can never be
// pointed at an artifact whose provenance was not stated up front.
import { OWNED_LEGACY_TABLES } from '../db/schema.ts'
import type { OwnedLegacyTable } from '../db/schema.ts'
import type { CanonicalRow } from './canonical.ts'
import { LEGACY_COLUMNS, serializeCanonical, sha256 } from './canonical.ts'
import type { CanonicalColumn } from './canonicalTable.ts'
import { PRODUCT_CANONICAL_ALGORITHM, TABLE_CANONICAL_ALGORITHM } from './canonicalTable.ts'

// v2 adds per-table source schema metadata (the CREATE statement hash, the
// primary key and the declared column list) and the canonical table/product
// hashes, so an importer can recompute both from the exported rows and the
// approved column metadata instead of trusting anything the bundle asserts
// about itself.
export const EXPORT_CONTRACT = 'shapepilot.legacy-export.v2'
export const EXPORT_CONTRACT_VERSION = 2
export const REPORT_CONTRACT = 'shapepilot.legacy-import-report.v1'
export const REPORT_CONTRACT_VERSION = 1
export const RECONCILE_CONTRACT = 'shapepilot.legacy-reconcile-report.v1'
export const RECONCILE_CONTRACT_VERSION = 1

export interface SourceEvidence {
  repository: string
  commit: string
  tree: string
  version: string
  build: number
  imageDigest: string
  backupBundle: string
  backupCreatedUtc: string
  file: string
  bytes: number
  sha256: string
}

/** The source table's schema, exactly as the backup declares it. */
export interface ExportedTableSchema {
  /** sha256 of the CREATE statement, byte for byte as stored. */
  createSqlSha256: string
  primaryKey: string[]
  columns: CanonicalColumn[]
}

export interface ExportedTable {
  name: OwnedLegacyTable
  columns: readonly string[]
  rowCount: number
  primaryKeys: number[]
  rowsHash: string
  schema: ExportedTableSchema
  /** `hearth.sqlite-table-canonical.v1`, recomputed and checked on import. */
  canonicalSha256: string
  rows: CanonicalRow[]
}

export interface Relationship {
  child: OwnedLegacyTable
  parent: OwnedLegacyTable
  column: string
  pairs: [number, number][]
}

export interface SequenceEntry { name: string; seq: number }

export interface ExportCanonicalIdentity {
  tableAlgorithm: typeof TABLE_CANONICAL_ALGORITHM
  productAlgorithm: typeof PRODUCT_CANONICAL_ALGORITHM
  product: string
  productCanonicalSha256: string
}

export interface ExportBundle {
  contract: typeof EXPORT_CONTRACT
  contractVersion: number
  app: 'shapepilot'
  createdUtc: string
  source: SourceEvidence
  /** sha256 of each owned table's CREATE statement, exactly as stored. */
  sourceSchema: Record<string, string>
  canonical: ExportCanonicalIdentity
  tables: ExportedTable[]
  relationships: Relationship[]
  sqliteSequence: SequenceEntry[]
}

export class LegacyError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'LegacyError'
    this.code = code
  }
}

const HEX40 = /^[0-9a-f]{40}$/
const HEX64 = /^[0-9a-f]{64}$/
const DIGEST = /^sha256:[0-9a-f]{64}$/

const text = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LegacyError('SOURCE_EVIDENCE_INVALID', `${label} is required`)
  }
  return value.trim()
}

export function assertIsoUtc(value: unknown, label: string): string {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new LegacyError('SOURCE_EVIDENCE_INVALID', `${label} must be an ISO-8601 UTC timestamp`)
  }
  return value as string
}

/** Every field is mandatory. There is no partial-evidence mode. */
export function validateSourceEvidence(value: unknown): SourceEvidence {
  const raw = (value ?? {}) as Record<string, unknown>
  const commit = text(raw.commit, 'source.commit').toLowerCase()
  const tree = text(raw.tree, 'source.tree').toLowerCase()
  const digest = text(raw.imageDigest, 'source.imageDigest').toLowerCase()
  const hash = text(raw.sha256, 'source.sha256').toLowerCase()
  const bytes = raw.bytes
  const build = raw.build

  if (!HEX40.test(commit)) throw new LegacyError('SOURCE_EVIDENCE_INVALID', 'source.commit must be a 40-character git sha')
  if (!HEX40.test(tree)) throw new LegacyError('SOURCE_EVIDENCE_INVALID', 'source.tree must be a 40-character git sha')
  if (!DIGEST.test(digest)) throw new LegacyError('SOURCE_EVIDENCE_INVALID', 'source.imageDigest must be sha256:<64 hex>')
  if (!HEX64.test(hash)) throw new LegacyError('SOURCE_EVIDENCE_INVALID', 'source.sha256 must be 64 lowercase hex characters')
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new LegacyError('SOURCE_EVIDENCE_INVALID', 'source.bytes must be a positive integer')
  }
  if (typeof build !== 'number' || !Number.isSafeInteger(build) || build < 0) {
    throw new LegacyError('SOURCE_EVIDENCE_INVALID', 'source.build must be a non-negative integer')
  }

  return {
    repository: text(raw.repository, 'source.repository'),
    commit,
    tree,
    version: text(raw.version, 'source.version'),
    build,
    imageDigest: digest,
    backupBundle: text(raw.backupBundle, 'source.backupBundle'),
    backupCreatedUtc: assertIsoUtc(raw.backupCreatedUtc, 'source.backupCreatedUtc'),
    file: text(raw.file, 'source.file'),
    bytes,
    sha256: hash,
  }
}

/** The bundle hash. It covers everything, so tampering with any field fails. */
export const bundleHash = (bundle: ExportBundle): string => sha256(serializeCanonical(bundle))

export function validateExportBundle(value: unknown): ExportBundle {
  const raw = (value ?? {}) as Record<string, unknown>
  if (raw.contract !== EXPORT_CONTRACT) {
    throw new LegacyError('EXPORT_CONTRACT_INVALID', `contract must be ${EXPORT_CONTRACT}`)
  }
  if (raw.contractVersion !== EXPORT_CONTRACT_VERSION) {
    throw new LegacyError('EXPORT_CONTRACT_INVALID', 'unsupported export contract version')
  }
  if (raw.app !== 'shapepilot') {
    throw new LegacyError('EXPORT_CONTRACT_INVALID', 'export bundle is not a ShapePilot bundle')
  }
  assertIsoUtc(raw.createdUtc, 'createdUtc')
  const source = validateSourceEvidence(raw.source)

  const tables = raw.tables
  if (!Array.isArray(tables) || tables.length !== OWNED_LEGACY_TABLES.length) {
    throw new LegacyError(
      'EXPORT_TABLES_INVALID',
      `export must contain exactly ${OWNED_LEGACY_TABLES.length} tables`,
    )
  }
  for (const [index, expected] of OWNED_LEGACY_TABLES.entries()) {
    const table = tables[index] as ExportedTable
    if (table?.name !== expected) {
      throw new LegacyError('EXPORT_TABLES_INVALID', `table ${index} must be ${expected}`)
    }
    const columns = LEGACY_COLUMNS[expected]
    if (!Array.isArray(table.columns) || table.columns.join(',') !== columns.join(',')) {
      throw new LegacyError('EXPORT_COLUMNS_INVALID', `${expected} column list does not match the pinned schema`)
    }
    if (!Array.isArray(table.rows) || table.rows.length !== table.rowCount) {
      throw new LegacyError('EXPORT_ROWS_INVALID', `${expected} rowCount does not match the row array`)
    }
    for (const row of table.rows) {
      if (!Array.isArray(row) || row.length !== columns.length) {
        throw new LegacyError('EXPORT_ROWS_INVALID', `${expected} has a row with the wrong arity`)
      }
    }
    const schema = table.schema
    if (!schema || typeof schema !== 'object'
      || !HEX64.test(String(schema.createSqlSha256))
      || !Array.isArray(schema.primaryKey) || schema.primaryKey.length === 0
      || !Array.isArray(schema.columns) || schema.columns.length === 0) {
      throw new LegacyError(
        'EXPORT_SCHEMA_INVALID', `${expected} is missing its source schema metadata`)
    }
    for (const column of schema.columns) {
      if (typeof column?.name !== 'string' || typeof column.type !== 'string'
        || typeof column.notNull !== 'boolean'
        || !Number.isSafeInteger(column.primaryKeyOrder)) {
        throw new LegacyError(
          'EXPORT_SCHEMA_INVALID', `${expected} has malformed column metadata`)
      }
    }
    if (!HEX64.test(String(table.canonicalSha256))) {
      throw new LegacyError(
        'EXPORT_CANONICAL_INVALID', `${expected}.canonicalSha256 must be 64 lowercase hex characters`)
    }
  }

  const canonical = raw.canonical as ExportCanonicalIdentity | undefined
  if (!canonical || canonical.tableAlgorithm !== TABLE_CANONICAL_ALGORITHM
    || canonical.productAlgorithm !== PRODUCT_CANONICAL_ALGORITHM
    || typeof canonical.product !== 'string' || canonical.product.trim() === ''
    || !HEX64.test(String(canonical.productCanonicalSha256))) {
    throw new LegacyError(
      'EXPORT_CANONICAL_INVALID', 'the bundle canonical identity block is missing or malformed')
  }

  if (!Array.isArray(raw.relationships)) {
    throw new LegacyError('EXPORT_RELATIONSHIPS_INVALID', 'relationships must be an array')
  }
  for (const relationship of raw.relationships as Relationship[]) {
    if (!relationship || !OWNED_LEGACY_TABLES.includes(relationship.child)
      || !OWNED_LEGACY_TABLES.includes(relationship.parent)
      || typeof relationship.column !== 'string'
      || !Array.isArray(relationship.pairs)
      || relationship.pairs.some((pair) =>
        !Array.isArray(pair) || pair.length !== 2
        || !pair.every((value) => Number.isSafeInteger(value)))) {
      throw new LegacyError(
        'EXPORT_RELATIONSHIPS_INVALID',
        'relationships must contain owned tables, a column, and safe-integer key pairs',
      )
    }
  }
  if (!Array.isArray(raw.sqliteSequence)) {
    throw new LegacyError('EXPORT_SEQUENCE_INVALID', 'sqliteSequence must be an array')
  }
  if (raw.sqliteSequence.length !== OWNED_LEGACY_TABLES.length) {
    throw new LegacyError(
      'EXPORT_SEQUENCE_INVALID',
      `sqliteSequence must contain exactly ${OWNED_LEGACY_TABLES.length} entries`,
    )
  }
  for (const [index, expected] of OWNED_LEGACY_TABLES.entries()) {
    const sequence = raw.sqliteSequence[index] as SequenceEntry | undefined
    if (sequence?.name !== expected
      || !Number.isSafeInteger(sequence.seq)
      || sequence.seq < 0) {
      throw new LegacyError(
        'EXPORT_SEQUENCE_INVALID',
        `sqliteSequence ${index} must be ${expected} with a non-negative safe-integer seq`,
      )
    }
  }
  if (!raw.sourceSchema || typeof raw.sourceSchema !== 'object') {
    throw new LegacyError('EXPORT_SCHEMA_INVALID', 'sourceSchema must be an object')
  }

  return { ...(raw as unknown as ExportBundle), source }
}
