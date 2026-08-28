// Backup manifest contract.
//
// Modelled on the pinned Hearth `hearth.sqlite-backup-manifest.v1` so an
// operator reads the same fields in both systems, but app-scoped: the contract
// name, the app field and the file name are ShapePilot's own.
//
// v2 replaces the code-derived schema identity with an identity derived from
// the snapshot itself: the app marker stored in the database, the schema-format
// marker, and the complete ordered migration ledger with each entry's ordinal,
// id, name and checksum. Two databases whose head migration id is the same but
// whose earlier history differs produce different manifests, and every later
// stage — read-back, disposable restore, restore-before-promotion — re-derives
// the same identity from the bytes in front of it and compares.
import { createHash } from 'node:crypto'
import type { DatabaseIdentity, LedgerEntry } from '../db/identity.ts'
import { schemaMarkerOf } from '../db/identity.ts'

export const BACKUP_FORMAT = 'shapepilot-sqlite-backup-v2'
export const BACKUP_MANIFEST_CONTRACT = 'shapepilot.sqlite-backup-manifest.v2'
export const BACKUP_MANIFEST_VERSION = 2
export const BACKUP_DATABASE_FILE = 'shapepilot.sqlite3'
export const BACKUP_MANIFEST_FILE = 'manifest.json'

export interface CheckResult { ok: boolean; messages: string[] }
export interface ForeignKeyCheck {
  ok: boolean
  violations: { table: string; rowid: number | null; parent: string; foreignKeyIndex: number }[]
}

export interface TableSnapshot {
  name: string
  rowCount: number
  recency?: { column: string; raw: string | number; utc: string }
}

export interface BackupDatabase {
  format: typeof BACKUP_FORMAT
  file: typeof BACKUP_DATABASE_FILE
  sourcePath: string
  sha256: string
  bytes: number
  /** All five fields below are read out of the snapshot, never from code. */
  appMarker: string
  authorityId: string
  schemaFormat: string
  schemaMarker: string
  schemaObjectsSha256: string
  migrationLedger: LedgerEntry[]
  headMigration: string
  schemaObjectCount: number
  schemaObjectCounts: { index: number; table: number; trigger: number; view: number }
  tables: TableSnapshot[]
  checks: { quickCheck: CheckResult; integrityCheck: CheckResult; foreignKeyCheck: ForeignKeyCheck }
}

export interface BackupManifest {
  contract: typeof BACKUP_MANIFEST_CONTRACT
  contractVersion: number
  app: 'shapepilot'
  appVersion: string
  buildId: string
  sourceCommit: string
  sourceCreatedUtc: string
  database: BackupDatabase
}

export class RecoveryError extends Error {
  readonly code: string
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RecoveryError'
    this.code = code
  }
}

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>).sort()
        .map((key) => [key, stable((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

export const serializeManifest = (manifest: BackupManifest): string =>
  `${JSON.stringify(stable(manifest), null, 2)}\n`

export const manifestHash = (manifest: BackupManifest): string =>
  createHash('sha256').update(serializeManifest(manifest)).digest('hex')

const HEX64 = /^[0-9a-f]{64}$/
const HEX32 = /^[0-9a-f]{32}$/

export function assertIsoUtc(value: unknown, label: string): string {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new RecoveryError('MANIFEST_INVALID', `${label} must be an ISO-8601 UTC timestamp`)
  }
  return value as string
}

/** The identity a manifest asserts, in the same shape a database reports. */
export const manifestIdentity = (manifest: BackupManifest): DatabaseIdentity => ({
  app: manifest.database.appMarker,
  schemaFormat: manifest.database.schemaFormat,
  schemaMarker: manifest.database.schemaMarker,
  schemaObjectsSha256: manifest.database.schemaObjectsSha256,
  headMigration: manifest.database.headMigration,
  ledger: manifest.database.migrationLedger,
})

/**
 * Validate the identity block. The schema marker is *recomputed* from the
 * ledger the manifest carries, so a manifest cannot claim a marker its own
 * ledger does not produce.
 */
function validateIdentity(database: BackupDatabase): void {
  if (typeof database.appMarker !== 'string' || database.appMarker.trim() === '') {
    throw new RecoveryError('MANIFEST_INVALID', 'database.appMarker is required')
  }
  if (!HEX32.test(String(database.authorityId))) {
    throw new RecoveryError(
      'MANIFEST_INVALID', 'database.authorityId must be 32 lowercase hex characters')
  }
  if (typeof database.schemaFormat !== 'string' || database.schemaFormat.trim() === '') {
    throw new RecoveryError('MANIFEST_INVALID', 'database.schemaFormat is required')
  }
  if (!HEX64.test(String(database.schemaMarker))) {
    throw new RecoveryError('MANIFEST_INVALID', 'database.schemaMarker must be 64 lowercase hex characters')
  }
  if (!HEX64.test(String(database.schemaObjectsSha256))) {
    throw new RecoveryError(
      'MANIFEST_INVALID', 'database.schemaObjectsSha256 must be 64 lowercase hex characters')
  }
  const ledger = database.migrationLedger
  if (!Array.isArray(ledger) || ledger.length === 0) {
    throw new RecoveryError('MANIFEST_INVALID', 'database.migrationLedger must be a non-empty array')
  }
  ledger.forEach((entry, index) => {
    if (!entry || typeof entry.id !== 'string' || entry.id.trim() === ''
      || typeof entry.name !== 'string'
      || !HEX64.test(String(entry.checksum))
      || entry.ordinal !== index) {
      throw new RecoveryError(
        'MANIFEST_INVALID',
        `database.migrationLedger entry ${index} is malformed or out of order`,
      )
    }
  })
  if (database.headMigration !== ledger.at(-1)?.id) {
    throw new RecoveryError(
      'MANIFEST_INVALID', 'database.headMigration does not match the end of the ledger')
  }
  if (schemaMarkerOf(ledger) !== database.schemaMarker) {
    throw new RecoveryError(
      'MANIFEST_SCHEMA_MARKER_MISMATCH',
      'database.schemaMarker is not the marker of the ledger the manifest carries',
    )
  }
}

export function validateBackupManifest(value: unknown): BackupManifest {
  const raw = (value ?? {}) as Record<string, unknown>
  if (raw.contract !== BACKUP_MANIFEST_CONTRACT) {
    throw new RecoveryError('MANIFEST_INVALID', `contract must be ${BACKUP_MANIFEST_CONTRACT}`)
  }
  if (raw.contractVersion !== BACKUP_MANIFEST_VERSION) {
    throw new RecoveryError('MANIFEST_INVALID', 'unsupported manifest contract version')
  }
  if (raw.app !== 'shapepilot') {
    throw new RecoveryError('MANIFEST_INVALID', 'manifest does not belong to ShapePilot')
  }
  assertIsoUtc(raw.sourceCreatedUtc, 'sourceCreatedUtc')

  const database = raw.database as BackupDatabase | undefined
  if (!database || database.format !== BACKUP_FORMAT || database.file !== BACKUP_DATABASE_FILE) {
    throw new RecoveryError('MANIFEST_INVALID', 'manifest database block is missing or malformed')
  }
  if (!HEX64.test(String(database.sha256))) {
    throw new RecoveryError('MANIFEST_INVALID', 'database.sha256 must be 64 lowercase hex characters')
  }
  if (!Number.isSafeInteger(database.bytes) || database.bytes <= 0) {
    throw new RecoveryError('MANIFEST_INVALID', 'database.bytes must be a positive integer')
  }
  if (!database.checks?.quickCheck?.ok || !database.checks?.integrityCheck?.ok
    || !database.checks?.foreignKeyCheck?.ok) {
    throw new RecoveryError('MANIFEST_CHECKS_FAILED', 'manifest records a failed database check')
  }
  validateIdentity(database)
  return raw as unknown as BackupManifest
}

/** `20260828T053625317Z-<16 hex>` — sortable and content-addressed. */
export function artifactIdFor(sourceCreatedUtc: string, manifest: BackupManifest): string {
  assertIsoUtc(sourceCreatedUtc, 'sourceCreatedUtc')
  return `${sourceCreatedUtc.replace(/[-:.]/g, '')}-${manifestHash(manifest).slice(0, 16)}`
}
