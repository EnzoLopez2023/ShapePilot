// The snapshot taken immediately before a release changes the schema.
//
// Why this is on the startup path, when nothing else recoverable is: it is the
// only place the snapshot can be *correct*. A migration applies exactly once,
// inside `openDatabase` → `migrate`, in the process that just started with the
// new image. Anywhere earlier (a CI job, an operator's SSH session) is a step
// someone has to remember, and the record in docs/DEPLOYMENT.md shows what that
// produces: `006`, `007`, `009` and `010` all shipped with no snapshot at all.
// Here it cannot be forgotten, because the migration cannot happen without it.
//
// The work is bounded and rare, which is what makes it acceptable next to the
// rest of bootstrap: it runs only when the ledger is actually short, so it
// happens once per migration ever, not once per start. On a database of a few
// hundred kilobytes the copy and its checks are single-digit milliseconds.
//
// The database being copied is one release behind the code copying it -- that
// is the entire point -- so the usual exact-identity check cannot apply. See
// `assertLedgerPrefix` in lib/db/identity.ts for what replaces it.
import { existsSync } from 'node:fs'
import { codeLedger, migrationChecksum, MIGRATIONS } from '../db/migrate.ts'
import type { Migration } from '../db/migrate.ts'
import { openReadOnlyDatabase } from '../db/readonly.ts'
import type { LedgerEntry } from '../db/identity.ts'
import type { ArtifactStore } from './artifactStore.ts'
import { createBackup } from './backup.ts'
import { RecoveryError } from './manifest.ts'

export interface PendingMigrationReport {
  /** Migrations in this build that the database has not applied, in order. */
  pending: string[]
  /** What the database has applied. Empty for a database with no ledger yet. */
  applied: LedgerEntry[]
}

/**
 * Which migrations this build would apply, read without touching the file.
 *
 * Divergence is *not* diagnosed here. `migrate` already reports it precisely
 * (`MIGRATION_LEDGER_DIVERGED`, `MIGRATION_CHECKSUM_MISMATCH`,
 * `SCHEMA_AHEAD_OF_CODE`), and duplicating those messages a few milliseconds
 * earlier would only give two voices to one failure. What this does is refuse
 * to *take a snapshot* of a database it cannot recognise, and let the real
 * check produce the error.
 */
export function pendingMigrations(
  databasePath: string, migrations: readonly Migration[] = MIGRATIONS,
): PendingMigrationReport {
  // `requireCompatibleIdentity: false` is the point: the database is a release
  // behind, so the compatible-identity assertion would refuse it by design.
  const database = openReadOnlyDatabase({
    path: databasePath, requireCompatibleIdentity: false,
  })
  try {
    const applied = database.identity.ledger
    const code = codeLedger(migrations)
    // A prefix, or nothing. Anything else is divergence, and `migrate` says so.
    const isPrefix = applied.length <= code.length
      && applied.every((entry, index) =>
        entry.id === code[index].id
        && entry.ordinal === code[index].ordinal
        && entry.checksum === code[index].checksum)
    if (!isPrefix) return { pending: [], applied }
    return { pending: code.slice(applied.length).map(entry => entry.id), applied }
  } finally {
    database.close()
  }
}

export interface PreMigrationSnapshotOptions {
  databasePath: string
  /**
   * Opens the artifact store, or null when none is configured.
   *
   * A thunk rather than a store, for two reasons. A start with nothing pending
   * never touches the store at all, so a misconfigured BACKUP_ROOT cannot break
   * an ordinary restart -- only a migrating one, which is exactly when it
   * matters. And when it does fail, it fails *inside* this function, so the
   * operator gets "refusing to change the schema" rather than a bare store
   * error with no hint of what it stopped.
   */
  openStore: (() => ArtifactStore) | null
  appVersion: string
  buildId: string
  sourceCommit: string
  workRoot?: string
  migrations?: readonly Migration[]
  /** Test seam, passed through to `createBackup`. See its own note. */
  freeSpaceProbe?: (path: string) => number | null
  /**
   * Production. A pending migration with no usable store is a hard failure
   * rather than a warning: a snapshot you might not have is worth nothing, and
   * refusing to start leaves the schema untouched, the previous image valid and
   * automatic rollback still available -- which is the whole thing the snapshot
   * is protecting.
   */
  required: boolean
}

export type PreMigrationSnapshot =
  /** The file does not exist yet; the first start creates it empty. */
  | { status: 'no-database'; pending: string[] }
  /** Nothing to apply, so nothing to protect. The ordinary start. */
  | { status: 'up-to-date'; pending: [] }
  /** Migrations pending, but the ledger is not one this build recognises.
   *  `migrate` is about to say so precisely; taking a copy first would be
   *  copying something we cannot vouch for. */
  | { status: 'ledger-diverged'; pending: [] }
  /** Migrations pending, no artifact store, and not production. Development. */
  | { status: 'no-store'; pending: string[] }
  | {
    status: 'taken'
    pending: string[]
    artifactId: string
    bytes: number
    sha256: string
    /** Non-fatal notes from the backup -- today, a volume running low. */
    warnings: string[]
  }

/**
 * Whether a missing snapshot is fatal.
 *
 * A named function rather than an inline comparison, because it is the policy
 * itself: production never changes a schema it has not copied first. `npm run
 * deploy:migration-check` asserts this on every deploy, so removing the guard
 * fails CI rather than quietly shipping.
 */
export const snapshotRequiredFor = (nodeEnv: string): boolean => nodeEnv === 'production'

export class PreMigrationSnapshotError extends Error {
  readonly code: string
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PreMigrationSnapshotError'
    this.code = code
  }
}

/**
 * Take the snapshot, if this start is about to change the schema.
 *
 * Returns rather than throws for every outcome that is not a failure, so the
 * caller can log what happened. It throws only when a snapshot was required and
 * could not be produced -- which stops the start, and with it the migration.
 */
export async function ensurePreMigrationSnapshot(
  options: PreMigrationSnapshotOptions,
): Promise<PreMigrationSnapshot> {
  const migrations = options.migrations ?? MIGRATIONS

  if (!existsSync(options.databasePath)) return { status: 'no-database', pending: [] }

  let report: PendingMigrationReport
  try {
    report = pendingMigrations(options.databasePath, migrations)
  } catch (cause) {
    // Unreadable, absent ledger, wrong file. `openDatabase` is next and will
    // fail on the same thing with the right error; do not pre-empt it.
    if (options.required) {
      throw new PreMigrationSnapshotError(
        'PRE_MIGRATION_SNAPSHOT_UNREADABLE',
        `could not read the migration ledger at ${options.databasePath} to decide whether a `
        + 'pre-migration snapshot is needed',
        { cause },
      )
    }
    return { status: 'ledger-diverged', pending: [] }
  }

  if (!report.pending.length) {
    // Either genuinely up to date, or diverged -- which `pendingMigrations`
    // reports as "nothing pending" so that `migrate` owns the diagnosis.
    const code = codeLedger(migrations)
    const diverged = report.applied.length !== code.length
      || report.applied.some((entry, index) =>
        entry.checksum !== migrationChecksum(migrations[index]))
    return diverged ? { status: 'ledger-diverged', pending: [] } : { status: 'up-to-date', pending: [] }
  }

  if (!options.openStore) {
    if (options.required) {
      throw new PreMigrationSnapshotError(
        'PRE_MIGRATION_SNAPSHOT_UNAVAILABLE',
        `${report.pending.length} migration(s) are pending (${report.pending.join(', ')}) and no `
        + 'artifact store is configured, so no snapshot can be taken. Refusing to change the '
        + 'schema: set BACKUP_ROOT to a writable persistent directory and redeploy.',
      )
    }
    return { status: 'no-store', pending: report.pending }
  }

  try {
    const result = await createBackup({
      sourcePath: options.databasePath,
      store: options.openStore(),
      appVersion: options.appVersion,
      buildId: options.buildId,
      sourceCommit: options.sourceCommit,
      workRoot: options.workRoot,
      // The source is a release behind by construction; see the note on the option.
      expectLedgerPrefix: true,
      freeSpaceProbe: options.freeSpaceProbe,
    })
    return {
      status: 'taken',
      pending: report.pending,
      artifactId: result.artifactId,
      bytes: result.bytes,
      sha256: result.sha256,
      warnings: result.warnings,
    }
  } catch (cause) {
    const detail = cause instanceof RecoveryError || cause instanceof Error
      ? cause.message
      : String(cause)
    if (options.required) {
      throw new PreMigrationSnapshotError(
        'PRE_MIGRATION_SNAPSHOT_FAILED',
        `${report.pending.length} migration(s) are pending (${report.pending.join(', ')}) and the `
        + `snapshot could not be written: ${detail}. Refusing to change the schema.`,
        { cause },
      )
    }
    throw new PreMigrationSnapshotError(
      'PRE_MIGRATION_SNAPSHOT_FAILED',
      `pre-migration snapshot failed: ${detail}`,
      { cause },
    )
  }
}

/** One line for the start-up log, whatever happened. */
export function describePreMigrationSnapshot(result: PreMigrationSnapshot): string {
  switch (result.status) {
    case 'no-database':
      return 'no database yet — nothing to snapshot before the first migration'
    case 'up-to-date':
      return 'schema is up to date — no pre-migration snapshot needed'
    case 'ledger-diverged':
      return 'migration ledger is not one this build recognises — leaving the diagnosis to migrate()'
    case 'no-store':
      return `${result.pending.length} migration(s) pending (${result.pending.join(', ')}) and no `
        + 'artifact store configured — no snapshot taken (development only)'
    case 'taken':
      return `pre-migration snapshot ${result.artifactId} (${result.bytes} bytes) taken before `
        + result.pending.join(', ')
  }
}
