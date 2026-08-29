import { createHash } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { openExistingCompatibleDatabase, openDatabase } from '../lib/db/connection.ts'
import type { AppDatabase } from '../lib/db/connection.ts'
import { readAuthorityId } from '../lib/db/identity.ts'
import type { BuildIdentity } from '../lib/lineage/buildIdentity.ts'
import type { AppConfig } from './config.ts'

const MAX_EMPTY_DATABASE_BYTES = 16 * 1024 * 1024
export const EMPTY_SEED_DOMAIN_TABLES = [
  'app_memberships',
  'app_settings',
  'audit_events',
  'keycap_pocket_library',
  'keycap_tray_designs',
  'keycap_tray_pockets',
  'legacy_import_rows',
  'legacy_import_runs',
] as const

interface ExpectedOwner {
  uid: number
  gid: number
}

interface EmptySeedMarker {
  format: 'shapepilot-empty-seed-v1'
  databasePath: string
  databaseSha256: string
  authorityId: string
  schemaIdentity: string
  sourceSha: string
  buildId: string
  builtAt: string
}

export class EmptySeedError extends Error {
  readonly code: string
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'EmptySeedError'
    this.code = code
  }
}

const sha256File = (path: string): string => {
  const stats = lstatSync(path)
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_EMPTY_DATABASE_BYTES) {
    throw new EmptySeedError(
      'EMPTY_SEED_INVALID',
      'the empty seed database is not a bounded regular file',
    )
  }
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

const assertOwnedPrivateFile = (
  path: string,
  owner: ExpectedOwner,
  description: string,
): void => {
  const stats = lstatSync(path)
  if (!stats.isFile()
    || stats.isSymbolicLink()
    || stats.uid !== owner.uid
    || stats.gid !== owner.gid
    || (stats.mode & 0o777) !== 0o600) {
    throw new EmptySeedError(
      'EMPTY_SEED_PERMISSIONS',
      `${description} must be a UID/GID ${owner.uid}:${owner.gid} mode 0600 regular file`,
    )
  }
}

const assertNoSidecars = (databasePath: string): void => {
  for (const suffix of ['-journal', '-wal', '-shm']) {
    if (existsSync(`${databasePath}${suffix}`)) {
      throw new EmptySeedError(
        'EMPTY_SEED_SIDECAR',
        `empty seed refuses an existing SQLite ${suffix.slice(1)} sidecar`,
      )
    }
  }
}

const assertZeroDomainRows = (database: AppDatabase): void => {
  for (const table of EMPTY_SEED_DOMAIN_TABLES) {
    const row = database.handle
      .prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
      .get()
    if (row?.count !== 0) {
      throw new EmptySeedError(
        'EMPTY_SEED_NOT_EMPTY',
        `empty seed contains domain rows in ${table}`,
      )
    }
  }
}

const markerFor = (
  config: AppConfig,
  identity: BuildIdentity,
  authorityId: string,
  schemaIdentity: string,
): EmptySeedMarker => ({
  format: 'shapepilot-empty-seed-v1',
  databasePath: config.database.path,
  databaseSha256: sha256File(config.database.path),
  authorityId,
  schemaIdentity,
  sourceSha: identity.commit,
  buildId: identity.build,
  builtAt: identity.builtAt,
})

const readMarker = (path: string, owner: ExpectedOwner): EmptySeedMarker => {
  assertOwnedPrivateFile(path, owner, 'empty seed marker')
  const stats = statSync(path)
  if (stats.size <= 0 || stats.size > 4096) {
    throw new EmptySeedError('EMPTY_SEED_INVALID', 'empty seed marker has an invalid size')
  }
  let parsed: Partial<EmptySeedMarker>
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<EmptySeedMarker>
  } catch (cause) {
    throw new EmptySeedError(
      'EMPTY_SEED_INVALID',
      'empty seed marker is not valid JSON',
      { cause },
    )
  }
  if (parsed.format !== 'shapepilot-empty-seed-v1'
    || typeof parsed.databasePath !== 'string'
    || !/^[0-9a-f]{64}$/.test(parsed.databaseSha256 ?? '')
    || !/^[0-9a-f]{32}$/.test(parsed.authorityId ?? '')
    || typeof parsed.schemaIdentity !== 'string'
    || !/^[0-9a-f]{40}$/.test(parsed.sourceSha ?? '')
    || !/^[0-9]+-[0-9]+$/.test(parsed.buildId ?? '')
    || typeof parsed.builtAt !== 'string') {
    throw new EmptySeedError('EMPTY_SEED_INVALID', 'empty seed marker is malformed')
  }
  return parsed as EmptySeedMarker
}

const syncDirectory = (path: string): void => {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY)
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

const syncFile = (path: string): void => {
  const descriptor = openSync(path, 'r')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

const publishMarker = (path: string, marker: EmptySeedMarker): void => {
  // Exclusive creation is the durable state transition. A crash can leave a
  // malformed marker, but that state fails closed and can never recreate or
  // overwrite the already-published database.
  const descriptor = openSync(path, 'wx', 0o600)
  try {
    writeFileSync(descriptor, `${JSON.stringify(marker)}\n`)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  try {
    syncDirectory(dirname(path))
  } catch (cause) {
    throw new EmptySeedError(
      'EMPTY_SEED_DURABILITY',
      'empty seed marker directory could not be synchronized',
      { cause },
    )
  }
}

function verifyExistingSeed(
  config: AppConfig,
  identity: BuildIdentity,
  owner: ExpectedOwner,
): void {
  const marker = readMarker(config.database.emptySeedMarkerPath, owner)
  if (marker.databasePath !== config.database.path
    || marker.sourceSha !== identity.commit
    || marker.buildId !== identity.build
    || marker.builtAt !== identity.builtAt) {
    throw new EmptySeedError(
      'EMPTY_SEED_IDENTITY_MISMATCH',
      'empty seed marker belongs to a different database or immutable build',
    )
  }
  assertOwnedPrivateFile(config.database.path, owner, 'empty seed database')
  assertNoSidecars(config.database.path)
  const database = openExistingCompatibleDatabase({
    path: config.database.path,
    busyTimeoutMs: config.database.busyTimeoutMs,
  })
  try {
    assertZeroDomainRows(database)
    if (marker.authorityId !== readAuthorityId(database.handle)
      || marker.schemaIdentity !== database.identity.schemaMarker
      || marker.databaseSha256 !== sha256File(config.database.path)) {
      throw new EmptySeedError(
        'EMPTY_SEED_IDENTITY_MISMATCH',
        'empty seed database no longer matches its hash-pinned marker',
      )
    }
  } finally {
    database.close()
  }
}

export function ensureProductionEmptySeed(
  config: AppConfig,
  identity: BuildIdentity,
  expectedOwner: ExpectedOwner = { uid: 1000, gid: 1000 },
): void {
  if (!config.database.initializeEmptySeed) return

  const databaseExists = existsSync(config.database.path)
  const markerExists = existsSync(config.database.emptySeedMarkerPath)
  if (databaseExists !== markerExists) {
    throw new EmptySeedError(
      'EMPTY_SEED_INCOMPLETE',
      'database and empty seed marker must either both exist or both be absent',
    )
  }
  if (databaseExists) {
    verifyExistingSeed(config, identity, expectedOwner)
    return
  }

  assertNoSidecars(config.database.path)
  const previousUmask = process.umask(0o077)
  let authorityId: string
  let schemaIdentity: string
  try {
    const database = openDatabase({
      path: config.database.path,
      busyTimeoutMs: config.database.busyTimeoutMs,
      createIfMissing: true,
    })
    try {
      assertZeroDomainRows(database)
      chmodSync(config.database.path, 0o600)
      assertOwnedPrivateFile(config.database.path, expectedOwner, 'empty seed database')
      authorityId = readAuthorityId(database.handle)
      schemaIdentity = database.identity.schemaMarker
    } finally {
      database.close()
    }
  } finally {
    process.umask(previousUmask)
  }
  assertNoSidecars(config.database.path)
  syncFile(config.database.path)
  syncDirectory(dirname(config.database.path))
  const marker = markerFor(config, identity, authorityId, schemaIdentity)
  publishMarker(config.database.emptySeedMarkerPath, marker)
  assertOwnedPrivateFile(
    config.database.emptySeedMarkerPath,
    expectedOwner,
    'empty seed marker',
  )
}
