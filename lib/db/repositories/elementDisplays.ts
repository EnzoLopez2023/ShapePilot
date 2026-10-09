import type { SqliteDatabase } from '../connection.ts'
import type { Owner } from './contracts.ts'
import type { DisplayGrant } from '../../contracts/elementDisplay.ts'

export interface DisplayRecord extends DisplayGrant {
  tokenHash: string
  pairingCode: string | null
  owner: Owner | null
}

export interface ElementDisplayRepository {
  create(id: string, tokenHash: string, code: string, now: string, expiresAt: string): Promise<boolean>
  find(tokenHash: string, now: string): Promise<DisplayRecord | null>
  approve(code: string, owner: Owner, connectionId: string, label: string, now: string, expiresAt: string): Promise<boolean>
  list(owner: Owner, now: string): Promise<DisplayGrant[]>
  revoke(id: string, owner: Owner): Promise<boolean>
}

interface Row {
  id: string
  token_hash: string
  pairing_code: string | null
  label: string
  connection_id: string | null
  tenant_id: string | null
  oid: string | null
  created_at: string
  expires_at: string
}

function grant(row: Row): DisplayGrant {
  return {
    id: row.id, label: row.label, connectionId: row.connection_id ?? '',
    createdAt: row.created_at, expiresAt: row.expires_at,
  }
}

export function createElementDisplayRepository(db: SqliteDatabase): ElementDisplayRepository {
  const create = db.transaction((id: string, hash: string, code: string, now: string, expiry: string) => {
    db.prepare('DELETE FROM element_displays WHERE expires_at <= ?').run(now)
    const count = db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM element_displays').get()
    if (!count || count.count >= 100) return false
    db.prepare(`INSERT INTO element_displays
      (id, token_hash, pairing_code, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`)
      .run(id, hash, code, now, expiry)
    return true
  })
  return {
    async create(id, hash, code, now, expiry) { return create(id, hash, code, now, expiry) },
    async find(hash, now) {
      const row = db.prepare<[string, string], Row>(
        'SELECT * FROM element_displays WHERE token_hash = ? AND expires_at > ?').get(hash, now)
      return row ? {
        ...grant(row), tokenHash: row.token_hash, pairingCode: row.pairing_code,
        owner: row.tenant_id && row.oid ? { tenantId: row.tenant_id, oid: row.oid } : null,
      } : null
    },
    async approve(code, owner, connectionId, label, now, expiry) {
      return db.prepare(`UPDATE element_displays SET pairing_code = NULL,
        tenant_id = ?, oid = ?, connection_id = ?, label = ?, expires_at = ?
        WHERE pairing_code = ? AND expires_at > ? AND tenant_id IS NULL`)
        .run(owner.tenantId, owner.oid, connectionId, label, expiry, code, now).changes === 1
    },
    async list(owner, now) {
      return db.prepare<[string, string, string], Row>(`SELECT * FROM element_displays
        WHERE tenant_id = ? AND oid = ? AND expires_at > ? ORDER BY created_at DESC`)
        .all(owner.tenantId, owner.oid, now).map(grant)
    },
    async revoke(id, owner) {
      return db.prepare('DELETE FROM element_displays WHERE id = ? AND tenant_id = ? AND oid = ?')
        .run(id, owner.tenantId, owner.oid).changes === 1
    },
  }
}
