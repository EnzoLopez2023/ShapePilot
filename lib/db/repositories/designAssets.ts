import type { SqliteDatabase } from '../connection.ts'
import type {
  DesignAssetFormat, DesignAssetInput, DesignAssetRecord, DesignAssetRepository, Owner,
} from './contracts.ts'

interface AssetRow {
  hash: string
  filename: string
  format: string
  byte_length: number
  created_at: string
}

const toRecord = (row: AssetRow): DesignAssetRecord => ({
  hash: row.hash,
  filename: row.filename,
  format: row.format as DesignAssetFormat,
  byteLength: row.byte_length,
  createdAt: row.created_at,
})

export function createDesignAssetRepository(db: SqliteDatabase): DesignAssetRepository {
  const listAll = db.prepare<[string, string], AssetRow>(`
    SELECT hash, filename, format, byte_length, created_at
    FROM design_assets
    WHERE owner_tenant_id = ? AND owner_oid = ?
    ORDER BY created_at DESC, id DESC`)

  const selectOne = db.prepare<[string, string, string], AssetRow>(`
    SELECT hash, filename, format, byte_length, created_at
    FROM design_assets
    WHERE owner_tenant_id = ? AND owner_oid = ? AND hash = ?`)

  // Content-addressed, so re-recording the same bytes is a no-op rather than a
  // conflict. The filename is refreshed because the same content may arrive
  // under a better name later.
  const upsert = db.prepare(`
    INSERT INTO design_assets (owner_tenant_id, owner_oid, hash, filename, format, byte_length)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (owner_tenant_id, owner_oid, hash)
    DO UPDATE SET filename = excluded.filename`)

  return {
    async list(owner: Owner) {
      return listAll.all(owner.tenantId, owner.oid).map(toRecord)
    },

    async find(owner: Owner, hash: string) {
      const row = selectOne.get(owner.tenantId, owner.oid, hash)
      return row ? toRecord(row) : null
    },

    async record(owner: Owner, input: DesignAssetInput) {
      upsert.run(
        owner.tenantId, owner.oid, input.hash,
        input.filename, input.format, input.byteLength,
      )
      // Read back so the caller gets the stored created_at rather than guessing.
      return toRecord(selectOne.get(owner.tenantId, owner.oid, input.hash)!)
    },
  }
}
