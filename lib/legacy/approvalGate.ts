// The approval gate.
//
// Nothing may be written into ShapePilot from a legacy bundle that is not the
// one approved bundle. Every check here runs before a transaction is opened,
// against the bundle's *content* rather than its claims:
//
//   * source identity — repository, commit, tree, version, build, image digest,
//     backup bundle id and creation time, source database bytes and sha256
//   * exact owned row counts, and that the rows array agrees with the count
//   * exact source schema identity per table: the CREATE statement hash and the
//     complete declared column list, in order, with types, nullability and
//     primary-key position
//   * per-table canonical hashes, recomputed from the exported rows and the
//     approved column metadata, compared against both the approved value and
//     the bundle's self-declared value
//   * the product hash, recomputed from those recomputed table hashes
//
// The coordinator's `hash-sqlite-tables.mjs` is not used and not vendored: it
// stays outside the repository as the independent oracle that produced the
// approved values in the first place.
import { OWNED_LEGACY_TABLES } from '../db/schema.ts'
import type { ApprovedSource, ApprovedTable } from './approvedSource.ts'
import { APPROVED_SOURCE, approvedTable } from './approvedSource.ts'
import { canonicalTableHashFromRows, productCanonicalHash } from './canonicalTable.ts'
import type { CanonicalColumn } from './canonicalTable.ts'
import type { ExportBundle, ExportedTable } from './manifest.ts'
import { LegacyError } from './manifest.ts'

const reject = (message: string): never => {
  throw new LegacyError('SOURCE_NOT_APPROVED', message)
}

const sameColumns = (
  approved: readonly CanonicalColumn[], declared: readonly CanonicalColumn[],
): boolean =>
  approved.length === declared.length
  && approved.every((column, index) =>
    column.name === declared[index]?.name
    && column.type === declared[index]?.type
    && column.notNull === declared[index]?.notNull
    && column.primaryKeyOrder === declared[index]?.primaryKeyOrder)

function assertSourceIdentity(bundle: ExportBundle, approved: ApprovedSource): void {
  const checks: [string, unknown, unknown][] = [
    ['repository', bundle.source.repository, approved.source.repository],
    ['commit', bundle.source.commit, approved.source.commit],
    ['tree', bundle.source.tree, approved.source.tree],
    ['version', bundle.source.version, approved.source.version],
    ['build', bundle.source.build, approved.source.build],
    ['imageDigest', bundle.source.imageDigest, approved.source.imageDigest],
    ['backupBundle', bundle.source.backupBundle, approved.source.backupBundle],
    ['backupCreatedUtc', bundle.source.backupCreatedUtc, approved.source.backupCreatedUtc],
    ['bytes', bundle.source.bytes, approved.source.bytes],
    ['sha256', bundle.source.sha256, approved.source.sha256],
  ]
  for (const [field, actual, expected] of checks) {
    if (actual !== expected) {
      reject(
        `source.${field} is ${JSON.stringify(actual)}; the approved ShapePilot source `
        + `requires ${JSON.stringify(expected)}`,
      )
    }
  }
}

function assertTableSchema(table: ExportedTable, approved: ApprovedTable, bundle: ExportBundle): void {
  if (table.rowCount !== approved.rowCount || table.rows.length !== approved.rowCount) {
    reject(
      `${table.name} carries ${table.rows.length} rows; the approved source has `
      + `exactly ${approved.rowCount}`,
    )
  }
  if (table.schema.createSqlSha256 !== approved.createSqlSha256) {
    reject(`${table.name} source schema identity does not match the approved CREATE statement`)
  }
  if (bundle.sourceSchema?.[table.name] !== approved.createSqlSha256) {
    reject(`${table.name} sourceSchema entry does not match the approved CREATE statement`)
  }
  if (!sameColumns(approved.columns, table.schema.columns)) {
    reject(`${table.name} declared column list does not match the approved source schema`)
  }
  if (table.schema.primaryKey.join(',') !== approved.primaryKey.join(',')) {
    reject(`${table.name} primary key does not match the approved source schema`)
  }
}

export interface ApprovalResult {
  product: string
  productCanonicalSha256: string
  tables: { name: string; canonicalSha256: string; rowCount: number }[]
}

/**
 * Prove a bundle is the approved source. Throws `SOURCE_NOT_APPROVED` on any
 * difference; returns the recomputed hashes when it passes.
 */
export function assertApprovedSource(
  bundle: ExportBundle, approved: ApprovedSource = APPROVED_SOURCE,
): ApprovalResult {
  if (approved.app !== 'shapepilot' || bundle.app !== 'shapepilot') {
    reject('the bundle and the approved source must both be ShapePilot artifacts')
  }
  if (bundle.canonical.product !== approved.product) {
    reject(
      `the bundle declares product "${bundle.canonical.product}"; the approved source `
      + `is "${approved.product}"`,
    )
  }
  if (bundle.canonical.tableAlgorithm !== approved.canonical.tableAlgorithm
    || bundle.canonical.productAlgorithm !== approved.canonical.productAlgorithm) {
    reject('the bundle uses a different canonical hash algorithm than the approved source')
  }

  assertSourceIdentity(bundle, approved)

  for (const [index, expected] of approved.sqliteSequence.entries()) {
    const actual = bundle.sqliteSequence[index]
    if (actual?.name !== expected.name || actual.seq !== expected.seq) {
      reject(
        `${expected.name} sqlite_sequence is ${JSON.stringify(actual)}; the approved source `
        + `requires ${JSON.stringify(expected)}`,
      )
    }
  }

  const recomputed: ApprovalResult['tables'] = []
  for (const name of OWNED_LEGACY_TABLES) {
    const table = bundle.tables.find((candidate) => candidate.name === name)
    if (!table) reject(`${name} is missing from the bundle`)
    const expected = approvedTable(approved, name)
    assertTableSchema(table as ExportedTable, expected, bundle)

    // Recomputed from the rows the bundle actually carries, using the approved
    // column metadata — not the column metadata the bundle declares.
    const hash = canonicalTableHashFromRows(
      name, expected.columns, (table as ExportedTable).rows)

    if (hash !== expected.canonicalSha256) {
      reject(
        `${name} canonical hash recomputed from the exported rows is ${hash}; the approved `
        + `source requires ${expected.canonicalSha256}`,
      )
    }
    if ((table as ExportedTable).canonicalSha256 !== hash) {
      reject(`${name} declares a canonical hash that its own rows do not produce`)
    }
    recomputed.push({ name, canonicalSha256: hash, rowCount: expected.rowCount })
  }

  const productHash = productCanonicalHash(approved.product, recomputed)
  if (productHash !== approved.canonical.productCanonicalSha256) {
    reject(
      `the product canonical hash recomputed from the exported rows is ${productHash}; the `
      + `approved source requires ${approved.canonical.productCanonicalSha256}`,
    )
  }
  if (bundle.canonical.productCanonicalSha256 !== productHash) {
    reject('the bundle declares a product hash that its own rows do not produce')
  }

  return {
    product: approved.product,
    productCanonicalSha256: productHash,
    tables: recomputed,
  }
}
