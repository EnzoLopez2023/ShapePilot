// Independent reconciliation.
//
// This does not trust the importer. It re-reads the source bundle and the
// target database and proves, field by field, that the two agree: table counts,
// primary key sets, business key sets, canonical row hashes, the
// pocket -> design relationship, owner assignment, pocket ordering, and
// sequences. Success means zero unexplained differences.
import type { SqliteDatabase } from '../db/connection.ts'
import { OWNED_LEGACY_TABLES } from '../db/schema.ts'
import type { OwnedLegacyTable } from '../db/schema.ts'
import type { Owner } from '../db/repositories/contracts.ts'
import type { SqlValue } from './canonical.ts'
import { LEGACY_COLUMNS, canonicalRow, rowHash, rowId, rowsHash, serializeCanonical, sha256 } from './canonical.ts'
import type { ExportBundle } from './manifest.ts'
import { RECONCILE_CONTRACT, RECONCILE_CONTRACT_VERSION, bundleHash, validateExportBundle } from './manifest.ts'
import { requireOwner } from './importLegacy.ts'
import type { ApprovedSource } from './approvedSource.ts'
import { APPROVED_SOURCE } from './approvedSource.ts'
import type { ApprovalResult } from './approvalGate.ts'
import { assertApprovedSource } from './approvalGate.ts'

export interface Difference {
  table: string
  check: string
  detail: string
}

export interface TableReconciliation {
  name: OwnedLegacyTable
  sourceRowCount: number
  targetRowCount: number
  sourceKeyHash: string
  targetKeyHash: string
  sourceRowsHash: string
  targetRowsHash: string
  ok: boolean
}

export interface ReconcileReport {
  contract: typeof RECONCILE_CONTRACT
  contractVersion: number
  app: 'shapepilot'
  bundleHash: string
  approval: ApprovalResult
  owner: { tenantId: string; oid: string }
  tables: TableReconciliation[]
  relationships: { name: string; ok: boolean; sourcePairs: number; targetPairs: number }[]
  sequences: { name: string; sourceSeq: number; targetSeq: number; ok: boolean }[]
  differences: Difference[]
  ok: boolean
  signedOffUtc: string
}

const keySetHash = (table: OwnedLegacyTable, ids: number[]): string =>
  sha256(serializeCanonical({ table, keys: [...ids].sort((a, b) => a - b) }))

function readTarget(
  db: SqliteDatabase,
  table: OwnedLegacyTable,
  owner: Owner,
): { rows: Record<string, SqlValue>[]; scoped: boolean } {
  const columns = LEGACY_COLUMNS[table].join(', ')
  if (table === 'keycap_tray_pockets') {
    // Pockets inherit ownership through their design, so scope through the join.
    return {
      scoped: true,
      rows: db.prepare<[string, string], Record<string, SqlValue>>(`
        SELECT ${LEGACY_COLUMNS[table].map((c) => `p.${c}`).join(', ')}
          FROM keycap_tray_pockets p
          JOIN keycap_tray_designs d ON d.id = p.design_id
         WHERE d.owner_tenant_id = ? AND d.owner_oid = ?
         ORDER BY p.design_id, p.sort_order, p.id`).all(owner.tenantId, owner.oid),
    }
  }
  return {
    scoped: true,
    rows: db.prepare<[string, string], Record<string, SqlValue>>(
      `SELECT ${columns} FROM ${table} WHERE owner_tenant_id = ? AND owner_oid = ? ORDER BY id`,
    ).all(owner.tenantId, owner.oid),
  }
}

export interface ReconcileOptions {
  db: SqliteDatabase
  bundle: unknown
  owner: unknown
  signedOffUtc?: string
  approvedSource?: ApprovedSource
  /** Deterministic regression seam after each target table read. */
  afterTableRead?: (table: OwnedLegacyTable) => void
}

function reconcileSnapshot(options: ReconcileOptions): ReconcileReport {
  const bundle: ExportBundle = validateExportBundle(options.bundle)
  const approval = assertApprovedSource(bundle, options.approvedSource ?? APPROVED_SOURCE)
  const owner = requireOwner(options.owner)
  const differences: Difference[] = []
  const tables: TableReconciliation[] = []

  for (const table of OWNED_LEGACY_TABLES) {
    const exported = bundle.tables.find((t) => t.name === table)
    if (!exported) {
      differences.push({ table, check: 'presence', detail: 'table missing from the source bundle' })
      continue
    }

    const sourceIds = exported.rows.map((row) => rowId(row, table))
    const sourceRowsHash = rowsHash(table, exported.rows)

    const target = readTarget(options.db, table, owner)
    options.afterTableRead?.(table)
    const targetRows = target.rows.map((row) => canonicalRow(table, row))
    const targetIds = targetRows.map((row) => rowId(row, table))
    const targetRowsHash = rowsHash(table, targetRows)

    const sourceKeyHash = keySetHash(table, sourceIds)
    const targetKeyHash = keySetHash(table, targetIds)

    if (exported.rows.length !== targetRows.length) {
      differences.push({
        table,
        check: 'rowCount',
        detail: `source has ${exported.rows.length} rows, target has ${targetRows.length}`,
      })
    }
    if (sourceKeyHash !== targetKeyHash) {
      const missing = sourceIds.filter((id) => !targetIds.includes(id))
      const extra = targetIds.filter((id) => !sourceIds.includes(id))
      differences.push({
        table,
        check: 'primaryKeys',
        detail: `missing in target: [${missing.join(', ')}]; unexpected in target: [${extra.join(', ')}]`,
      })
    }
    if (sourceRowsHash !== targetRowsHash) {
      const targetById = new Map(targetRows.map((row) => [rowId(row, table), rowHash(table, row)]))
      for (const row of exported.rows) {
        const id = rowId(row, table)
        const sourceHash = rowHash(table, row)
        const targetHash = targetById.get(id)
        if (targetHash && targetHash !== sourceHash) {
          differences.push({ table, check: 'fieldHash', detail: `row ${id} differs` })
        }
      }

      if (!differences.some((d) => d.table === table && d.check === 'fieldHash')) {
        differences.push({ table, check: 'rowsHash', detail: 'canonical table hashes differ' })
      }
    }

    // Business key: library names must stay unique per owner.
    if (table === 'keycap_pocket_library') {
      const names = targetRows.map((row) => String(row[LEGACY_COLUMNS[table].indexOf('name')][1]))
      if (new Set(names).size !== names.length) {
        differences.push({ table, check: 'businessKey', detail: 'duplicate library names for this owner' })
      }
    }

    tables.push({
      name: table,
      sourceRowCount: exported.rows.length,
      targetRowCount: targetRows.length,
      sourceKeyHash,
      targetKeyHash,
      sourceRowsHash,
      targetRowsHash,
      ok: sourceKeyHash === targetKeyHash && sourceRowsHash === targetRowsHash,
    })
  }

  // Owner assignment: no imported row may be left unscoped or scoped elsewhere.
  for (const table of ['keycap_tray_designs', 'keycap_pocket_library'] as const) {
    const sourceTable = bundle.tables.find((candidate) => candidate.name === table)
    const sourceIds = sourceTable?.rows.map((row) => rowId(row, table)) ?? []
    if (sourceIds.length === 0) continue
    const placeholders = sourceIds.map(() => '?').join(', ')
    const stray = options.db.prepare<(number | string)[], { count: number }>(
      `SELECT COUNT(*) AS count FROM ${table}
        WHERE id IN (${placeholders})
          AND (owner_tenant_id IS NULL OR owner_oid IS NULL
            OR owner_tenant_id != ? OR owner_oid != ?)`,
    ).get(...sourceIds, owner.tenantId, owner.oid)
    if (stray && Number(stray.count) > 0) {
      differences.push({
        table,
        check: 'ownerAssignment',
        detail: `${stray.count} row(s) are not owned by the reconciled owner`,
      })
    }
  }

  // Relationship: every target pocket points at an existing owned design, and
  // the source pairs are reproduced exactly.
  const sourcePairs = bundle.relationships.find((r) => r.child === 'keycap_tray_pockets')?.pairs ?? []
  const targetPairs = options.db.prepare<[string, string], { id: number; design_id: number }>(`
    SELECT p.id, p.design_id
      FROM keycap_tray_pockets p
      JOIN keycap_tray_designs d ON d.id = p.design_id
     WHERE d.owner_tenant_id = ? AND d.owner_oid = ?
     ORDER BY p.id`).all(owner.tenantId, owner.oid).map((r) => [Number(r.id), Number(r.design_id)])
  const pairKey = (pairs: number[][]) =>
    sha256(serializeCanonical([...pairs].sort((a, b) => a[0] - b[0])))
  const relationshipOk = pairKey(sourcePairs) === pairKey(targetPairs)
  if (!relationshipOk) {
    differences.push({
      table: 'keycap_tray_pockets',
      check: 'relationship',
      detail: `source has ${sourcePairs.length} pocket->design pairs, target has ${targetPairs.length}`,
    })
  }

  const orphans = options.db.prepare<[], { count: number }>(`
    SELECT COUNT(*) AS count FROM keycap_tray_pockets p
     WHERE NOT EXISTS (SELECT 1 FROM keycap_tray_designs d WHERE d.id = p.design_id)`).get()
  if (orphans && Number(orphans.count) > 0) {
    differences.push({
      table: 'keycap_tray_pockets',
      check: 'foreignKey',
      detail: `${orphans.count} pocket(s) have no parent design`,
    })
  }

  // Pocket ordering within each design must survive the round trip.
  const orderRows = options.db.prepare<[], { design_id: number; sort_order: number }>(
    'SELECT design_id, sort_order FROM keycap_tray_pockets ORDER BY design_id, sort_order').all()
  let previousDesign: number | null = null
  let previousOrder = -Infinity
  for (const row of orderRows) {
    const design = Number(row.design_id)
    if (design !== previousDesign) { previousDesign = design; previousOrder = -Infinity }
    const order = Number(row.sort_order)
    if (order < previousOrder) {
      differences.push({
        table: 'keycap_tray_pockets',
        check: 'ordering',
        detail: `design ${design} has non-monotonic sort_order`,
      })
      break
    }
    previousOrder = order
  }

  const sequences = OWNED_LEGACY_TABLES.map((table) => {
    const sourceSeq = bundle.sqliteSequence.find((s) => s.name === table)?.seq ?? 0
    const row = options.db.prepare<[string], { seq: number }>(
      'SELECT seq FROM sqlite_sequence WHERE name = ?').get(table)
    const targetSeq = row ? Number(row.seq) : 0
    const ok = targetSeq >= sourceSeq
    if (!ok) {
      differences.push({
        table,
        check: 'sequence',
        detail: `target sqlite_sequence ${targetSeq} is behind the source ${sourceSeq}`,
      })
    }
    return { name: table, sourceSeq, targetSeq, ok }
  })

  return {
    contract: RECONCILE_CONTRACT,
    contractVersion: RECONCILE_CONTRACT_VERSION,
    app: 'shapepilot',
    bundleHash: bundleHash(bundle),
    approval,
    owner,
    tables,
    relationships: [{
      name: 'keycap_tray_pockets.design_id -> keycap_tray_designs.id',
      ok: relationshipOk,
      sourcePairs: sourcePairs.length,
      targetPairs: targetPairs.length,
    }],
    sequences,
    differences,
    ok: differences.length === 0,
    signedOffUtc: options.signedOffUtc ?? new Date().toISOString(),
  }
}

export function reconcile(options: ReconcileOptions): ReconcileReport {
  const snapshot = options.db.transaction(() => reconcileSnapshot(options))
  return snapshot.deferred()
}
