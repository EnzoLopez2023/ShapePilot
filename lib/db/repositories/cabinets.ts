// Cabinet repository: the named cabinets saved from the cabinet designer.
//
// Keyed by `(owner, name)` so Save As over an existing name is one upsert, and
// list order is by name, which is how the Open dialog shows them.
import type { SqliteDatabase } from '../connection.ts'
import type { CabinetRepository } from './contracts.ts'

interface Row {
  name: string
  params_json: string
  updated_at: string
}

const parseObject = (json: string): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(json)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

export function createCabinetRepository(db: SqliteDatabase): CabinetRepository {
  const upsert = db.prepare(`
    INSERT INTO cabinet_designs (owner_tenant_id, owner_oid, name, params_json)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (owner_tenant_id, owner_oid, name)
    DO UPDATE SET params_json = excluded.params_json, updated_at = datetime('now')`)

  return {
    async list(owner) {
      return db.prepare<[string, string], Row>(`
        SELECT name, params_json, updated_at FROM cabinet_designs
         WHERE owner_tenant_id = ? AND owner_oid = ?
         ORDER BY name COLLATE NOCASE`)
        .all(owner.tenantId, owner.oid)
        .map(r => ({ name: r.name, params: parseObject(r.params_json), updatedAt: r.updated_at }))
    },

    async put(owner, name, params) {
      upsert.run(owner.tenantId, owner.oid, name, JSON.stringify(params))
    },

    async remove(owner, name) {
      const info = db.prepare(
        'DELETE FROM cabinet_designs WHERE owner_tenant_id = ? AND owner_oid = ? AND name = ?',
      ).run(owner.tenantId, owner.oid, name)
      return info.changes > 0
    },
  }
}
