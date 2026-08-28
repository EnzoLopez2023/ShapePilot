import type { SqliteDatabase } from '../connection.ts'
import type { AuditEvent, AuditRepository } from './contracts.ts'

const MAX_DETAIL = 2_000
const MAX_FIELD = 256
const MAX_LIMIT = 500
const DEFAULT_LIMIT = 100
const MAX_ROWS = 50_000
const PRUNE_BATCH = 1_000
const PRUNE_INTERVAL = 100

/** Anything that looks like a credential never reaches the audit table. */
const REDACTED_KEY = /(token|secret|password|authorization|credential|key|jwt|assertion|cookie)/i

export function redactDetail(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (depth > 4) return '[depth]'
  if (typeof value === 'string') return value.slice(0, MAX_FIELD)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => redactDetail(entry, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
      out[key] = REDACTED_KEY.test(key) ? '[redacted]' : redactDetail(entry, depth + 1)
    }
    return out
  }
  return String(value).slice(0, MAX_FIELD)
}

const bounded = (value: string | null | undefined, max = MAX_FIELD): string | null =>
  value == null ? null : String(value).slice(0, max)

interface AuditRow {
  id: number | bigint
  occurred_at: string
  actor_tenant_id: string | null
  actor_oid: string | null
  category: string
  action: string
  outcome: string
  http_method: string | null
  http_path: string | null
  http_status: number | null
  request_id: string | null
  subject: string | null
  detail: string | null
}

const toEvent = (r: AuditRow): AuditEvent => ({
  id: String(r.id),
  occurredAt: r.occurred_at,
  actorTenantId: r.actor_tenant_id,
  actorOid: r.actor_oid,
  category: r.category,
  action: r.action,
  outcome: r.outcome,
  httpMethod: r.http_method,
  httpPath: r.http_path,
  httpStatus: r.http_status,
  requestId: r.request_id,
  subject: r.subject,
  detail: r.detail,
})

export function createAuditRepository(db: SqliteDatabase): AuditRepository {
  const insert = db.prepare(`
    INSERT INTO audit_events
      (actor_tenant_id, actor_oid, category, action, outcome,
       http_method, http_path, http_status, request_id, subject, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const prune = db.prepare(`
    DELETE FROM audit_events
     WHERE id IN (
       SELECT id
         FROM audit_events
        WHERE occurred_at < datetime('now', '-90 days')
           OR id < COALESCE((
             SELECT id
               FROM audit_events
              ORDER BY id DESC
              LIMIT 1 OFFSET ?
           ), -1)
        ORDER BY id
        LIMIT ${PRUNE_BATCH}
     )`)
  let recordsUntilPrune = 0

  return {
    async record(event) {
      const detail = event.detail === undefined
        ? null
        : JSON.stringify(redactDetail(event.detail)).slice(0, MAX_DETAIL)
      insert.run(
        event.owner?.tenantId ?? null,
        event.owner?.oid ?? null,
        bounded(event.category) ?? 'unknown',
        bounded(event.action) ?? 'unknown',
        event.outcome === 'failure' ? 'failure' : 'success',
        bounded(event.httpMethod, 16),
        bounded(event.httpPath, 512),
        Number.isInteger(event.httpStatus) ? event.httpStatus : null,
        bounded(event.requestId, 64),
        bounded(event.subject),
        detail,
      )
      recordsUntilPrune -= 1
      if (recordsUntilPrune <= 0) {
        prune.run(MAX_ROWS - 1)
        recordsUntilPrune = PRUNE_INTERVAL
      }
    },

    async list(query = {}) {
      const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
      const filters: string[] = []
      const params: (string | number)[] = []
      if (query.category) { filters.push('category = ?'); params.push(query.category) }
      if (query.actor) {
        filters.push('actor_tenant_id = ? AND actor_oid = ?')
        params.push(query.actor.tenantId, query.actor.oid)
      }
      if (query.before) { filters.push('occurred_at < ?'); params.push(query.before) }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
      return db.prepare<(string | number)[], AuditRow>(`
        SELECT * FROM audit_events ${where}
         ORDER BY occurred_at DESC, id DESC
         LIMIT ?`).all(...params, limit).map(toEvent)
    },
  }
}
