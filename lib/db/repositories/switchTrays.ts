// Switch tray repository.
//
// Much shorter than its keycap sibling, and deliberately: a switch tray has no
// cell rows to write. Every cell is the same square and the layout is generated
// from the pitch, margin and outline, so a create is one INSERT and a read is
// one SELECT however many hundred switches the tray holds. There is no
// transaction anywhere in here for the same reason.
//
// Conventions kept in step with `keycapTrays.ts`: integer identity in SQLite and
// string ids over HTTP, list order `updated_at DESC`, the profile discriminant
// in its own column so it can be queried, and `revision` runtime-only and always
// leaving the server as 0.
import type { SqliteDatabase } from '../connection.ts'
import type {
  Owner,
  SwitchTrayInput,
  SwitchTrayRecord,
  SwitchTrayRepository,
  SwitchTraySummary,
  TrayProfileKind,
} from './contracts.ts'
import { InvalidProfileError } from './contracts.ts'

const COLUMNS = `
  id, name, notes, profile_kind, profile_json, switch_json, plate_json, fill_json,
  feet_json, nameplate_json, skipped_cells_json, case_clear_mm, created_at, updated_at`

interface DesignRow {
  id: number | bigint
  name: string
  notes: string | null
  profile_kind: string
  profile_json: string
  switch_json: string
  plate_json: string
  fill_json: string
  feet_json: string | null
  nameplate_json: string | null
  skipped_cells_json: string | null
  case_clear_mm: number | null
  created_at: string
  updated_at: string
}

const parse = <T>(json: string): T => JSON.parse(json) as T

const rowToDesign = (d: DesignRow): SwitchTrayRecord => ({
  id: String(d.id),
  name: d.name,
  notes: d.notes ?? undefined,
  profile: {
    kind: d.profile_kind as TrayProfileKind,
    ...parse<Record<string, unknown>>(d.profile_json),
  },
  switch: parse<Record<string, unknown>>(d.switch_json),
  plate: parse<Record<string, unknown>>(d.plate_json),
  fill: parse<Record<string, unknown>>(d.fill_json),
  ...(d.feet_json ? { feet: parse<Record<string, unknown>>(d.feet_json) } : {}),
  ...(d.nameplate_json
    ? { nameplate: parse<SwitchTrayRecord['nameplate']>(d.nameplate_json) }
    : {}),
  ...(d.skipped_cells_json ? { skippedCells: parse<string[]>(d.skipped_cells_json) } : {}),
  ...(d.case_clear_mm === null ? {} : { caseClearHeightMm: d.case_clear_mm }),
  createdAt: d.created_at,
  updatedAt: d.updated_at,
  revision: 0,
})

/** What the picker needs, without parsing the geometry blobs. */
const rowToSummary = (d: DesignRow): SwitchTraySummary => ({
  id: String(d.id),
  name: d.name,
  notes: d.notes ?? undefined,
  profileKind: d.profile_kind as TrayProfileKind,
  switchLabel: switchLabelOf(d.switch_json),
  createdAt: d.created_at,
  updatedAt: d.updated_at,
})

/**
 * The switch's own name, for the list. A blob that predates a field, or one
 * written by a client that did not send a label, reads as an empty string
 * rather than making the whole list unreadable.
 */
function switchLabelOf(json: string): string {
  try {
    const label = (parse<Record<string, unknown>>(json)).label
    return typeof label === 'string' ? label : ''
  } catch {
    return ''
  }
}

/**
 * The discriminant is stored in its own column so it can be queried; strip it
 * from the JSON blob to avoid two sources of truth. Same split the keycap tray
 * repository does.
 */
function splitProfile(profile: SwitchTrayInput['profile']): { kind: string; json: string } {
  const { kind, ...rest } = profile ?? {}
  if (!kind || typeof kind !== 'string') throw new InvalidProfileError('profile.kind is required')
  return { kind, json: JSON.stringify(rest) }
}

/** An absent or null optional blob is stored as NULL, never as `"null"`. */
const blob = (value: unknown): string | null =>
  value === undefined || value === null ? null : JSON.stringify(value)

export function createSwitchTrayRepository(db: SqliteDatabase): SwitchTrayRepository {
  const selectOwned = db.prepare<[string, string, string], DesignRow>(`
    SELECT ${COLUMNS}
      FROM switch_tray_designs
     WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?`)

  const insert = db.prepare(`
    INSERT INTO switch_tray_designs
      (owner_tenant_id, owner_oid, name, notes, profile_kind, profile_json, switch_json,
       plate_json, fill_json, feet_json, nameplate_json, skipped_cells_json, case_clear_mm)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

  const insertParams = (
    owner: Owner, input: SwitchTrayInput, profile: { kind: string; json: string },
  ) => [
    owner.tenantId, owner.oid, input.name, input.notes ?? null,
    profile.kind, profile.json,
    JSON.stringify(input.switch), JSON.stringify(input.plate), JSON.stringify(input.fill),
    blob(input.feet), blob(input.nameplate), blob(input.skippedCells),
    input.caseClearHeightMm ?? null,
  ] as const

  return {
    async listDesigns(owner) {
      return db.prepare<[string, string], DesignRow>(`
        SELECT ${COLUMNS}
          FROM switch_tray_designs
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
      const info = insert.run(...insertParams(owner, input, splitProfile(input.profile)))
      return { id: String(info.lastInsertRowid) }
    },

    async updateDesign(owner, id, input) {
      const profile = splitProfile(input.profile)
      const info = db.prepare(`
        UPDATE switch_tray_designs
           SET name = ?, notes = ?, profile_kind = ?, profile_json = ?, switch_json = ?,
               plate_json = ?, fill_json = ?, feet_json = ?, nameplate_json = ?,
               skipped_cells_json = ?, case_clear_mm = ?, updated_at = datetime('now')
         WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?`).run(
        input.name, input.notes ?? null, profile.kind, profile.json,
        JSON.stringify(input.switch), JSON.stringify(input.plate), JSON.stringify(input.fill),
        blob(input.feet), blob(input.nameplate), blob(input.skippedCells),
        input.caseClearHeightMm ?? null,
        owner.tenantId, owner.oid, id)
      return info.changes > 0
    },

    async cloneDesign(owner, id, name) {
      const src = selectOwned.get(owner.tenantId, owner.oid, id)
      if (!src) return null
      const info = insert.run(
        owner.tenantId, owner.oid, name ?? `${src.name} copy`, src.notes,
        src.profile_kind, src.profile_json, src.switch_json,
        src.plate_json, src.fill_json, src.feet_json, src.nameplate_json,
        src.skipped_cells_json, src.case_clear_mm)
      return { id: String(info.lastInsertRowid) }
    },

    async deleteDesign(owner, id) {
      const info = db.prepare(
        'DELETE FROM switch_tray_designs WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?',
      ).run(owner.tenantId, owner.oid, id)
      return info.changes > 0
    },
  }
}
