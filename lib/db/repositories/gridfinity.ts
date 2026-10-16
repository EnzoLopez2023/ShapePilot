// Gridfinity repository: bins and baseplates, and the label lists their raised
// names are picked from.
//
// Conventions kept in step with `switchTrays.ts`: integer identity in SQLite and
// string ids over HTTP, list order `updated_at DESC`, and `revision`
// runtime-only and always leaving the server as 0. A design is one row of
// parameters -- the geometry is generated on the client.
import type { SqliteDatabase } from '../connection.ts'
import type {
  GridfinityDesignInput,
  GridfinityDesignRecord,
  GridfinityDesignSummary,
  GridfinityKind,
  GridfinityLabelList,
  GridfinityRepository,
  Owner,
} from './contracts.ts'
import { LABEL_SEEDS } from './gridfinityLabelSeeds.ts'

interface DesignRow {
  id: number | bigint
  name: string
  notes: string | null
  kind: string
  params_json: string
  created_at: string
  updated_at: string
}

interface ListRow {
  id: number | bigint
  name: string
  items_json: string
  created_at: string
  updated_at: string
}

const DESIGN_COLUMNS = 'id, name, notes, kind, params_json, created_at, updated_at'
const LIST_COLUMNS = 'id, name, items_json, created_at, updated_at'

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

const parseItems = (json: string): string[] => {
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

const rowToSummary = (d: DesignRow): GridfinityDesignSummary => ({
  id: String(d.id),
  name: d.name,
  notes: d.notes ?? undefined,
  kind: d.kind as GridfinityKind,
  params: parseObject(d.params_json),
  createdAt: d.created_at,
  updatedAt: d.updated_at,
})

const rowToDesign = (d: DesignRow): GridfinityDesignRecord => ({ ...rowToSummary(d), revision: 0 })

const rowToList = (l: ListRow): GridfinityLabelList => ({
  id: String(l.id),
  name: l.name,
  items: parseItems(l.items_json),
  createdAt: l.created_at,
  updatedAt: l.updated_at,
})

export function createGridfinityRepository(db: SqliteDatabase): GridfinityRepository {
  const selectDesign = db.prepare<[string, string, string], DesignRow>(`
    SELECT ${DESIGN_COLUMNS} FROM gridfinity_designs
     WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?`)

  const insertDesign = db.prepare(`
    INSERT INTO gridfinity_designs (owner_tenant_id, owner_oid, name, notes, kind, params_json)
    VALUES (?, ?, ?, ?, ?, ?)`)

  const selectList = db.prepare<[string, string, string], ListRow>(`
    SELECT ${LIST_COLUMNS} FROM gridfinity_label_lists
     WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?`)

  const insertList = db.prepare(`
    INSERT INTO gridfinity_label_lists (owner_tenant_id, owner_oid, name, items_json, item_count)
    VALUES (?, ?, ?, ?, ?)`)

  const seededKeys = db.prepare<[string, string], { seed_key: string }>(`
    SELECT seed_key FROM gridfinity_label_seeds WHERE owner_tenant_id = ? AND owner_oid = ?`)

  const markSeeded = db.prepare(`
    INSERT OR IGNORE INTO gridfinity_label_seeds (owner_tenant_id, owner_oid, seed_key)
    VALUES (?, ?, ?)`)

  /** Give the owner any starter list they have never had. One transaction each. */
  const seed = db.transaction((owner: Owner) => {
    const have = new Set(seededKeys.all(owner.tenantId, owner.oid).map(r => r.seed_key))
    for (const s of LABEL_SEEDS) {
      if (have.has(s.key)) continue
      insertList.run(owner.tenantId, owner.oid, s.name, JSON.stringify(s.items), s.items.length)
      markSeeded.run(owner.tenantId, owner.oid, s.key)
    }
  })

  return {
    async listDesigns(owner) {
      return db.prepare<[string, string], DesignRow>(`
        SELECT ${DESIGN_COLUMNS} FROM gridfinity_designs
         WHERE owner_tenant_id = ? AND owner_oid = ?
         ORDER BY updated_at DESC, id DESC`)
        .all(owner.tenantId, owner.oid)
        .map(rowToSummary)
    },

    async getDesign(owner, id) {
      const row = selectDesign.get(owner.tenantId, owner.oid, id)
      return row ? rowToDesign(row) : null
    },

    async createDesign(owner, input: GridfinityDesignInput) {
      const info = insertDesign.run(
        owner.tenantId, owner.oid, input.name, input.notes ?? null,
        input.kind, JSON.stringify(input.params))
      return { id: String(info.lastInsertRowid) }
    },

    async updateDesign(owner, id, input) {
      const info = db.prepare(`
        UPDATE gridfinity_designs
           SET name = ?, notes = ?, kind = ?, params_json = ?, updated_at = datetime('now')
         WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?`).run(
        input.name, input.notes ?? null, input.kind, JSON.stringify(input.params),
        owner.tenantId, owner.oid, id)
      return info.changes > 0
    },

    async cloneDesign(owner, id, name) {
      const src = selectDesign.get(owner.tenantId, owner.oid, id)
      if (!src) return null
      const info = insertDesign.run(
        owner.tenantId, owner.oid, name ?? `${src.name} copy`, src.notes, src.kind, src.params_json)
      return { id: String(info.lastInsertRowid) }
    },

    async deleteDesign(owner, id) {
      const info = db.prepare(
        'DELETE FROM gridfinity_designs WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?',
      ).run(owner.tenantId, owner.oid, id)
      return info.changes > 0
    },

    async listLabelLists(owner) {
      seed(owner)
      return db.prepare<[string, string], ListRow>(`
        SELECT ${LIST_COLUMNS} FROM gridfinity_label_lists
         WHERE owner_tenant_id = ? AND owner_oid = ?
         ORDER BY name COLLATE NOCASE, id`)
        .all(owner.tenantId, owner.oid)
        .map(rowToList)
    },

    async getLabelList(owner, id) {
      const row = selectList.get(owner.tenantId, owner.oid, id)
      return row ? rowToList(row) : null
    },

    async createLabelList(owner, input) {
      const info = insertList.run(
        owner.tenantId, owner.oid, input.name, JSON.stringify(input.items), input.items.length)
      return { id: String(info.lastInsertRowid) }
    },

    async updateLabelList(owner, id, input) {
      const info = db.prepare(`
        UPDATE gridfinity_label_lists
           SET name = ?, items_json = ?, item_count = ?, updated_at = datetime('now')
         WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?`).run(
        input.name, JSON.stringify(input.items), input.items.length,
        owner.tenantId, owner.oid, id)
      return info.changes > 0
    },

    async deleteLabelList(owner, id) {
      const info = db.prepare(
        'DELETE FROM gridfinity_label_lists WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?',
      ).run(owner.tenantId, owner.oid, id)
      return info.changes > 0
    },
  }
}
