// Filament inventory repository.
//
// The inventory is replaced wholesale on write, exactly as a project's set
// items are: the page holds the whole tick set, sends the whole tick set, and a
// half-applied inventory is never a state the database can be in. That also
// makes "own every colour in this line" one statement rather than thirty-two.
//
// Rows are only ever inserted and deleted, never updated -- a tick is not a
// value that changes.
import type { SqliteDatabase } from '../connection.ts'
import type {
  FilamentInventoryEntry,
  FilamentInventoryRepository,
  Owner,
} from './contracts.ts'

interface EntryRow {
  filament_key: string
  variant: 'spool' | 'refill'
}

const rowToEntry = (row: EntryRow): FilamentInventoryEntry => ({
  key: row.filament_key,
  variant: row.variant,
})

export function createFilamentInventoryRepository(
  db: SqliteDatabase,
): FilamentInventoryRepository {
  // Ordered so the wire shape is stable: two identical inventories always read
  // back identically, which is what lets the client compare cheaply.
  const selectOwned = db.prepare<[string, string], EntryRow>(`
    SELECT filament_key, variant
      FROM filament_inventory
     WHERE owner_tenant_id = ? AND owner_oid = ?
     ORDER BY filament_key, variant`)

  const deleteOwned = db.prepare(
    'DELETE FROM filament_inventory WHERE owner_tenant_id = ? AND owner_oid = ?')

  const insertEntry = db.prepare(`
    INSERT INTO filament_inventory (owner_tenant_id, owner_oid, filament_key, variant)
    VALUES (?, ?, ?, ?)`)

  const replaceTx = db.transaction(
    (owner: Owner, entries: readonly FilamentInventoryEntry[]) => {
      deleteOwned.run(owner.tenantId, owner.oid)
      for (const entry of entries) {
        insertEntry.run(owner.tenantId, owner.oid, entry.key, entry.variant)
      }
    })

  return {
    async list(owner) {
      return selectOwned.all(owner.tenantId, owner.oid).map(rowToEntry)
    },

    async replace(owner, entries) {
      replaceTx(owner, entries)
      // Read back rather than echoing the input: the caller is told what the
      // database holds, in the order it will hold it on every later read.
      return selectOwned.all(owner.tenantId, owner.oid).map(rowToEntry)
    },
  }
}
