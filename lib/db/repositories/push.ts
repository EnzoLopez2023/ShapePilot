// Push subscription and reorder-alert repository.
//
// Subscriptions are keyed by endpoint rather than by (owner, endpoint): the
// endpoint is issued to one browser, and a browser signed into by a second
// account should reach the second account, not both.
import type { SqliteDatabase } from '../connection.ts'
import type { Owner, PushRepository, StoredPushSubscription } from './contracts.ts'

interface SubscriptionRow {
  owner_tenant_id: string
  owner_oid: string
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
  last_sent_at: string | null
}

const rowToSubscription = (row: SubscriptionRow): StoredPushSubscription => ({
  owner: { tenantId: row.owner_tenant_id, oid: row.owner_oid },
  endpoint: row.endpoint,
  keys: { p256dh: row.p256dh, auth: row.auth },
  userAgent: row.user_agent,
  lastSentAt: row.last_sent_at,
})

export function createPushRepository(db: SqliteDatabase): PushRepository {
  const upsert = db.prepare(`
    INSERT INTO push_subscriptions
      (owner_tenant_id, owner_oid, endpoint, p256dh, auth, user_agent)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (endpoint) DO UPDATE SET
      owner_tenant_id = excluded.owner_tenant_id,
      owner_oid       = excluded.owner_oid,
      p256dh          = excluded.p256dh,
      auth            = excluded.auth,
      user_agent      = excluded.user_agent`)

  const removeOwned = db.prepare(
    'DELETE FROM push_subscriptions WHERE endpoint = ? AND owner_tenant_id = ? AND owner_oid = ?')
  const remove = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')

  const selectForOwner = db.prepare<[string, string], SubscriptionRow>(`
    SELECT owner_tenant_id, owner_oid, endpoint, p256dh, auth, user_agent, last_sent_at
      FROM push_subscriptions
     WHERE owner_tenant_id = ? AND owner_oid = ?
     ORDER BY id`)

  const selectOwners = db.prepare<[], { owner_tenant_id: string; owner_oid: string }>(`
    SELECT DISTINCT owner_tenant_id, owner_oid FROM push_subscriptions
     ORDER BY owner_tenant_id, owner_oid`)

  const sent = db.prepare('UPDATE push_subscriptions SET last_sent_at = ? WHERE endpoint = ?')

  const selectAlerted = db.prepare<[string, string], { filament_key: string }>(`
    SELECT filament_key FROM filament_reorder_alerts
     WHERE owner_tenant_id = ? AND owner_oid = ? ORDER BY filament_key`)
  const insertAlert = db.prepare(`
    INSERT OR IGNORE INTO filament_reorder_alerts (owner_tenant_id, owner_oid, filament_key)
    VALUES (?, ?, ?)`)
  const deleteAlert = db.prepare(`
    DELETE FROM filament_reorder_alerts
     WHERE owner_tenant_id = ? AND owner_oid = ? AND filament_key = ?`)

  const alertsTx = db.transaction((owner: Owner, add: readonly string[], clear: readonly string[]) => {
    for (const key of add) insertAlert.run(owner.tenantId, owner.oid, key)
    for (const key of clear) deleteAlert.run(owner.tenantId, owner.oid, key)
  })

  return {
    async subscribe(owner, input) {
      upsert.run(owner.tenantId, owner.oid, input.endpoint, input.keys.p256dh, input.keys.auth,
        input.userAgent ?? null)
    },
    async unsubscribe(owner, endpoint) {
      return removeOwned.run(endpoint, owner.tenantId, owner.oid).changes > 0
    },
    async forget(endpoint) {
      remove.run(endpoint)
    },
    async listForOwner(owner) {
      return selectForOwner.all(owner.tenantId, owner.oid).map(rowToSubscription)
    },
    async listOwners() {
      return selectOwners.all().map(row => ({ tenantId: row.owner_tenant_id, oid: row.owner_oid }))
    },
    async markSent(endpoint, at) {
      sent.run(at, endpoint)
    },
    async alertedKeys(owner) {
      return selectAlerted.all(owner.tenantId, owner.oid).map(row => row.filament_key)
    },
    async updateAlerts(owner, add, clear) {
      alertsTx(owner, add, clear)
    },
  }
}
