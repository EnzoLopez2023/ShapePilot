// Tool tray repository.
//
// One table, one row per tray, no companion row table -- and unlike the keycap
// tray, that is true even though the pockets are *placed* rather than
// generated. A tool pocket is a nested thing: an ordered list of extruded
// steps, each with its own footprint and depth, and eventually a traced
// outline. Nothing will ever query into one, so it stays a blob and a create is
// a single INSERT with no transaction, the way the switch tray works.
//
// `pocket_count` is written alongside so `listDesigns` never parses that blob.
// The list is the hot path and a tray carrying traced outlines is not something
// to deserialise just to say "12 pockets".
//
// Conventions kept in step with the siblings: integer identity in SQLite and
// string ids over HTTP, list order `updated_at DESC`, the profile discriminant
// in its own column, and `revision` runtime-only and always leaving the server
// as 0.
import type { SqliteDatabase } from '../connection.ts'
import type {
  ToolTrayInput,
  ToolTrayRecord,
  ToolTrayRepository,
  ToolTraySummary,
  TrayProfileKind,
} from './contracts.ts'
import { InvalidProfileError } from './contracts.ts'

const COLUMNS = `
  id, name, notes, profile_kind, profile_json, height_mm, layer_height_mm, min_floor_mm,
  pockets_json, pocket_count, feet_json, underside_relief, case_clear_mm, created_at, updated_at`

interface DesignRow {
  id: number | bigint
  name: string
  notes: string | null
  profile_kind: string
  profile_json: string
  height_mm: number
  layer_height_mm: number
  min_floor_mm: number
  pockets_json: string
  pocket_count: number
  feet_json: string | null
  underside_relief: string | null
  case_clear_mm: number | null
  created_at: string
  updated_at: string
}

const parse = <T>(json: string): T => JSON.parse(json) as T

const rowToDesign = (d: DesignRow): ToolTrayRecord => ({
  id: String(d.id),
  name: d.name,
  notes: d.notes ?? undefined,
  profile: {
    kind: d.profile_kind as TrayProfileKind,
    ...parse<Record<string, unknown>>(d.profile_json),
  },
  heightMm: d.height_mm,
  layerHeightMm: d.layer_height_mm,
  minFloorMm: d.min_floor_mm,
  pockets: parse<Record<string, unknown>[]>(d.pockets_json),
  ...(d.feet_json ? { feet: parse<Record<string, unknown>>(d.feet_json) } : {}),
  ...(d.underside_relief === null ? {} : { undersideReliefs: d.underside_relief }),
  ...(d.case_clear_mm === null ? {} : { caseClearHeightMm: d.case_clear_mm }),
  createdAt: d.created_at,
  updatedAt: d.updated_at,
  revision: 0,
})

/** What the picker needs. Reads the count from its own column, never the blob. */
const rowToSummary = (d: DesignRow): ToolTraySummary => ({
  id: String(d.id),
  name: d.name,
  notes: d.notes ?? undefined,
  profileKind: d.profile_kind as TrayProfileKind,
  pocketCount: d.pocket_count,
  createdAt: d.created_at,
  updatedAt: d.updated_at,
})

/**
 * The discriminant is stored in its own column so it can be queried; strip it
 * from the JSON blob to avoid two sources of truth. Same split the sibling
 * repositories do.
 */
function splitProfile(profile: ToolTrayInput['profile']): { kind: string; json: string } {
  const { kind, ...rest } = profile ?? {}
  if (!kind || typeof kind !== 'string') throw new InvalidProfileError('profile.kind is required')
  return { kind, json: JSON.stringify(rest) }
}

/** An absent or null optional blob is stored as NULL, never as `"null"`. */
const blob = (value: unknown): string | null =>
  value === undefined || value === null ? null : JSON.stringify(value)

/** The count that rides beside the blob. Validation guarantees an array. */
const countOf = (pockets: unknown): number => (Array.isArray(pockets) ? pockets.length : 0)

export function createToolTrayRepository(db: SqliteDatabase): ToolTrayRepository {
  const selectOwned = db.prepare<[string, string, string], DesignRow>(`
    SELECT ${COLUMNS}
      FROM tool_tray_designs
     WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?`)

  const insert = db.prepare(`
    INSERT INTO tool_tray_designs
      (owner_tenant_id, owner_oid, name, notes, profile_kind, profile_json, height_mm,
       layer_height_mm, min_floor_mm, pockets_json, pocket_count, feet_json,
       underside_relief, case_clear_mm)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

  return {
    async listDesigns(owner) {
      return db.prepare<[string, string], DesignRow>(`
        SELECT ${COLUMNS}
          FROM tool_tray_designs
         WHERE owner_tenant_id = ? AND owner_oid = ?
         ORDER BY updated_at DESC, id DESC`)
        .all(owner.tenantId, owner.oid)
        .map(rowToSummary)
    },

    async getDesign(owner, id) {
      const row = selectOwned.get(owner.tenantId, owner.oid, id)
      return row ? rowToDesign(row) : null
    },

    async createDesign(owner, input) {
      const profile = splitProfile(input.profile)
      const info = insert.run(
        owner.tenantId, owner.oid, input.name, input.notes ?? null,
        profile.kind, profile.json,
        input.heightMm as number, input.layerHeightMm as number, input.minFloorMm as number,
        JSON.stringify(input.pockets), countOf(input.pockets),
        blob(input.feet), input.undersideReliefs ?? null, input.caseClearHeightMm ?? null)
      return { id: String(info.lastInsertRowid) }
    },

    async updateDesign(owner, id, input) {
      const profile = splitProfile(input.profile)
      const info = db.prepare(`
        UPDATE tool_tray_designs
           SET name = ?, notes = ?, profile_kind = ?, profile_json = ?, height_mm = ?,
               layer_height_mm = ?, min_floor_mm = ?, pockets_json = ?, pocket_count = ?,
               feet_json = ?, underside_relief = ?, case_clear_mm = ?,
               updated_at = datetime('now')
         WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?`).run(
        input.name, input.notes ?? null, profile.kind, profile.json,
        input.heightMm as number, input.layerHeightMm as number, input.minFloorMm as number,
        JSON.stringify(input.pockets), countOf(input.pockets),
        blob(input.feet), input.undersideReliefs ?? null, input.caseClearHeightMm ?? null,
        owner.tenantId, owner.oid, id)
      return info.changes > 0
    },

    async cloneDesign(owner, id, name) {
      const src = selectOwned.get(owner.tenantId, owner.oid, id)
      if (!src) return null
      // Re-inserted verbatim: a clone is the same tray, not a re-derivation of it.
      const info = insert.run(
        owner.tenantId, owner.oid, name ?? `${src.name} copy`, src.notes,
        src.profile_kind, src.profile_json, src.height_mm, src.layer_height_mm,
        src.min_floor_mm, src.pockets_json, src.pocket_count, src.feet_json,
        src.underside_relief, src.case_clear_mm)
      return { id: String(info.lastInsertRowid) }
    },

    async deleteDesign(owner, id) {
      const info = db.prepare(
        'DELETE FROM tool_tray_designs WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?',
      ).run(owner.tenantId, owner.oid, id)
      return info.changes > 0
    },
  }
}
