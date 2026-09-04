// Keycap tray repository.
//
// Ported from routes/keycap-trays.js at Hearth commit
// f0b05fc1dbf53e8aa26c215d8e858894a2793871. The SQL, ordering, transaction
// boundaries, defaults, null handling and returned field names are the pinned
// ones; the additions are owner scoping and typed results.
//
// Preserved deliberately:
//   * integer identity in SQLite, string ids over HTTP
//   * list order updated_at DESC, pocket order sort_order
//   * create and clone are one transaction each
//   * update replaces the whole pocket set atomically
//   * delete cascades through the foreign key
//   * `revision` is runtime-only and always leaves the server as 0
//   * `shape` is persisted because ShapePilot's ISO Enter editor depends on it
//     surviving save/open and clone
//   * `mirror_x` is a ShapePilot-defined 0-3 bitfield (bit0 mirrorX, bit1 flipY)
//     for in-place geometry mirror/flip. Legacy rows are 0/NULL, so import stays
//     byte-for-byte and no DDL changes.
import type { SqliteDatabase } from '../connection.ts'
import type {
  KeycapTrayRepository,
  LibraryPocketInput,
  LibraryPocketRecord,
  Owner,
  PocketInput,
  PocketRecord,
  TrayDesignInput,
  TrayDesignRecord,
  TrayDesignSummary,
  TrayProfileKind,
} from './contracts.ts'
import { DuplicateLibraryPocketError, InvalidProfileError } from './contracts.ts'

const POCKET_COLUMNS = `
  units, height_units, x_mm, y_mm, rotation_deg, is_through,
  label, label_mode, depth_mm, width_mm, height_mm, corner_mm, sort_order, shape, mirror_x,
  locating_posts_json`

interface DesignRow {
  id: number | bigint
  project_id: number | bigint | null
  name: string
  notes: string | null
  profile_kind: string
  profile_json: string
  sizing_json: string
  floor_mm: number
  depth_mm: number
  engrave_mm: number
  corner_spacers_json: string | null
  created_at: string
  updated_at: string
}

interface SummaryRow extends DesignRow {
  pocket_count: number
  project_name: string | null
}

interface PocketRow {
  id: number | bigint
  units: number
  height_units: number
  x_mm: number
  y_mm: number
  rotation_deg: number
  is_through: number
  shape: 'rect' | 'iso-enter' | null
  mirror_x: number | null
  label: string | null
  label_mode: string
  depth_mm: number | null
  width_mm: number | null
  height_mm: number | null
  corner_mm: number | null
  locating_posts_json: string | null
}

interface LibraryRow {
  id: number | bigint
  name: string
  units: number
  width_mm: number | null
  height_mm: number | null
  corner_mm: number | null
  notes: string | null
}

const rowToPocket = (r: PocketRow): PocketRecord => ({
  id: String(r.id),
  units: r.units,
  heightUnits: r.height_units,
  x: r.x_mm,
  y: r.y_mm,
  rotationDeg: r.rotation_deg,
  mirrorX: ((r.mirror_x ?? 0) & 1) !== 0,
  flipY: ((r.mirror_x ?? 0) & 2) !== 0,
  isThrough: !!r.is_through,
  shape: r.shape ?? undefined,
  label: r.label ?? undefined,
  labelMode: r.label_mode,
  depthMm: r.depth_mm ?? undefined,
  widthMm: r.width_mm ?? undefined,
  heightMm: r.height_mm ?? undefined,
  cornerRadiusMm: r.corner_mm ?? undefined,
  ...(r.locating_posts_json
    ? { locatingPosts: JSON.parse(r.locating_posts_json) as PocketRecord['locatingPosts'] }
    : {}),
})

const rowToDesign = (d: DesignRow, pockets: PocketRecord[]): TrayDesignRecord => ({
  id: String(d.id),
  projectId: d.project_id === null ? null : String(d.project_id),
  name: d.name,
  notes: d.notes ?? undefined,
  profile: {
    kind: d.profile_kind as TrayProfileKind,
    ...(JSON.parse(d.profile_json) as Record<string, unknown>),
  },
  sizing: JSON.parse(d.sizing_json) as Record<string, unknown>,
  floorThicknessMm: d.floor_mm,
  pocketDepthMm: d.depth_mm,
  engraveDepthMm: d.engrave_mm,
  ...(d.corner_spacers_json
    ? { cornerSpacers: JSON.parse(d.corner_spacers_json) as { heightMm: number; sizeMm: number } }
    : {}),
  pockets,
  createdAt: d.created_at,
  updatedAt: d.updated_at,
  revision: 0,
})

/**
 * The discriminant is stored in its own column so it can be queried; strip it
 * from the JSON blob to avoid two sources of truth.
 */
function splitProfile(profile: TrayDesignInput['profile']): { kind: string; json: string } {
  const { kind, ...rest } = profile ?? {}
  if (!kind || typeof kind !== 'string') throw new InvalidProfileError('profile.kind is required')
  return { kind, json: JSON.stringify(rest) }
}

/** `{heightMm,sizeMm}` -> JSON, anything else -> NULL. The route has validated it. */
const spacersJson = (input: TrayDesignInput): string | null =>
  input.cornerSpacers && typeof input.cornerSpacers === 'object'
    ? JSON.stringify(input.cornerSpacers)
    : null

interface PocketParams {
  design_id: number | bigint
  units: number
  height_units: number
  x_mm: number
  y_mm: number
  rotation_deg: number
  is_through: number
  label: string | null
  label_mode: string
  depth_mm: number | null
  width_mm: number | null
  height_mm: number | null
  corner_mm: number | null
  sort_order: number
  shape: 'rect' | 'iso-enter' | null
  mirror_x: number
  locating_posts_json: string | null
}

/** `{heightMm,outerDiameterMm,boreDiameterMm}` -> JSON, anything else -> NULL. The route has validated it. */
const locatingPostsJson = (p: PocketInput): string | null =>
  p.locatingPosts && typeof p.locatingPosts === 'object' ? JSON.stringify(p.locatingPosts) : null

const pocketParams = (designId: number | bigint, p: PocketInput, i: number): PocketParams => ({
  design_id: designId,
  units: p.units,
  height_units: p.heightUnits ?? 1,
  x_mm: p.x,
  y_mm: p.y,
  rotation_deg: p.rotationDeg ?? 0,
  is_through: p.isThrough ? 1 : 0,
  mirror_x: (p.mirrorX ? 1 : 0) | (p.flipY ? 2 : 0),
  label: p.label ?? null,
  label_mode: p.labelMode ?? 'guide',
  depth_mm: p.depthMm ?? null,
  width_mm: p.widthMm ?? null,
  height_mm: p.heightMm ?? null,
  corner_mm: p.cornerRadiusMm ?? null,
  sort_order: i,
  shape: p.shape ?? null,
  locating_posts_json: locatingPostsJson(p),
})

export function createKeycapTrayRepository(db: SqliteDatabase): KeycapTrayRepository {
  const insertPocket = db.prepare<[PocketParams]>(`
    INSERT INTO keycap_tray_pockets (design_id, ${POCKET_COLUMNS})
    VALUES (@design_id, @units, @height_units, @x_mm, @y_mm, @rotation_deg, @is_through,
            @label, @label_mode, @depth_mm, @width_mm, @height_mm, @corner_mm, @sort_order,
            @shape, @mirror_x, @locating_posts_json)`)

  const selectOwnedDesign = db.prepare<[string, string, string], DesignRow>(`
    SELECT id, project_id, name, notes, profile_kind, profile_json, sizing_json,
           floor_mm, depth_mm, engrave_mm, corner_spacers_json, created_at, updated_at
      FROM keycap_tray_designs
     WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?`)

  const selectPockets = db.prepare<[number | bigint], PocketRow>(
    'SELECT * FROM keycap_tray_pockets WHERE design_id = ? ORDER BY sort_order')

  const insertDesign = db.prepare(`
    INSERT INTO keycap_tray_designs
      (owner_tenant_id, owner_oid, project_id, name, notes, profile_kind, profile_json,
       sizing_json, floor_mm, depth_mm, engrave_mm, corner_spacers_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

  const deletePockets = db.prepare('DELETE FROM keycap_tray_pockets WHERE design_id = ?')

  const replacePockets = db.transaction((designId: number | bigint, pockets: PocketInput[]) => {
    deletePockets.run(designId)
    pockets.forEach((p, i) => insertPocket.run(pocketParams(designId, p, i)))
  })

  const createTx = db.transaction(
    (owner: Owner, input: TrayDesignInput, profile: { kind: string; json: string }) => {
      const info = insertDesign.run(
        owner.tenantId, owner.oid, input.projectId ?? null,
        input.name, input.notes ?? null, profile.kind, profile.json,
        JSON.stringify(input.sizing ?? {}),
        input.floorThicknessMm ?? 2.4, input.pocketDepthMm ?? 10, input.engraveDepthMm ?? 0.4,
        spacersJson(input))
      const id = info.lastInsertRowid
      ;(input.pockets ?? []).forEach((p, i) => insertPocket.run(pocketParams(id, p, i)))
      return id
    })

  const updateTx = db.transaction(
    (owner: Owner, id: string, input: TrayDesignInput, profile: { kind: string; json: string }) => {
      db.prepare(`
        UPDATE keycap_tray_designs
           SET name = ?, notes = ?, profile_kind = ?, profile_json = ?, sizing_json = ?,
               floor_mm = ?, depth_mm = ?, engrave_mm = ?, corner_spacers_json = ?,
               updated_at = datetime('now')
         WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?`).run(
        input.name, input.notes ?? null, profile.kind, profile.json,
        JSON.stringify(input.sizing ?? {}),
        input.floorThicknessMm ?? 2.4, input.pocketDepthMm ?? 10, input.engraveDepthMm ?? 0.4,
        spacersJson(input),
        owner.tenantId, owner.oid, id)
      // Written separately so an absent `projectId` leaves the link untouched:
      // the designer saves a tray without knowing which project owns it, and a
      // default would silently unassign it on every save.
      if (input.projectId !== undefined) {
        db.prepare(`
          UPDATE keycap_tray_designs SET project_id = ?
           WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?`).run(
          input.projectId, owner.tenantId, owner.oid, id)
      }
      replacePockets(idOf(db, owner, id), input.pockets ?? [])
    })

  const cloneTx = db.transaction((
    owner: Owner, source: DesignRow, name: string,
    projectId: number | bigint | string | null,
  ) => {
    const info = insertDesign.run(
      owner.tenantId, owner.oid, projectId,
      name, source.notes, source.profile_kind, source.profile_json, source.sizing_json,
      source.floor_mm, source.depth_mm, source.engrave_mm, source.corner_spacers_json)
    db.prepare(`
      INSERT INTO keycap_tray_pockets (design_id, ${POCKET_COLUMNS})
      SELECT ?, ${POCKET_COLUMNS} FROM keycap_tray_pockets WHERE design_id = ?`)
      .run(info.lastInsertRowid, source.id)
    return info.lastInsertRowid
  })

  return {
    async listDesigns(owner, projectId) {
      // Three filters, one statement each rather than a built-up string: the
      // SQL a route runs should be readable in full at the point it is written.
      const filter = projectId === undefined
        ? ''
        : projectId === null
          ? 'AND d.project_id IS NULL'
          : 'AND d.project_id = ?'
      const params: (string | null)[] = [owner.tenantId, owner.oid]
      if (typeof projectId === 'string') params.push(projectId)
      const rows = db.prepare<(string | null)[], SummaryRow>(`
        SELECT d.*, COUNT(p.id) AS pocket_count, k.name AS project_name
          FROM keycap_tray_designs d
          LEFT JOIN keycap_tray_pockets p ON p.design_id = d.id
          LEFT JOIN keycap_projects k ON k.id = d.project_id
         WHERE d.owner_tenant_id = ? AND d.owner_oid = ? ${filter}
         GROUP BY d.id
         ORDER BY d.updated_at DESC`).all(...params)
      return rows.map((r): TrayDesignSummary => ({
        id: String(r.id),
        projectId: r.project_id === null ? null : String(r.project_id),
        projectName: r.project_name,
        name: r.name,
        notes: r.notes ?? undefined,
        profileKind: r.profile_kind as TrayProfileKind,
        pocketCount: r.pocket_count,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }))
    },

    async getDesign(owner, id) {
      const d = selectOwnedDesign.get(owner.tenantId, owner.oid, id)
      if (!d) return null
      return rowToDesign(d, selectPockets.all(d.id).map(rowToPocket))
    },

    async createDesign(owner, input) {
      const profile = splitProfile(input.profile)
      return { id: String(createTx(owner, input, profile)) }
    },

    async updateDesign(owner, id, input) {
      const existing = selectOwnedDesign.get(owner.tenantId, owner.oid, id)
      if (!existing) return false
      const profile = splitProfile(input.profile)
      updateTx(owner, id, input, profile)
      return true
    },

    async cloneDesign(owner, id, name, projectId) {
      const src = selectOwnedDesign.get(owner.tenantId, owner.oid, id)
      if (!src) return null
      // Absent leaves the copy in the source's project; `null` unassigns it; an
      // id moves it, the route having already checked the caller owns that one.
      const target = projectId === undefined ? src.project_id : projectId
      return { id: String(cloneTx(owner, src, name || `${src.name} (copy)`, target)) }
    },

    async deleteDesign(owner, id) {
      const info = db.prepare(
        'DELETE FROM keycap_tray_designs WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?',
      ).run(owner.tenantId, owner.oid, id)
      return info.changes > 0
    },

    async listLibraryPockets(owner) {
      return db.prepare<[string, string], LibraryRow>(`
        SELECT id, name, units, width_mm, height_mm, corner_mm, notes
          FROM keycap_pocket_library
         WHERE owner_tenant_id = ? AND owner_oid = ?
         ORDER BY name`).all(owner.tenantId, owner.oid).map((r): LibraryPocketRecord => ({
          id: String(r.id),
          name: r.name,
          units: r.units,
          widthMm: r.width_mm ?? undefined,
          heightMm: r.height_mm ?? undefined,
          cornerRadiusMm: r.corner_mm ?? undefined,
          notes: r.notes ?? undefined,
        }))
    },

    async createLibraryPocket(owner, input: LibraryPocketInput) {
      try {
        const info = db.prepare(`
          INSERT INTO keycap_pocket_library
            (owner_tenant_id, owner_oid, name, units, width_mm, height_mm, corner_mm, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          owner.tenantId, owner.oid, input.name, input.units ?? 1,
          input.widthMm ?? null, input.heightMm ?? null,
          input.cornerRadiusMm ?? null, input.notes ?? null)
        return { id: String(info.lastInsertRowid) }
      } catch (error) {
        if (String((error as Error).message).includes('UNIQUE')) {
          throw new DuplicateLibraryPocketError(input.name)
        }
        throw error
      }
    },

    async deleteLibraryPocket(owner, id) {
      const info = db.prepare(
        'DELETE FROM keycap_pocket_library WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?',
      ).run(owner.tenantId, owner.oid, id)
      return info.changes > 0
    },
  }
}

/** Resolve the integer row id for an owned design; the caller has checked it exists. */
function idOf(db: SqliteDatabase, owner: Owner, id: string): number | bigint {
  const row = db.prepare<[string, string, string], { id: number | bigint }>(
    'SELECT id FROM keycap_tray_designs WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?',
  ).get(owner.tenantId, owner.oid, id)
  if (!row) throw new Error('design disappeared inside its own transaction')
  return row.id
}
