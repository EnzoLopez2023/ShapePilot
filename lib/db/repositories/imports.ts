// Import ledger.
//
// Records which legacy source rows were accepted, which target row they became,
// and the canonical hash of the row that was written. That is what makes an
// identical replay a provable no-op and a changed source row a hard failure.
import type { SqliteDatabase } from '../connection.ts'
import type { Owner } from './contracts.ts'

export interface ImportRunInput {
  sourceManifestHash: string
  sourceCommit: string
  sourceSha256: string
  sourceBytes: number
  owner: Owner
  reportHash: string
}

export interface ImportedRow {
  sourceTable: string
  sourceId: number
  targetId: number
  rowHash: string
}

export interface ImportRun {
  id: number
  sourceManifestHash: string
  sourceCommit: string
  sourceSha256: string
  sourceBytes: number
  ownerTenantId: string
  ownerOid: string
  reportHash: string
  startedAt: string
  completedAt: string | null
}

export interface ImportLedger {
  findRun(sourceManifestHash: string, owner: Owner): Promise<ImportRun | null>
  listRows(runId: number): Promise<ImportedRow[]>
  findRow(sourceTable: string, sourceId: number): Promise<ImportedRow | null>
  /** Called inside the caller's single apply transaction. */
  recordRunSync(input: ImportRunInput): number
  recordRowSync(runId: number, row: ImportedRow): void
  completeRunSync(runId: number): void
}

interface RunRow {
  id: number
  source_manifest_hash: string
  source_commit: string
  source_sha256: string
  source_bytes: number
  owner_tenant_id: string
  owner_oid: string
  report_hash: string
  started_at: string
  completed_at: string | null
}

interface LedgerRow {
  source_table: string
  source_id: number
  target_id: number
  row_hash: string
}

const toRun = (r: RunRow): ImportRun => ({
  id: r.id,
  sourceManifestHash: r.source_manifest_hash,
  sourceCommit: r.source_commit,
  sourceSha256: r.source_sha256,
  sourceBytes: r.source_bytes,
  ownerTenantId: r.owner_tenant_id,
  ownerOid: r.owner_oid,
  reportHash: r.report_hash,
  startedAt: r.started_at,
  completedAt: r.completed_at,
})

const toRow = (r: LedgerRow): ImportedRow => ({
  sourceTable: r.source_table,
  sourceId: r.source_id,
  targetId: r.target_id,
  rowHash: r.row_hash,
})

export function createImportLedger(db: SqliteDatabase): ImportLedger {
  return {
    async findRun(sourceManifestHash, owner) {
      const row = db.prepare<[string, string, string], RunRow>(`
        SELECT * FROM legacy_import_runs
         WHERE source_manifest_hash = ? AND owner_tenant_id = ? AND owner_oid = ?`)
        .get(sourceManifestHash, owner.tenantId, owner.oid)
      return row ? toRun(row) : null
    },

    async listRows(runId) {
      return db.prepare<[number], LedgerRow>(
        'SELECT * FROM legacy_import_rows WHERE run_id = ? ORDER BY source_table, source_id',
      ).all(runId).map(toRow)
    },

    async findRow(sourceTable, sourceId) {
      const row = db.prepare<[string, number], LedgerRow>(
        'SELECT * FROM legacy_import_rows WHERE source_table = ? AND source_id = ?',
      ).get(sourceTable, sourceId)
      return row ? toRow(row) : null
    },

    recordRunSync(input) {
      const info = db.prepare(`
        INSERT INTO legacy_import_runs
          (source_manifest_hash, source_commit, source_sha256, source_bytes,
           owner_tenant_id, owner_oid, report_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        input.sourceManifestHash, input.sourceCommit, input.sourceSha256, input.sourceBytes,
        input.owner.tenantId, input.owner.oid, input.reportHash)
      return Number(info.lastInsertRowid)
    },

    recordRowSync(runId, row) {
      db.prepare(`
        INSERT INTO legacy_import_rows (run_id, source_table, source_id, target_id, row_hash)
        VALUES (?, ?, ?, ?, ?)`).run(runId, row.sourceTable, row.sourceId, row.targetId, row.rowHash)
    },

    completeRunSync(runId) {
      db.prepare("UPDATE legacy_import_runs SET completed_at = datetime('now') WHERE id = ?")
        .run(runId)
    },
  }
}
