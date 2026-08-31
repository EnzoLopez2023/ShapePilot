// Keycap project repository.
//
// A project is one keycap set. Its set items are replaced wholesale on update,
// exactly as a tray's pockets are: the client edits a list and sends the list,
// and a half-applied inventory is never a state the database can be in.
//
// Photos are appended and removed one at a time instead, because each one costs
// an upload. Losing the whole set of them to a stale PUT would be a poor trade
// for symmetry.
import type { SqliteDatabase } from '../connection.ts'
import type {
  CoverageRow,
  KeycapProjectInput,
  KeycapProjectRecord,
  KeycapProjectRepository,
  KeycapProjectSummary,
  Owner,
  ProjectPhotoInput,
  ProjectPhotoRecord,
  SetItemInput,
  SetItemRecord,
  SetItemSource,
} from './contracts.ts'

interface ProjectRow {
  id: number | bigint
  name: string
  notes: string | null
  set_name: string | null
  manufacturer: string | null
  cap_profile: string | null
  colorway: string | null
  created_at: string
  updated_at: string
}

interface SummaryRow extends ProjectRow {
  cap_count: number | null
  tray_count: number
  photo_count: number
}

interface ItemRow {
  id: number | bigint
  legend: string | null
  units: number
  height_units: number
  shape: 'rect' | 'iso-enter' | null
  cap_count: number
  group_name: string | null
  color: string | null
  source: string
}

interface PhotoRow {
  hash: string
  caption: string | null
  created_at: string
}

interface CoverageQueryRow {
  units: number
  height_units: number
  shape: 'rect' | 'iso-enter' | null
  rotation_deg: number
  pockets: number
}

const rowToItem = (r: ItemRow): SetItemRecord => ({
  id: String(r.id),
  legend: r.legend ?? undefined,
  units: r.units,
  heightUnits: r.height_units,
  shape: r.shape ?? undefined,
  count: r.cap_count,
  group: r.group_name ?? undefined,
  color: r.color ?? undefined,
  source: r.source as SetItemSource,
})

const rowToPhoto = (r: PhotoRow): ProjectPhotoRecord => ({
  hash: r.hash,
  caption: r.caption ?? undefined,
  createdAt: r.created_at,
})

interface ItemParams {
  project_id: number | bigint
  legend: string | null
  units: number
  height_units: number
  shape: 'rect' | 'iso-enter' | null
  cap_count: number
  group_name: string | null
  color: string | null
  source: string
  sort_order: number
}

const itemParams = (projectId: number | bigint, i: SetItemInput, index: number): ItemParams => ({
  project_id: projectId,
  legend: i.legend ?? null,
  units: i.units,
  height_units: i.heightUnits ?? 1,
  shape: i.shape ?? null,
  cap_count: i.count ?? 1,
  group_name: i.group ?? null,
  color: i.color ?? null,
  source: i.source ?? 'manual',
  sort_order: index,
})

export function createKeycapProjectRepository(db: SqliteDatabase): KeycapProjectRepository {
  const selectOwned = db.prepare<[string, string, string], ProjectRow>(`
    SELECT id, name, notes, set_name, manufacturer, cap_profile, colorway,
           created_at, updated_at
      FROM keycap_projects
     WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?`)

  const selectItems = db.prepare<[number | bigint], ItemRow>(`
    SELECT id, legend, units, height_units, shape, cap_count, group_name, color, source
      FROM keycap_set_items
     WHERE project_id = ?
     ORDER BY sort_order`)

  const selectPhotos = db.prepare<[number | bigint], PhotoRow>(`
    SELECT hash, caption, created_at
      FROM keycap_project_photos
     WHERE project_id = ?
     ORDER BY sort_order, id`)

  // Coverage is a GROUP BY over the project's pockets rather than a read of
  // every tray: the project page needs the totals, not the designs.
  const COVERAGE_SQL = `
    SELECT p.units AS units, p.height_units AS height_units, p.shape AS shape,
           p.rotation_deg AS rotation_deg, COUNT(p.id) AS pockets
      FROM keycap_tray_pockets p
      JOIN keycap_tray_designs d ON d.id = p.design_id
     WHERE d.project_id = ? AND d.owner_tenant_id = ? AND d.owner_oid = ?`
  // Rotation is part of the grouping because a quarter turn swaps a pocket's
  // sides: a 2u pocket on its side holds what a 1u x 2 pocket holds. The client
  // normalises, so one function decides that for saved and unsaved pockets alike.
  const COVERAGE_GROUP = `
     GROUP BY p.units, p.height_units, p.shape, p.rotation_deg
     ORDER BY p.units, p.height_units`

  const selectCoverage = db.prepare<[number | bigint, string, string], CoverageQueryRow>(
    `${COVERAGE_SQL}${COVERAGE_GROUP}`)

  // Written out rather than built by concatenation, so the SQL a caller runs is
  // readable in full at the point it is written.
  const selectCoverageExcluding = db.prepare<
    [number | bigint, string, string, string], CoverageQueryRow
  >(`${COVERAGE_SQL} AND d.id != ?${COVERAGE_GROUP}`)

  const insertProject = db.prepare(`
    INSERT INTO keycap_projects
      (owner_tenant_id, owner_oid, name, notes, set_name, manufacturer, cap_profile, colorway)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)

  const insertItem = db.prepare<[ItemParams]>(`
    INSERT INTO keycap_set_items
      (project_id, legend, units, height_units, shape, cap_count, group_name, color,
       source, sort_order)
    VALUES (@project_id, @legend, @units, @height_units, @shape, @cap_count, @group_name,
            @color, @source, @sort_order)`)

  const deleteItems = db.prepare('DELETE FROM keycap_set_items WHERE project_id = ?')

  const updateProject = db.prepare(`
    UPDATE keycap_projects
       SET name = ?, notes = ?, set_name = ?, manufacturer = ?, cap_profile = ?,
           colorway = ?, updated_at = datetime('now')
     WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?`)

  const createTx = db.transaction((owner: Owner, input: KeycapProjectInput) => {
    const info = insertProject.run(
      owner.tenantId, owner.oid,
      input.name, input.notes ?? null, input.setName ?? null,
      input.manufacturer ?? null, input.capProfile ?? null, input.colorway ?? null)
    const id = info.lastInsertRowid
    ;(input.items ?? []).forEach((item, index) => insertItem.run(itemParams(id, item, index)))
    return id
  })

  const updateTx = db.transaction(
    (owner: Owner, rowId: number | bigint, id: string, input: KeycapProjectInput) => {
      updateProject.run(
        input.name, input.notes ?? null, input.setName ?? null,
        input.manufacturer ?? null, input.capProfile ?? null, input.colorway ?? null,
        owner.tenantId, owner.oid, id)
      // An absent `items` leaves the inventory alone; an empty array clears it.
      // The route's validator preserves that distinction rather than defaulting.
      if (input.items) {
        deleteItems.run(rowId)
        input.items.forEach((item, index) => insertItem.run(itemParams(rowId, item, index)))
      }
    })

  return {
    async list(owner) {
      // Three aggregates over three different children, so each is its own
      // scalar subquery: one LEFT JOIN per child would multiply the rows.
      const rows = db.prepare<[string, string], SummaryRow>(`
        SELECT p.id, p.name, p.notes, p.set_name, p.manufacturer, p.cap_profile, p.colorway,
               p.created_at, p.updated_at,
               (SELECT SUM(i.cap_count) FROM keycap_set_items i WHERE i.project_id = p.id)
                 AS cap_count,
               (SELECT COUNT(*) FROM keycap_tray_designs d WHERE d.project_id = p.id)
                 AS tray_count,
               (SELECT COUNT(*) FROM keycap_project_photos f WHERE f.project_id = p.id)
                 AS photo_count
          FROM keycap_projects p
         WHERE p.owner_tenant_id = ? AND p.owner_oid = ?
         ORDER BY p.updated_at DESC`).all(owner.tenantId, owner.oid)
      return rows.map((r): KeycapProjectSummary => ({
        id: String(r.id),
        name: r.name,
        setName: r.set_name ?? undefined,
        capProfile: r.cap_profile ?? undefined,
        colorway: r.colorway ?? undefined,
        // SUM over no rows is NULL, and an empty set holds zero caps.
        capCount: r.cap_count ?? 0,
        trayCount: r.tray_count,
        photoCount: r.photo_count,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }))
    },

    async get(owner, id, excludeTrayId) {
      const p = selectOwned.get(owner.tenantId, owner.oid, id)
      if (!p) return null
      const coverageRows = excludeTrayId
        ? selectCoverageExcluding.all(p.id, owner.tenantId, owner.oid, excludeTrayId)
        : selectCoverage.all(p.id, owner.tenantId, owner.oid)
      return {
        id: String(p.id),
        name: p.name,
        notes: p.notes ?? undefined,
        setName: p.set_name ?? undefined,
        manufacturer: p.manufacturer ?? undefined,
        capProfile: p.cap_profile ?? undefined,
        colorway: p.colorway ?? undefined,
        items: selectItems.all(p.id).map(rowToItem),
        photos: selectPhotos.all(p.id).map(rowToPhoto),
        coverage: coverageRows
          .map((r): CoverageRow => ({
            units: r.units,
            heightUnits: r.height_units,
            shape: r.shape,
            rotationDeg: r.rotation_deg ?? 0,
            pockets: r.pockets,
          })),
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      } satisfies KeycapProjectRecord
    },

    async create(owner, input) {
      return { id: String(createTx(owner, input)) }
    },

    async update(owner, id, input) {
      const existing = selectOwned.get(owner.tenantId, owner.oid, id)
      if (!existing) return false
      updateTx(owner, existing.id, id, input)
      return true
    },

    async remove(owner, id) {
      const info = db.prepare(
        'DELETE FROM keycap_projects WHERE owner_tenant_id = ? AND owner_oid = ? AND id = ?',
      ).run(owner.tenantId, owner.oid, id)
      return info.changes > 0
    },

    async addPhoto(owner, id, photo: ProjectPhotoInput) {
      const existing = selectOwned.get(owner.tenantId, owner.oid, id)
      if (!existing) return false
      // Re-attaching the same photo updates its caption rather than failing:
      // the hash is the identity, and the caption is the only editable part.
      db.prepare(`
        INSERT INTO keycap_project_photos (project_id, hash, caption, sort_order)
        VALUES (?, ?, ?,
                (SELECT COALESCE(MAX(sort_order) + 1, 0)
                   FROM keycap_project_photos WHERE project_id = ?))
        ON CONFLICT (project_id, hash) DO UPDATE SET caption = excluded.caption`).run(
        existing.id, photo.hash, photo.caption ?? null, existing.id)
      return true
    },

    async removePhoto(owner, id, hash) {
      const existing = selectOwned.get(owner.tenantId, owner.oid, id)
      if (!existing) return false
      // Metadata only. The bytes stay in the artifact store, which is
      // content-addressed and shared: another project may hold the same photo.
      const info = db.prepare(
        'DELETE FROM keycap_project_photos WHERE project_id = ? AND hash = ?',
      ).run(existing.id, hash)
      return info.changes > 0
    },
  }
}
