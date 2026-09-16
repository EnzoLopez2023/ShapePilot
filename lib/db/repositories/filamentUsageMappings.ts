// Filament usage mapping repository.
//
// Replaced wholesale in one transaction, exactly as the inventory is: the page
// holds the list, sends the list, and a half-applied set of links is never a
// state the database can be in.
import type { SqliteDatabase } from '../connection.ts'
import type { FilamentUsageMapping } from '../../contracts/filamentUsage.ts'
import type { FilamentUsageMappingRepository, Owner } from './contracts.ts'

interface MappingRow {
  material: string
  filament_id: string
  color: string
  filament_key: string | null
}

const rowToMapping = (row: MappingRow): FilamentUsageMapping => ({
  source: { material: row.material, filamentId: row.filament_id, color: row.color },
  key: row.filament_key,
})

export function createFilamentUsageMappingRepository(
  db: SqliteDatabase,
): FilamentUsageMappingRepository {
  const selectAll = db.prepare<[string, string], MappingRow>(`
    SELECT material, filament_id, color, filament_key
      FROM filament_usage_mappings
     WHERE owner_tenant_id = ? AND owner_oid = ?
     ORDER BY material, filament_id, color`)

  const deleteAll = db.prepare(
    'DELETE FROM filament_usage_mappings WHERE owner_tenant_id = ? AND owner_oid = ?')

  const insert = db.prepare(`
    INSERT INTO filament_usage_mappings
      (owner_tenant_id, owner_oid, material, filament_id, color, filament_key)
    VALUES (?, ?, ?, ?, ?, ?)`)

  const replaceTx = db.transaction((owner: Owner, mappings: readonly FilamentUsageMapping[]) => {
    deleteAll.run(owner.tenantId, owner.oid)
    for (const { source, key } of mappings) {
      insert.run(owner.tenantId, owner.oid, source.material, source.filamentId, source.color, key)
    }
  })

  return {
    async list(owner) {
      return selectAll.all(owner.tenantId, owner.oid).map(rowToMapping)
    },
    async replace(owner, mappings) {
      replaceTx(owner, mappings)
      return selectAll.all(owner.tenantId, owner.oid).map(rowToMapping)
    },
  }
}
