// The `hearth.sqlite-table-canonical.v1` table and product hashes.
//
// This is ShapePilot's own implementation of the published canonical format.
// The coordinator's `hash-sqlite-tables.mjs` stays outside this repository and
// remains the independent oracle: the approved hashes in
// `approved-source.json` were produced by that script against the immutable
// production backup, and this module has to arrive at the same values from
// completely different inputs — the rows actually carried by an export bundle
// plus the approved column metadata.
//
// The format, byte for byte:
//
//   sha256("hearth.sqlite-table-canonical.v1\0"
//          || T(table) || F(columnCount)
//          || for each column: T(name) T(declaredType)
//          || for each row in primary-key order: "R" || value*)
//
// where each value is a one-byte storage-class tag, a big-endian uint64 length
// and the payload: N (null, empty), I (integer, decimal text), F (float, JS
// `Number#toString`), T (utf-8 text), B (raw bytes).
import { createHash } from 'node:crypto'
import type { Hash } from 'node:crypto'
import type DatabaseConstructor from 'better-sqlite3'
import type { CanonicalRow, SqlValue, TaggedValue } from './canonical.ts'

export const TABLE_CANONICAL_ALGORITHM = 'hearth.sqlite-table-canonical.v1'
export const PRODUCT_CANONICAL_ALGORITHM = 'hearth.sqlite-product-canonical.v1'

export class CanonicalTableError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CanonicalTableError'
    this.code = code
  }
}

/** Column metadata as `PRAGMA table_info` reports it. */
export interface CanonicalColumn {
  name: string
  type: string
  notNull: boolean
  primaryKeyOrder: number
}

const writeLength = (hash: Hash, length: number): void => {
  const encoded = Buffer.alloc(8)
  encoded.writeBigUInt64BE(BigInt(length))
  hash.update(encoded)
}

const writeTagged = (hash: Hash, tag: string, payload: Buffer): void => {
  hash.update(tag)
  writeLength(hash, payload.length)
  if (payload.length > 0) hash.update(payload)
}

const writeText = (hash: Hash, value: string): void =>
  writeTagged(hash, 'T', Buffer.from(value, 'utf8'))

const writeNull = (hash: Hash): void => writeTagged(hash, 'N', Buffer.alloc(0))

const writeInteger = (hash: Hash, decimal: string): void =>
  writeTagged(hash, 'I', Buffer.from(decimal, 'utf8'))

/** The oracle encodes a JS number, including counts, with `Number#toString`. */
const writeFloat = (hash: Hash, value: number): void => writeTagged(
  hash,
  'F',
  Buffer.from(
    Number.isNaN(value)
      ? 'NaN'
      : Object.is(value, -0)
        ? '-0'
        : value === Infinity
          ? 'Infinity'
          : value === -Infinity
            ? '-Infinity'
            : value.toString(),
    'utf8',
  ),
)

/** Write a live driver value, matching the oracle's own type dispatch. */
function writeDriverValue(hash: Hash, value: unknown): void {
  if (value === null || value === undefined) return writeNull(hash)
  if (Buffer.isBuffer(value)) return writeTagged(hash, 'B', value)
  if (value instanceof Uint8Array) return writeTagged(hash, 'B', Buffer.from(value))
  if (typeof value === 'bigint') return writeInteger(hash, value.toString(10))
  if (typeof value === 'number') return writeFloat(hash, value)
  if (typeof value === 'string') return writeText(hash, value)
  throw new CanonicalTableError(
    'UNSUPPORTED_VALUE', `unsupported SQLite value type ${typeof value}`)
}

export type ColumnAffinity = 'INTEGER' | 'TEXT' | 'BLOB' | 'REAL' | 'NUMERIC'

/** SQLite's column affinity rules, applied to the declared type. */
export function affinityOf(declaredType: string): ColumnAffinity {
  const type = declaredType.toUpperCase()
  if (type.includes('INT')) return 'INTEGER'
  if (type.includes('CHAR') || type.includes('CLOB') || type.includes('TEXT')) return 'TEXT'
  if (type === '' || type.includes('BLOB')) return 'BLOB'
  if (type.includes('REAL') || type.includes('FLOA') || type.includes('DOUB')) return 'REAL'
  return 'NUMERIC'
}

/**
 * Encode one exported value, using the approved declared type to recover the
 * storage class the source column must have used.
 *
 * The tagged form carried by a bundle says "integer-valued" or "fractional",
 * not "INTEGER storage" or "FLOAT storage". Affinity closes that gap exactly:
 * a REAL column forces every numeric value to a float, an INTEGER column keeps
 * an integral value as an integer and a fractional one as a float, and a TEXT
 * column can only ever hold text, a blob or null. Anything that cannot be
 * placed with certainty is refused rather than guessed.
 */
function writeExportedValue(
  hash: Hash, column: CanonicalColumn, tagged: TaggedValue,
): void {
  const affinity = affinityOf(column.type)
  const mismatch = (found: string): never => {
    throw new CanonicalTableError(
      'STORAGE_CLASS_MISMATCH',
      `${column.name} is declared ${column.type || '(none)'} but carries a ${found} value`,
    )
  }

  switch (tagged[0]) {
    case 'n': return writeNull(hash)
    case 's':
      if (affinity === 'TEXT' || affinity === 'BLOB') return writeText(hash, tagged[1])
      return mismatch('text')
    case 'b':
      return writeTagged(hash, 'B', Buffer.from(tagged[1], 'base64'))
    case 'i':
      if (affinity === 'INTEGER') return writeInteger(hash, tagged[1])
      if (affinity === 'REAL') return writeFloat(hash, Number(tagged[1]))
      return mismatch('integer')
    case 'f':
      // An INTEGER-affinity column keeps a fractional value as a float.
      if (affinity === 'REAL' || affinity === 'INTEGER') return writeFloat(hash, tagged[1])
      return mismatch('float')
  }
}

const storageRank = (tagged: TaggedValue): number => {
  switch (tagged[0]) {
    case 'n': return 0
    case 'i':
    case 'f': return 1
    case 's': return 2
    case 'b': return 3
  }
}

/** SQLite's own value ordering: NULL < numbers < text < blob. */
function compareTagged(left: TaggedValue, right: TaggedValue): number {
  const leftRank = storageRank(left)
  const rightRank = storageRank(right)
  if (leftRank !== rightRank) return leftRank - rightRank
  switch (left[0]) {
    case 'n': return 0
    case 'i':
    case 'f': {
      const a = left[0] === 'i' ? Number(left[1]) : left[1]
      const b = right[0] === 'i' ? Number(right[1]) : (right[1] as number)
      return a === b ? 0 : a < b ? -1 : 1
    }
    case 's':
      return Buffer.compare(
        Buffer.from(left[1], 'utf8'), Buffer.from(right[1] as string, 'utf8'))
    case 'b':
      return Buffer.compare(
        Buffer.from(left[1], 'base64'), Buffer.from(right[1] as string, 'base64'))
  }
}

const writeHeader = (hash: Hash, table: string, columns: readonly CanonicalColumn[]): void => {
  hash.update(`${TABLE_CANONICAL_ALGORITHM}\u0000`)
  writeText(hash, table)
  writeFloat(hash, columns.length)
  for (const column of columns) {
    writeText(hash, column.name)
    writeText(hash, column.type)
  }
}

export const primaryKeyColumns = (columns: readonly CanonicalColumn[]): CanonicalColumn[] =>
  columns.filter((column) => column.primaryKeyOrder > 0)
    .sort((left, right) => left.primaryKeyOrder - right.primaryKeyOrder)

/**
 * Recompute a table hash from the rows an export bundle actually carries and
 * the approved column metadata. Nothing self-declared by the bundle is trusted:
 * the caller supplies the columns, and the rows come from the export.
 */
export function canonicalTableHashFromRows(
  table: string,
  columns: readonly CanonicalColumn[],
  rows: readonly CanonicalRow[],
): string {
  if (columns.length === 0) {
    throw new CanonicalTableError('COLUMNS_REQUIRED', `${table} has no approved columns`)
  }
  for (const row of rows) {
    if (row.length !== columns.length) {
      throw new CanonicalTableError(
        'ROW_ARITY_MISMATCH',
        `${table} has a row with ${row.length} values but ${columns.length} approved columns`,
      )
    }
  }

  const keyIndexes = primaryKeyColumns(columns)
    .map((column) => columns.findIndex((candidate) => candidate.name === column.name))
  if (keyIndexes.length === 0) {
    throw new CanonicalTableError(
      'PRIMARY_KEY_REQUIRED',
      `${table} has no declared primary key, so a canonical row order cannot be recovered`,
    )
  }

  const ordered = [...rows].sort((left, right) => {
    for (const index of keyIndexes) {
      const difference = compareTagged(left[index], right[index])
      if (difference !== 0) return difference
    }
    return 0
  })

  const hash = createHash('sha256')
  writeHeader(hash, table, columns)
  for (const row of ordered) {
    hash.update('R')
    columns.forEach((column, index) => writeExportedValue(hash, column, row[index]))
  }
  return hash.digest('hex')
}

const quote = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`

/** Column metadata straight out of a database, in declaration order. */
export function readCanonicalColumns(
  handle: DatabaseConstructor.Database, table: string,
): CanonicalColumn[] {
  const columns = (handle.prepare(`PRAGMA table_info(${quote(table)})`).all() as {
    cid: number | bigint; name: string; type: string | null
    notnull: number | bigint; pk: number | bigint
  }[])
    .sort((left, right) => Number(left.cid) - Number(right.cid))
    .map((column) => ({
      name: String(column.name),
      type: String(column.type ?? ''),
      notNull: Number(column.notnull) === 1,
      primaryKeyOrder: Number(column.pk),
    }))
  if (columns.length === 0) {
    throw new CanonicalTableError('TABLE_MISSING', `${table} does not exist in this database`)
  }
  return columns
}

/**
 * The same hash, computed straight from a database. This is the path a
 * verification tool takes against a snapshot; it shares only the low-level
 * encoder with the bundle path, so the two agreeing is a real cross-check.
 */
export function canonicalTableHashFromDatabase(
  handle: DatabaseConstructor.Database, table: string,
): { hash: string; rowCount: number; columns: CanonicalColumn[] } {
  const columns = readCanonicalColumns(handle, table)
  const keys = primaryKeyColumns(columns)
  const orderBy = keys.length > 0 ? keys.map((c) => quote(c.name)).join(', ') : 'rowid'

  const hash = createHash('sha256')
  writeHeader(hash, table, columns)

  const statement = handle.prepare(
    `SELECT ${columns.map((c) => quote(c.name)).join(', ')} FROM ${quote(table)} ORDER BY ${orderBy}`,
  )
  // Integers as BigInt: that is what makes the INTEGER/FLOAT storage classes
  // distinguishable in the driver, exactly as the oracle reads them.
  statement.safeIntegers(true)

  let rowCount = 0
  for (const row of statement.iterate() as Iterable<Record<string, SqlValue>>) {
    hash.update('R')
    for (const column of columns) writeDriverValue(hash, row[column.name])
    rowCount += 1
  }

  return { hash: hash.digest('hex'), rowCount, columns }
}

export interface ProductTableHash {
  name: string
  canonicalSha256: string
  rowCount: number
}

/** `hearth.sqlite-product-canonical.v1`: the product roll-up, tables sorted by name. */
export function productCanonicalHash(
  product: string, tables: readonly ProductTableHash[],
): string {
  const hash = createHash('sha256')
  hash.update(`${PRODUCT_CANONICAL_ALGORITHM}\u0000`)
  writeText(hash, product)
  // Plain code-unit order, which is what `Array#sort()` on the table names
  // gives; a locale-aware comparison would reorder underscores.
  const sorted = [...tables].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
  for (const table of sorted) {
    writeText(hash, table.name)
    writeText(hash, table.canonicalSha256)
    writeFloat(hash, table.rowCount)
  }
  return hash.digest('hex')
}
