import type { SqliteDatabase } from '../connection.ts'
import type {
  DesignDocumentInput, DesignDocumentKind, DesignDocumentRecord,
  DesignDocumentRepository, DesignDocumentSummary, Owner,
} from './contracts.ts'

interface DocumentRow {
  id: number
  kind: string
  name: string
  notes: string | null
  doc_json: string
  created_at: string
  updated_at: string
}

type SummaryRow = Omit<DocumentRow, 'doc_json'> & { object_count: number }

/**
 * Integer identity in SQLite, string ids over HTTP -- the same split the keycap
 * repository uses, so the API surface stays uniform.
 */
const toRecord = (row: DocumentRow): DesignDocumentRecord => ({
  id: String(row.id),
  kind: row.kind as DesignDocumentKind,
  name: row.name,
  notes: row.notes,
  docJson: row.doc_json,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const toSummary = (row: SummaryRow): DesignDocumentSummary => ({
  id: String(row.id),
  kind: row.kind as DesignDocumentKind,
  name: row.name,
  notes: row.notes,
  objectCount: row.object_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

/** Express gives us strings; anything that is not a positive integer cannot be
 *  a row id, so it is a miss rather than a query. */
const numericId = (id: string): number | null => {
  if (!/^[0-9]+$/.test(id)) return null
  const n = Number(id)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

export function createDesignDocumentRepository(db: SqliteDatabase): DesignDocumentRepository {
  // object_count is stored so a picker never has to parse every scene.
  const listAll = db.prepare<[string, string], SummaryRow>(`
    SELECT id, kind, name, notes, object_count, created_at, updated_at
    FROM design_documents
    WHERE owner_tenant_id = ? AND owner_oid = ?
    ORDER BY updated_at DESC, id DESC`)

  const listByKind = db.prepare<[string, string, string], SummaryRow>(`
    SELECT id, kind, name, notes, object_count, created_at, updated_at
    FROM design_documents
    WHERE owner_tenant_id = ? AND owner_oid = ? AND kind = ?
    ORDER BY updated_at DESC, id DESC`)

  const selectOne = db.prepare<[string, string, number], DocumentRow>(`
    SELECT id, kind, name, notes, doc_json, created_at, updated_at
    FROM design_documents
    WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?`)

  const insert = db.prepare(`
    INSERT INTO design_documents
      (owner_tenant_id, owner_oid, kind, name, notes, doc_json, object_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)

  const updateOne = db.prepare(`
    UPDATE design_documents
    SET kind = ?, name = ?, notes = ?, doc_json = ?, object_count = ?,
        updated_at = datetime('now')
    WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?`)

  const deleteOne = db.prepare(
    'DELETE FROM design_documents WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?')

  return {
    async list(owner: Owner, kind) {
      const rows = kind
        ? listByKind.all(owner.tenantId, owner.oid, kind)
        : listAll.all(owner.tenantId, owner.oid)
      return rows.map(toSummary)
    },

    async get(owner: Owner, id: string) {
      const rowId = numericId(id)
      if (rowId === null) return null
      const row = selectOne.get(owner.tenantId, owner.oid, rowId)
      return row ? toRecord(row) : null
    },

    async create(owner: Owner, input: DesignDocumentInput) {
      const result = insert.run(
        owner.tenantId, owner.oid, input.kind, input.name,
        input.notes ?? null, input.docJson, input.objectCount,
      )
      return { id: String(result.lastInsertRowid) }
    },

    async update(owner: Owner, id: string, input: DesignDocumentInput) {
      const rowId = numericId(id)
      if (rowId === null) return false
      const result = updateOne.run(
        input.kind, input.name, input.notes ?? null, input.docJson, input.objectCount,
        owner.tenantId, owner.oid, rowId,
      )
      return result.changes > 0
    },

    async clone(owner: Owner, id: string, name?: string, kind?: DesignDocumentKind) {
      const rowId = numericId(id)
      if (rowId === null) return null
      // One transaction so a clone is never half-made, matching cloneTx in the
      // keycap repository.
      const run = db.transaction((): { id: string } | null => {
        const row = selectOne.get(owner.tenantId, owner.oid, rowId)
        if (!row) return null
        const result = insert.run(
          owner.tenantId, owner.oid, kind ?? row.kind,
          name ?? `${row.name} copy`, row.notes, row.doc_json,
          countObjects(row.doc_json),
        )
        return { id: String(result.lastInsertRowid) }
      })
      return run()
    },

    async remove(owner: Owner, id: string) {
      const rowId = numericId(id)
      if (rowId === null) return false
      return deleteOne.run(owner.tenantId, owner.oid, rowId).changes > 0
    },
  }
}

/** A clone copies stored JSON verbatim, so the count is recomputed from it
 *  rather than trusted from a column that a hand-edited row could contradict. */
function countObjects(docJson: string): number {
  try {
    const parsed = JSON.parse(docJson) as { objects?: unknown[] }
    return Array.isArray(parsed.objects) ? parsed.objects.length : 0
  } catch {
    return 0
  }
}
