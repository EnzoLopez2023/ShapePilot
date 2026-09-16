// X2D maintenance repository: the profile, and the service log.
//
// The two halves behave differently on purpose. The profile is replaced
// wholesale -- it is four settings and one row, and there is no such thing as
// half of it. The log is append-only in normal use: logging a service inserts,
// it never updates the previous one, because overwriting last quarter's entry
// with this quarter's is how a maintenance record stops being a record.
//
// Deleting an event exists only so a mis-logged date can be taken back, and it
// is owner-scoped in the same statement as the delete rather than in a read
// first -- a check-then-delete would be two statements racing over one row.
import type { SqliteDatabase } from '../connection.ts'
import type {
  MaintenanceEvent,
  MaintenanceEventInput,
  MaintenanceProfile,
  MaintenanceRepository,
} from './contracts.ts'

interface ProfileRow {
  commissioned_on: string
  usage_tier: MaintenanceProfile['usageTier']
  filament_wear: MaintenanceProfile['filamentWear']
  rolls_used: number
}

interface EventRow {
  id: number
  task_key: string
  performed_on: string
  note: string | null
  created_at: string
}

const rowToProfile = (row: ProfileRow): MaintenanceProfile => ({
  commissionedOn: row.commissioned_on,
  usageTier: row.usage_tier,
  filamentWear: row.filament_wear,
  rollsUsed: row.rolls_used,
})

const rowToEvent = (row: EventRow): MaintenanceEvent => ({
  id: row.id,
  taskKey: row.task_key,
  performedOn: row.performed_on,
  note: row.note,
  createdAt: row.created_at,
})

export function createMaintenanceRepository(db: SqliteDatabase): MaintenanceRepository {
  const selectProfile = db.prepare<[string, string], ProfileRow>(`
    SELECT commissioned_on, usage_tier, filament_wear, rolls_used
      FROM maintenance_profile
     WHERE owner_tenant_id = ? AND owner_oid = ?`)

  // One upsert rather than a read and a branch: the first save and the
  // hundredth are the same statement, and neither can interleave with the other.
  const upsertProfile = db.prepare(`
    INSERT INTO maintenance_profile
      (owner_tenant_id, owner_oid, commissioned_on, usage_tier, filament_wear, rolls_used)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (owner_tenant_id, owner_oid) DO UPDATE SET
      commissioned_on = excluded.commissioned_on,
      usage_tier      = excluded.usage_tier,
      filament_wear   = excluded.filament_wear,
      rolls_used      = excluded.rolls_used,
      updated_at      = datetime('now')`)

  // Newest first, and `id DESC` after the date so two services logged for the
  // same day still have one definite order -- the one they were entered in.
  const selectEvents = db.prepare<[string, string], EventRow>(`
    SELECT id, task_key, performed_on, note, created_at
      FROM maintenance_events
     WHERE owner_tenant_id = ? AND owner_oid = ?
     ORDER BY performed_on DESC, id DESC`)

  const selectEvent = db.prepare<[number], EventRow>(`
    SELECT id, task_key, performed_on, note, created_at
      FROM maintenance_events WHERE id = ?`)

  const insertEvent = db.prepare(`
    INSERT INTO maintenance_events (owner_tenant_id, owner_oid, task_key, performed_on, note)
    VALUES (?, ?, ?, ?, ?)`)

  const deleteEvent = db.prepare(
    'DELETE FROM maintenance_events WHERE id = ? AND owner_tenant_id = ? AND owner_oid = ?')

  return {
    async readProfile(owner) {
      const row = selectProfile.get(owner.tenantId, owner.oid)
      return row ? rowToProfile(row) : null
    },

    async writeProfile(owner, profile) {
      upsertProfile.run(
        owner.tenantId,
        owner.oid,
        profile.commissionedOn,
        profile.usageTier,
        profile.filamentWear,
        profile.rollsUsed,
      )
      // Read back rather than echoing the input, so the caller is told what the
      // database holds and not what it was asked to hold.
      return rowToProfile(selectProfile.get(owner.tenantId, owner.oid) as ProfileRow)
    },

    async listEvents(owner) {
      return selectEvents.all(owner.tenantId, owner.oid).map(rowToEvent)
    },

    async logEvent(owner, input: MaintenanceEventInput) {
      const result = insertEvent.run(
        owner.tenantId,
        owner.oid,
        input.taskKey,
        input.performedOn,
        input.note ?? null,
      )
      return rowToEvent(selectEvent.get(Number(result.lastInsertRowid)) as EventRow)
    },

    async deleteEvent(owner, id) {
      return deleteEvent.run(id, owner.tenantId, owner.oid).changes > 0
    },
  }
}
