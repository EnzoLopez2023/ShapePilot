// The approved ShapePilot legacy source.
//
// `approved-source.json` is checked in and copied from coordinator evidence:
// the decomposition manifest, the production backup manifest, the product data
// baseline and the canonical hash artifact produced by the coordinator's
// independent `hash-sqlite-tables.mjs` oracle. It is the only source an import
// may write from.
//
// Everything the gate needs is here — repository, commit, tree, version, build,
// image digest, backup bundle identity, source database bytes and hash, the
// exact owned row counts, the exact source schema identity and column metadata
// per table, the per-table canonical hashes and the product hash. The importer
// recomputes the canonical hashes from the rows an export bundle actually
// carries plus the *approved* column metadata, so a bundle that declares its
// own hashes gains nothing by lying about them.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OWNED_LEGACY_TABLES } from '../db/schema.ts'
import type { OwnedLegacyTable } from '../db/schema.ts'
import type { CanonicalColumn } from './canonicalTable.ts'
import { PRODUCT_CANONICAL_ALGORITHM, TABLE_CANONICAL_ALGORITHM } from './canonicalTable.ts'

export const APPROVED_SOURCE_CONTRACT = 'shapepilot.approved-legacy-source.v1'
export const APPROVED_SOURCE_CONTRACT_VERSION = 1
export const APPROVED_SOURCE_FILE = 'approved-source.json'

export class ApprovedSourceError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ApprovedSourceError'
    this.code = code
  }
}

export interface ApprovedSourceIdentity {
  repository: string
  commit: string
  tree: string
  version: string
  build: number
  imageDigest: string
  workflowRunId: string
  backupBundle: string
  backupCreatedUtc: string
  bytes: number
  sha256: string
}

export interface ApprovedTable {
  name: OwnedLegacyTable
  rowCount: number
  /** sha256 of the source table's CREATE statement, exactly as stored. */
  createSqlSha256: string
  primaryKey: string[]
  columns: CanonicalColumn[]
  canonicalSha256: string
}

export interface ApprovedSource {
  contract: typeof APPROVED_SOURCE_CONTRACT
  contractVersion: number
  app: 'shapepilot'
  product: string
  status: 'approved'
  recordedUtc: string
  evidence: Record<string, unknown>
  source: ApprovedSourceIdentity
  canonical: {
    tableAlgorithm: string
    productAlgorithm: string
    productCanonicalSha256: string
    totalRowCount: number
  }
  sqliteSequence: { name: OwnedLegacyTable; seq: number }[]
  tables: ApprovedTable[]
}

const HEX40 = /^[0-9a-f]{40}$/
const HEX64 = /^[0-9a-f]{64}$/
const DIGEST = /^sha256:[0-9a-f]{64}$/

const fail = (message: string): never => {
  throw new ApprovedSourceError('APPROVED_SOURCE_INVALID', message)
}

const requireText = (value: unknown, label: string): string =>
  (typeof value === 'string' && value.trim() !== '' ? value : fail(`${label} is required`))

const requireCount = (value: unknown, label: string): number =>
  (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fail(`${label} must be a non-negative integer`))

/**
 * Validate the checked-in contract. This runs on the artifact that ships with
 * the build, so a corrupted or hand-edited contract is caught the first time
 * anything imports it rather than at the moment it would have waved a bad
 * bundle through.
 */
export function validateApprovedSource(value: unknown): ApprovedSource {
  const raw = (value ?? {}) as Record<string, unknown>
  if (raw.contract !== APPROVED_SOURCE_CONTRACT) {
    fail(`contract must be ${APPROVED_SOURCE_CONTRACT}`)
  }
  if (raw.contractVersion !== APPROVED_SOURCE_CONTRACT_VERSION) {
    fail('unsupported approved source contract version')
  }
  if (raw.app !== 'shapepilot') fail('approved source is not a ShapePilot contract')
  if (raw.status !== 'approved') fail('approved source is not marked approved')

  const source = (raw.source ?? {}) as Record<string, unknown>
  if (!HEX40.test(String(source.commit))) fail('source.commit must be a 40-character git sha')
  if (!HEX40.test(String(source.tree))) fail('source.tree must be a 40-character git sha')
  if (!DIGEST.test(String(source.imageDigest))) fail('source.imageDigest must be sha256:<64 hex>')
  if (!HEX64.test(String(source.sha256))) fail('source.sha256 must be 64 lowercase hex characters')
  requireText(source.repository, 'source.repository')
  requireText(source.version, 'source.version')
  requireText(source.backupBundle, 'source.backupBundle')
  requireText(source.backupCreatedUtc, 'source.backupCreatedUtc')
  requireCount(source.build, 'source.build')
  if (requireCount(source.bytes, 'source.bytes') === 0) fail('source.bytes must be positive')

  const canonical = (raw.canonical ?? {}) as Record<string, unknown>
  if (canonical.tableAlgorithm !== TABLE_CANONICAL_ALGORITHM) {
    fail(`canonical.tableAlgorithm must be ${TABLE_CANONICAL_ALGORITHM}`)
  }
  if (canonical.productAlgorithm !== PRODUCT_CANONICAL_ALGORITHM) {
    fail(`canonical.productAlgorithm must be ${PRODUCT_CANONICAL_ALGORITHM}`)
  }
  if (!HEX64.test(String(canonical.productCanonicalSha256))) {
    fail('canonical.productCanonicalSha256 must be 64 lowercase hex characters')
  }

  const tables = raw.tables
  if (!Array.isArray(tables) || tables.length !== OWNED_LEGACY_TABLES.length) {
    fail(`approved source must describe exactly ${OWNED_LEGACY_TABLES.length} owned tables`)
  }
  let totalRows = 0
  for (const [index, expected] of OWNED_LEGACY_TABLES.entries()) {
    const table = (tables as ApprovedTable[])[index]
    if (table?.name !== expected) fail(`approved table ${index} must be ${expected}`)
    if (!HEX64.test(String(table.createSqlSha256))) {
      fail(`${expected}.createSqlSha256 must be 64 lowercase hex characters`)
    }
    if (!HEX64.test(String(table.canonicalSha256))) {
      fail(`${expected}.canonicalSha256 must be 64 lowercase hex characters`)
    }
    totalRows += requireCount(table.rowCount, `${expected}.rowCount`)
    if (!Array.isArray(table.columns) || table.columns.length === 0) {
      fail(`${expected}.columns must be a non-empty array`)
    }
    for (const column of table.columns) {
      requireText(column?.name, `${expected} column name`)
      if (typeof column.type !== 'string') fail(`${expected}.${column.name} needs a declared type`)
      if (typeof column.notNull !== 'boolean') fail(`${expected}.${column.name} needs notNull`)
      requireCount(column.primaryKeyOrder, `${expected}.${column.name}.primaryKeyOrder`)
    }
    if (!Array.isArray(table.primaryKey) || table.primaryKey.length === 0) {
      fail(`${expected}.primaryKey must be a non-empty array`)
    }
  }
  if (requireCount(canonical.totalRowCount, 'canonical.totalRowCount') !== totalRows) {
    fail('canonical.totalRowCount disagrees with the approved per-table row counts')
  }

  if (!Array.isArray(raw.sqliteSequence)
    || raw.sqliteSequence.length !== OWNED_LEGACY_TABLES.length) {
    fail(`approved source must pin exactly ${OWNED_LEGACY_TABLES.length} SQLite sequences`)
  }
  const sequences = raw.sqliteSequence as unknown[]
  for (const [index, expected] of OWNED_LEGACY_TABLES.entries()) {
    const sequence = sequences[index] as Record<string, unknown> | undefined
    if (sequence?.name !== expected) {
      fail(`approved sqliteSequence ${index} must be ${expected}`)
    }
    requireCount(sequence?.seq, `${expected}.seq`)
  }

  return raw as unknown as ApprovedSource
}

const contractPath = join(dirname(fileURLToPath(import.meta.url)), APPROVED_SOURCE_FILE)

export const approvedSourceJson = (): string => readFileSync(contractPath, 'utf8')

/** The one approved source. Operator commands never take another. */
export const APPROVED_SOURCE: ApprovedSource = validateApprovedSource(
  JSON.parse(approvedSourceJson()) as unknown)

export const approvedTable = (
  approved: ApprovedSource, name: OwnedLegacyTable,
): ApprovedTable => {
  const table = approved.tables.find((candidate) => candidate.name === name)
  if (!table) {
    throw new ApprovedSourceError(
      'APPROVED_SOURCE_INVALID', `the approved source does not describe ${name}`)
  }
  return table
}
