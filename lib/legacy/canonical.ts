// Canonical row form.
//
// Export, import and reconciliation all hash rows through this module, so a
// "same row" judgement is one definition rather than three. The encoding is
// type-tagged: the integer 1, the float 1.0 and the string "1" are three
// different values and must never collide.
import { createHash } from 'node:crypto'
import type { OwnedLegacyTable } from '../db/schema.ts'

export type SqlValue = number | string | bigint | Uint8Array | null

/**
 * The pinned Hearth column list, in the pinned declaration order. This is the
 * projection that must match between the legacy source and the ShapePilot
 * target; ShapePilot's added owner columns are verified separately.
 */
export const LEGACY_COLUMNS: Record<OwnedLegacyTable, readonly string[]> = {
  keycap_tray_designs: [
    'id', 'name', 'notes', 'profile_kind', 'profile_json', 'sizing_json',
    'floor_mm', 'depth_mm', 'engrave_mm', 'created_at', 'updated_at',
  ],
  keycap_tray_pockets: [
    'id', 'design_id', 'units', 'height_units', 'x_mm', 'y_mm', 'rotation_deg',
    'is_through', 'label', 'label_mode', 'depth_mm', 'width_mm', 'height_mm',
    'corner_mm', 'sort_order', 'mirror_x', 'shape',
  ],
  keycap_pocket_library: [
    'id', 'name', 'units', 'width_mm', 'height_mm', 'corner_mm', 'notes', 'created_at',
  ],
}

/** Primary key column per owned table. */
export const PRIMARY_KEY: Record<OwnedLegacyTable, string> = {
  keycap_tray_designs: 'id',
  keycap_tray_pockets: 'id',
  keycap_pocket_library: 'id',
}

/**
 * The business key that must stay unique after owner scoping. Designs have no
 * natural business key beyond their id; the library is unique by name.
 */
export const BUSINESS_KEY: Partial<Record<OwnedLegacyTable, readonly string[]>> = {
  keycap_pocket_library: ['name'],
}

export type TaggedValue =
  | ['n']
  | ['i', string]
  | ['f', number]
  | ['s', string]
  | ['b', string]

export class CanonicalError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CanonicalError'
    this.code = code
  }
}

/**
 * Tag one SQLite value.
 *
 * Integers are carried as decimal strings so a value beyond 2^53 survives JSON
 * without silently rounding. Floats keep their JSON number form, which is
 * round-trip exact for IEEE-754 doubles.
 */
export function tagValue(value: SqlValue): TaggedValue {
  if (value === null || value === undefined) return ['n']
  if (typeof value === 'bigint') return ['i', value.toString()]
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CanonicalError('NON_FINITE_VALUE', 'non-finite numeric value cannot be canonicalized')
    }
    return Number.isInteger(value) ? ['i', value.toString()] : ['f', value]
  }
  if (typeof value === 'string') return ['s', value]
  if (value instanceof Uint8Array) return ['b', Buffer.from(value).toString('base64')]
  throw new CanonicalError('UNSUPPORTED_VALUE', `unsupported SQLite value type ${typeof value}`)
}

export const untagValue = (tagged: TaggedValue): SqlValue => {
  switch (tagged[0]) {
    case 'n': return null
    case 'i': {
      const asNumber = Number(tagged[1])
      if (!Number.isSafeInteger(asNumber)) return BigInt(tagged[1])
      return asNumber
    }
    case 'f': return tagged[1]
    case 's': return tagged[1]
    case 'b': return Buffer.from(tagged[1], 'base64')
  }
}

export type CanonicalRow = TaggedValue[]

/** Project a driver row onto the pinned column list, in the pinned order. */
export function canonicalRow(
  table: OwnedLegacyTable,
  row: Record<string, SqlValue>,
): CanonicalRow {
  return LEGACY_COLUMNS[table].map((column) => {
    if (!(column in row)) {
      throw new CanonicalError('COLUMN_MISSING', `${table}.${column} is missing from the source row`)
    }
    return tagValue(row[column])
  })
}

/** Stable JSON: object keys sorted, arrays kept in order, two-space indent. */
export function serializeCanonical(value: unknown): string {
  const stable = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(stable)
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.keys(input as Record<string, unknown>)
          .sort()
          .map((key) => [key, stable((input as Record<string, unknown>)[key])]),
      )
    }
    return input
  }
  return `${JSON.stringify(stable(value), null, 2)}\n`
}

export const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex')

/** Hash of one canonical row, bound to its table so tables cannot alias. */
export const rowHash = (table: OwnedLegacyTable, row: CanonicalRow): string =>
  sha256(serializeCanonical({ table, row }))

/** Order-independent hash of a whole table: the sorted row hashes. */
export const rowsHash = (table: OwnedLegacyTable, rows: CanonicalRow[]): string =>
  sha256(serializeCanonical({ table, rows: rows.map((r) => rowHash(table, r)).sort() }))

export const rowValue = (row: CanonicalRow, table: OwnedLegacyTable, column: string): SqlValue => {
  const index = LEGACY_COLUMNS[table].indexOf(column)
  if (index < 0) throw new CanonicalError('COLUMN_UNKNOWN', `${table} has no column ${column}`)
  return untagValue(row[index])
}

export const rowId = (row: CanonicalRow, table: OwnedLegacyTable): number => {
  const value = rowValue(row, table, PRIMARY_KEY[table])
  const id = typeof value === 'bigint' ? Number(value) : value
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) {
    throw new CanonicalError('PRIMARY_KEY_INVALID', `${table} primary key is not a safe integer`)
  }
  return id
}
