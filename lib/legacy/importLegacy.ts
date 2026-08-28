// Legacy import: dry run, then a hash-gated single-transaction apply.
//
// Rules that are not negotiable:
//   * the target owner is explicit; legacy rows carry no ownership and none is
//     invented
//   * explicit legacy ids, raw JSON text, timestamps, SQL nulls, boolean
//     integers and pocket sort_order are written through unchanged
//   * designs are inserted before pockets
//   * any rejected row fails the whole run; there is no partial apply
//   * an identical previously imported row is a no-op, a changed one is a
//     failure
import type { SqliteDatabase } from '../db/connection.ts'
import { OWNED_LEGACY_TABLES } from '../db/schema.ts'
import type { OwnedLegacyTable } from '../db/schema.ts'
import type { Owner } from '../db/repositories/contracts.ts'
import { createImportLedger } from '../db/repositories/imports.ts'
import type { CanonicalRow, SqlValue } from './canonical.ts'
import {
  LEGACY_COLUMNS, canonicalRow, rowHash, rowId, rowValue, rowsHash,
  serializeCanonical, sha256,
} from './canonical.ts'
import type { ExportBundle, SourceEvidence } from './manifest.ts'
import {
  LegacyError, REPORT_CONTRACT, REPORT_CONTRACT_VERSION, bundleHash, validateExportBundle,
} from './manifest.ts'
import type { ApprovedSource } from './approvedSource.ts'
import { APPROVED_SOURCE } from './approvedSource.ts'
import type { ApprovalResult } from './approvalGate.ts'
import { assertApprovedSource } from './approvalGate.ts'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export type Disposition = 'insert' | 'noop' | 'reject'

export interface RejectedRow {
  id: number
  code: string
  message: string
}

export interface TableDisposition {
  name: OwnedLegacyTable
  insert: number[]
  noop: number[]
  reject: RejectedRow[]
}

export interface SequencePlan {
  name: string
  sourceSeq: number
  targetSeqBefore: number
  targetSeqAfter: number
}

export interface ImportReport {
  contract: typeof REPORT_CONTRACT
  contractVersion: number
  app: 'shapepilot'
  mode: 'dry-run'
  bundleHash: string
  source: SourceEvidence
  /** Recomputed from the exported rows and the approved column metadata. */
  approval: ApprovalResult
  owner: { tenantId: string; oid: string }
  tables: TableDisposition[]
  sequences: SequencePlan[]
  totals: { insert: number; noop: number; reject: number }
  ok: boolean
}

export interface ImportPlan {
  report: ImportReport
  reportHash: string
  /** Rows to write, already ordered designs -> pockets -> library. */
  writes: { table: OwnedLegacyTable; row: CanonicalRow; id: number; hash: string }[]
}

export const reportHashOf = (report: ImportReport): string => sha256(serializeCanonical(report))

export function requireOwner(value: unknown): Owner {
  const raw = (value ?? {}) as { tenantId?: unknown; oid?: unknown }
  const tenantId = String(raw.tenantId ?? '').trim().toLowerCase()
  const oid = String(raw.oid ?? '').trim().toLowerCase()
  if (!GUID.test(tenantId) || !GUID.test(oid)) {
    throw new LegacyError(
      'OWNER_REQUIRED',
      'an explicit target owner tenant GUID and object-id GUID are required',
    )
  }
  return { tenantId, oid }
}

const INTEGER_COLUMNS: Record<OwnedLegacyTable, readonly string[]> = {
  keycap_tray_designs: ['id'],
  keycap_tray_pockets: ['id', 'design_id', 'rotation_deg', 'is_through', 'sort_order', 'mirror_x'],
  keycap_pocket_library: ['id'],
}

const REQUIRED_TEXT: Record<OwnedLegacyTable, readonly string[]> = {
  keycap_tray_designs: ['name', 'profile_kind', 'profile_json', 'sizing_json', 'created_at', 'updated_at'],
  keycap_tray_pockets: ['label_mode'],
  keycap_pocket_library: ['name', 'created_at'],
}

const REQUIRED_NUMBER: Record<OwnedLegacyTable, readonly string[]> = {
  keycap_tray_designs: ['floor_mm', 'depth_mm', 'engrave_mm'],
  keycap_tray_pockets: ['units', 'height_units', 'x_mm', 'y_mm'],
  keycap_pocket_library: ['units'],
}

const JSON_COLUMNS: Record<OwnedLegacyTable, readonly string[]> = {
  keycap_tray_designs: ['profile_json', 'sizing_json'],
  keycap_tray_pockets: [],
  keycap_pocket_library: [],
}

/** Value-level validation. Anything unsupported is a rejection, never a coercion. */
function validateRow(table: OwnedLegacyTable, row: CanonicalRow): string | null {
  for (const column of INTEGER_COLUMNS[table]) {
    const value = rowValue(row, table, column)
    const numeric = typeof value === 'bigint' ? Number(value) : value
    if (typeof numeric !== 'number' || !Number.isSafeInteger(numeric)) {
      return `${column} must be an integer`
    }
  }
  for (const column of REQUIRED_TEXT[table]) {
    if (typeof rowValue(row, table, column) !== 'string') return `${column} must be text`
  }
  for (const column of REQUIRED_NUMBER[table]) {
    const value = rowValue(row, table, column)
    const numeric = typeof value === 'bigint' ? Number(value) : value
    if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
      return `${column} must be a finite number`
    }
  }
  for (const column of JSON_COLUMNS[table]) {
    const value = rowValue(row, table, column)
    if (typeof value !== 'string') return `${column} must be JSON text`
    try { JSON.parse(value) } catch { return `${column} is not valid JSON` }
  }
  return null
}

interface TargetRow { id: number; ownerTenantId: string | null; ownerOid: string | null; hash: string }

function readTargetRows(db: SqliteDatabase, table: OwnedLegacyTable): Map<number, TargetRow> {
  const columns = LEGACY_COLUMNS[table]
  const hasOwner = table !== 'keycap_tray_pockets'
  const select = hasOwner
    ? `SELECT ${columns.join(', ')}, owner_tenant_id, owner_oid FROM ${table}`
    : `SELECT ${columns.join(', ')} FROM ${table}`
  const map = new Map<number, TargetRow>()
  for (const raw of db.prepare<[], Record<string, SqlValue>>(select).all()) {
    const projection = canonicalRow(table, raw)
    const id = rowId(projection, table)
    map.set(id, {
      id,
      ownerTenantId: hasOwner ? (raw.owner_tenant_id as string) : null,
      ownerOid: hasOwner ? (raw.owner_oid as string) : null,
      hash: rowHash(table, projection),
    })
  }
  return map
}

const currentSequence = (db: SqliteDatabase, table: string): number => {
  const row = db.prepare<[string], { seq: number }>(
    'SELECT seq FROM sqlite_sequence WHERE name = ?').get(table)
  return row ? Number(row.seq) : 0
}

export interface PlanOptions {
  db: SqliteDatabase
  bundle: unknown
  owner: unknown
  /**
   * The approved source contract. Defaults to the one checked into the build;
   * operator commands never pass anything else, and tests pass a contract
   * derived from their own synthetic fixture.
   */
  approvedSource?: ApprovedSource
}

/**
 * Build the deterministic disposition plan. This never writes and never
 * mutates the bundle, so `--dry-run` and `--apply` produce the same report for
 * the same inputs.
 */
export function planImport(options: PlanOptions): ImportPlan {
  const bundle: ExportBundle = validateExportBundle(options.bundle)
  const owner = requireOwner(options.owner)

  // The approval gate runs first and throws: an unapproved or tampered bundle
  // never reaches a disposition, let alone a transaction.
  const approval = assertApprovedSource(bundle, options.approvedSource ?? APPROVED_SOURCE)

  // Recompute every table hash: a tampered bundle must not survive validation.
  for (const table of bundle.tables) {
    const recomputed = rowsHash(table.name, table.rows)
    if (recomputed !== table.rowsHash) {
      throw new LegacyError(
        'EXPORT_TAMPERED',
        `${table.name} rowsHash does not match its rows; the bundle has been modified`,
      )
    }
  }

  const byTable = new Map<OwnedLegacyTable, ExportBundle['tables'][number]>(
    bundle.tables.map((t) => [t.name, t]))
  const designIds = new Set<number>(
    (byTable.get('keycap_tray_designs')?.rows ?? []).map((row) => rowId(row, 'keycap_tray_designs')))

  const dispositions: TableDisposition[] = []
  const writes: ImportPlan['writes'] = []

  for (const table of OWNED_LEGACY_TABLES) {
    const exported = byTable.get(table)
    if (!exported) throw new LegacyError('EXPORT_TABLES_INVALID', `${table} is missing from the bundle`)

    const targetRows = readTargetRows(options.db, table)
    const ledgerRows = new Set<number>(
      options.db.prepare<[string], { source_id: number }>(
        'SELECT source_id FROM legacy_import_rows WHERE source_table = ?',
      ).all(table).map((r) => Number(r.source_id)))
    const seenIds = new Set<number>()
    const seenBusinessKeys = new Set<string>()
    const disposition: TableDisposition = { name: table, insert: [], noop: [], reject: [] }

    // Existing owner-scoped library names, so a bundle cannot silently shadow one.
    const targetLibraryNames = new Set<string>()
    if (table === 'keycap_pocket_library') {
      for (const row of options.db.prepare<[string, string], { name: string }>(
        'SELECT name FROM keycap_pocket_library WHERE owner_tenant_id = ? AND owner_oid = ?',
      ).all(owner.tenantId, owner.oid)) {
        targetLibraryNames.add(row.name)
      }
    }

    for (const row of exported.rows) {
      let id: number
      try {
        id = rowId(row, table)
      } catch {
        disposition.reject.push({ id: -1, code: 'PRIMARY_KEY_INVALID', message: 'row has no usable integer id' })
        continue
      }

      const reject = (code: string, message: string) => {
        disposition.reject.push({ id, code, message })
      }

      if (seenIds.has(id)) {
        reject('DUPLICATE_PRIMARY_KEY', `${table} contains id ${id} more than once`)
        continue
      }
      seenIds.add(id)

      const valueProblem = validateRow(table, row)
      if (valueProblem) { reject('UNSUPPORTED_VALUE', valueProblem); continue }

      if (table === 'keycap_tray_pockets') {
        const parent = rowValue(row, table, 'design_id')
        const parentId = typeof parent === 'bigint' ? Number(parent) : parent
        if (typeof parentId !== 'number' || !designIds.has(parentId)) {
          reject('ORPHAN_ROW', `pocket ${id} references design ${String(parent)}, which is not in the bundle`)
          continue
        }
      }

      if (table === 'keycap_pocket_library') {
        const name = rowValue(row, table, 'name')
        const key = String(name)
        if (seenBusinessKeys.has(key)) {
          reject('DUPLICATE_BUSINESS_KEY', `the bundle contains two library pockets named "${key}"`)
          continue
        }
        seenBusinessKeys.add(key)
      }

      const hash = rowHash(table, row)
      const existingTarget = targetRows.get(id)

      if (existingTarget) {
        // Only a row this exact source produced, unchanged, and owned by the
        // declared owner, may be treated as an idempotent replay.
        const ownedByTarget = table === 'keycap_tray_pockets'
          || (existingTarget.ownerTenantId === owner.tenantId && existingTarget.ownerOid === owner.oid)
        if (existingTarget.hash === hash && ownedByTarget) {
          disposition.noop.push(id)
          continue
        }
        reject(
          existingTarget.hash === hash ? 'TARGET_COLLISION' : 'SOURCE_CHANGED',
          existingTarget.hash === hash
            ? `${table} id ${id} already exists and belongs to another owner`
            : `${table} id ${id} already exists with different content`,
        )
        continue
      }

      if (table === 'keycap_pocket_library' && targetLibraryNames.has(String(rowValue(row, table, 'name')))) {
        reject('DUPLICATE_BUSINESS_KEY',
          `the owner already has a library pocket named "${String(rowValue(row, table, 'name'))}"`)
        continue
      }

      // A ledger entry with no surviving target row means an imported row was
      // deleted afterwards. Re-inserting it silently would resurrect data the
      // owner removed, so it fails instead.
      if (ledgerRows.has(id)) {
        reject('LEDGER_ROW_DELETED',
          `${table} id ${id} was imported before and has since been deleted from the target`)
        continue
      }

      disposition.insert.push(id)
      writes.push({ table, row, id, hash })
    }

    dispositions.push(disposition)
  }

  const sequences: SequencePlan[] = OWNED_LEGACY_TABLES.map((table) => {
    const sourceSeq = bundle.sqliteSequence.find((s) => s.name === table)?.seq ?? 0
    const targetSeqBefore = currentSequence(options.db, table)
    const maxInserted = writes
      .filter((w) => w.table === table)
      .reduce((max, w) => Math.max(max, w.id), 0)
    return {
      name: table,
      sourceSeq,
      targetSeqBefore,
      targetSeqAfter: Math.max(sourceSeq, targetSeqBefore, maxInserted),
    }
  })

  const totals = dispositions.reduce(
    (acc, d) => ({
      insert: acc.insert + d.insert.length,
      noop: acc.noop + d.noop.length,
      reject: acc.reject + d.reject.length,
    }),
    { insert: 0, noop: 0, reject: 0 },
  )

  const report: ImportReport = {
    contract: REPORT_CONTRACT,
    contractVersion: REPORT_CONTRACT_VERSION,
    app: 'shapepilot',
    mode: 'dry-run',
    bundleHash: bundleHash(bundle),
    source: bundle.source,
    approval,
    owner,
    tables: dispositions,
    sequences,
    totals,
    ok: totals.reject === 0,
  }

  return { report, reportHash: reportHashOf(report), writes }
}

export interface ApplyOptions extends PlanOptions {
  /** The hash printed by the dry run. Apply refuses to proceed without it. */
  expectedReportHash: string
}

export interface ApplyResult {
  report: ImportReport
  reportHash: string
  inserted: number
  noop: number
  runId: number | null
}

const INSERT_SQL: Record<OwnedLegacyTable, string> = {
  keycap_tray_designs: `
    INSERT INTO keycap_tray_designs
      (id, owner_tenant_id, owner_oid, name, notes, profile_kind, profile_json, sizing_json,
       floor_mm, depth_mm, engrave_mm, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  keycap_tray_pockets: `
    INSERT INTO keycap_tray_pockets
      (id, design_id, units, height_units, x_mm, y_mm, rotation_deg, is_through, label,
       label_mode, depth_mm, width_mm, height_mm, corner_mm, sort_order, mirror_x, shape)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  keycap_pocket_library: `
    INSERT INTO keycap_pocket_library
      (id, owner_tenant_id, owner_oid, name, units, width_mm, height_mm, corner_mm, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
}

const bindValues = (
  table: OwnedLegacyTable, row: CanonicalRow, owner: Owner,
): SqlValue[] => {
  const value = (column: string) => rowValue(row, table, column)
  const columns = LEGACY_COLUMNS[table]
  switch (table) {
    case 'keycap_tray_designs':
      return [value('id'), owner.tenantId, owner.oid, ...columns.slice(1).map(value)]
    case 'keycap_pocket_library':
      return [value('id'), owner.tenantId, owner.oid, ...columns.slice(1).map(value)]
    case 'keycap_tray_pockets':
      return columns.map(value)
  }
}

/**
 * Apply the plan in one transaction. Designs are written first so the pocket
 * foreign key is satisfied without deferring it.
 */
export function applyImport(options: ApplyOptions): ApplyResult {
  const plan = planImport(options)
  if (plan.reportHash !== options.expectedReportHash) {
    throw new LegacyError(
      'REPORT_HASH_MISMATCH',
      'the supplied dry-run report hash does not match the current plan; re-run --dry-run',
    )
  }
  if (!plan.report.ok) {
    throw new LegacyError(
      'IMPORT_REJECTED',
      `${plan.report.totals.reject} row(s) were rejected; nothing was written`,
    )
  }

  const owner = plan.report.owner
  const ledger = createImportLedger(options.db)
  const statements = Object.fromEntries(
    OWNED_LEGACY_TABLES.map((table) => [table, options.db.prepare(INSERT_SQL[table])]),
  ) as Record<OwnedLegacyTable, ReturnType<SqliteDatabase['prepare']>>

  let runId: number | null = null

  const run = options.db.transaction(() => {
    if (plan.writes.length === 0 && plan.report.totals.noop > 0) return

    runId = ledger.recordRunSync({
      sourceManifestHash: plan.report.bundleHash,
      sourceCommit: plan.report.source.commit,
      sourceSha256: plan.report.source.sha256,
      sourceBytes: plan.report.source.bytes,
      owner,
      reportHash: plan.reportHash,
    })

    for (const table of OWNED_LEGACY_TABLES) {
      for (const write of plan.writes.filter((w) => w.table === table)) {
        statements[table].run(bindValues(table, write.row, owner) as never)
        ledger.recordRowSync(runId, {
          sourceTable: table,
          sourceId: write.id,
          targetId: write.id,
          rowHash: write.hash,
        })
      }
    }

    for (const sequence of plan.report.sequences) {
      if (sequence.targetSeqAfter <= 0) continue
      const updated = options.db.prepare(
        'UPDATE sqlite_sequence SET seq = ? WHERE name = ? AND seq < ?',
      ).run(sequence.targetSeqAfter, sequence.name, sequence.targetSeqAfter)
      if (!updated.changes) {
        const exists = options.db.prepare<[string], { seq: number }>(
          'SELECT seq FROM sqlite_sequence WHERE name = ?').get(sequence.name)
        if (!exists) {
          options.db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)')
            .run(sequence.name, sequence.targetSeqAfter)
        }
      }
    }

    ledger.completeRunSync(runId)
  })

  run()

  return {
    report: plan.report,
    reportHash: plan.reportHash,
    inserted: plan.report.totals.insert,
    noop: plan.report.totals.noop,
    runId,
  }
}
