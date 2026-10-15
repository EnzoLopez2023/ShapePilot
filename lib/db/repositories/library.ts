// Library repository: the model index the organizer syncs, plus everything a
// person adds to it here -- edits, prints, collections and devices.
//
// Ported from Workshop's library-server.js. Two things changed on the way:
//
//  * Every statement is owner-scoped, because this is one database for every
//    account rather than one file per account.
//  * A model synced for the first time takes its edit version from the disk.
//    Workshop counted edits from 0 in a fresh file, which would have made every
//    edit here look older than the version already written into model.json --
//    so the organizer would never have applied it, and the next sync would
//    have overwritten it with the disk's copy.
//
// Filtering and sorting happen in TypeScript over the owner's rows, as they did
// in Workshop: a personal library is thousands of rows, not millions, and the
// same filter function has to evaluate a smart collection's saved query.
import type { SqliteDatabase } from '../connection.ts'
import type { Owner } from './contracts.ts'
import {
  aggregateFiles, cleanSmartQuery, matchesQuery, scoreJobAgainstModels, statusAfterPrint,
  AUTO_MATCH_SCORE, SUGGEST_MATCH_SCORE,
} from '../../contracts/library.ts'
import type {
  Bbox, LibraryBatch, LibraryCollection, LibraryDevice, LibraryDuplicateGroup, LibraryFile, LibraryFilament,
  LibraryMatchCounts, LibraryModel, LibraryModelDetail, LibraryModelQuery, LibraryOverview, LibraryPlan,
  LibraryPlate, LibraryPrint, LibraryPrintResult, LibraryQuery, LibraryStatus, MatchModel, SyncedModel,
} from '../../contracts/library.ts'

/** An edit made here that model.json has not caught up with, in the organizer's shape. */
export interface LibraryPendingEdit {
  id: string
  title: string
  status: LibraryStatus
  tags: string[]
  notes: string
  designer: string | null
  sourceUrl: string | null
  workshopVersion: number
}

export interface LibraryModelEdit {
  title?: string
  status?: LibraryStatus
  tags?: string[]
  notes?: string
  favorite?: boolean
  designer?: string | null
  sourceUrl?: string | null
  bambuHubUrl?: string | null
}

/** One job from the household printer's ledger, already projected. */
export interface LibraryImportedJob {
  key: string
  title: string | null
  result: LibraryPrintResult
  startedAt: string | null
  endedAt: string | null
  seconds: number | null
  grams: number | null
  materials: unknown[]
}

export interface LibraryDeviceGrant {
  id: string
  owner: Owner
  name: string
}

export type CollectionWrite = LibraryCollection | 'exists' | 'not_found'

export interface LibraryRepository {
  syncModels(owner: Owner, models: SyncedModel[], seen: string): Promise<void>
  commitSync(owner: Owner, input: {
    startedAt: string
    plan?: unknown
    batches?: unknown[]
    lastSync: unknown
  }): Promise<{ missing: number }>
  knownThumbs(owner: Owner, hashes: string[]): Promise<Set<string>>
  recordThumb(owner: Owner, hash: string): Promise<void>
  pendingEdits(owner: Owner): Promise<LibraryPendingEdit[]>

  overview(owner: Owner): Promise<Omit<LibraryOverview, 'printHistory'> & { printHistoryLastSync: string | null }>
  queryModels(owner: Owner, query: LibraryModelQuery): Promise<LibraryModel[]>
  getModel(owner: Owner, id: string): Promise<LibraryModelDetail | null>
  editModel(owner: Owner, id: string, edit: LibraryModelEdit): Promise<LibraryModel | null>

  logPrint(owner: Owner, modelId: string, input: {
    result: 'completed' | 'failed'
    startedAt: string
    notes: string
    grams: number | null
    seconds: number | null
  }): Promise<LibraryPrint | null>
  deleteManualPrint(owner: Owner, id: number): Promise<boolean>
  listMatches(owner: Owner): Promise<LibraryPrint[]>
  confirmMatch(owner: Owner, printId: number, modelId: string | null): Promise<LibraryPrint | 'not_found' | 'no_model'>
  rejectMatch(owner: Owner, printId: number): Promise<LibraryPrint | null>
  importJobs(owner: Owner, jobs: LibraryImportedJob[], syncedAt: string, cursor: string): Promise<LibraryMatchCounts>
  printHistoryCursor(owner: Owner): Promise<string | null>
  matchPrints(owner: Owner): Promise<LibraryMatchCounts>

  listCollections(owner: Owner): Promise<LibraryCollection[]>
  createCollection(owner: Owner, input: {
    name: string
    kind: 'manual' | 'smart'
    query: LibraryQuery | null
    modelIds: string[]
  }): Promise<CollectionWrite>
  updateCollection(owner: Owner, id: number, input: { name: string; query?: LibraryQuery }): Promise<CollectionWrite>
  deleteCollection(owner: Owner, id: number): Promise<boolean>
  setMembership(owner: Owner, id: number, modelId: string, member: boolean): Promise<'ok' | 'not_found' | 'smart' | 'no_model'>

  duplicates(owner: Owner): Promise<LibraryDuplicateGroup[]>
  plan(owner: Owner): Promise<LibraryPlan | null>

  createDevice(owner: Owner, id: string, name: string, tokenHash: string): Promise<LibraryDevice>
  listDevices(owner: Owner): Promise<LibraryDevice[]>
  revokeDevice(owner: Owner, id: string): Promise<boolean>
  deviceByHash(tokenHash: string): Promise<LibraryDeviceGrant | null>
}

// ── Rows ─────────────────────────────────────────────────────────────────────

interface ModelRow {
  id: string
  title: string
  category: string
  folder: string | null
  status: LibraryStatus
  tags_json: string
  notes: string
  favorite: number
  designer: string | null
  license: string | null
  description: string | null
  source_site: string | null
  source_url: string | null
  source_model_id: string | null
  bambu_hub_url: string | null
  thumb_hash: string | null
  gallery_json: string
  formats_json: string
  file_count: number
  total_bytes: number
  plate_count: number
  printer: string | null
  filaments_json: string
  est_seconds: number | null
  est_grams: number | null
  is_sliced: number
  bbox_json: string | null
  state: 'present' | 'missing'
  edit_version: number
  disk_version: number
  first_seen_at: string
  last_seen_at: string
  updated_at: string
}

interface FileRow {
  id: number
  model_id: string
  rel_path: string
  filename: string
  kind: LibraryFile['kind']
  size: number
  sha256: string
  geom_hash: string | null
  mtime: string | null
  triangles: number | null
  bbox_json: string | null
  is_sliced: number
  printer: string | null
  seconds: number | null
  grams: number | null
  plates_json: string
  profile_title: string | null
  filaments_json: string
  generator: string | null
  thumb_hash: string | null
}

interface PrintRow {
  id: number
  model_id: string | null
  source: 'manual' | 'bambu'
  title: string | null
  result: LibraryPrintResult
  started_at: string | null
  ended_at: string | null
  seconds: number | null
  grams: number | null
  notes: string
  match_state: LibraryPrint['matchState']
  match_score: number | null
  created_at: string
  model_title?: string | null
  model_thumb?: string | null
}

interface CollectionRow {
  id: number
  name: string
  kind: 'manual' | 'smart'
  query_json: string | null
  created_at: string
  updated_at: string
}

interface DeviceRow {
  id: string
  owner_tenant_id: string
  owner_oid: string
  name: string
  created_at: string
  last_seen_at: string | null
  revoked_at: string | null
}

interface StatsRow {
  model_id: string
  printed_count: number
  failed_count: number
  last_printed_at: string | null
}

function json<T>(value: string | null, fallback: T): T {
  if (value == null) return fallback
  try {
    return (JSON.parse(value) as T) ?? fallback
  } catch {
    return fallback
  }
}

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`

function toModel(row: ModelRow, stats: Map<string, StatsRow>): LibraryModel {
  const s = stats.get(row.id)
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    folder: row.folder,
    status: row.status,
    tags: json<string[]>(row.tags_json, []),
    notes: row.notes,
    favorite: row.favorite === 1,
    designer: row.designer,
    license: row.license,
    description: row.description,
    sourceSite: row.source_site,
    sourceUrl: row.source_url,
    sourceModelId: row.source_model_id,
    bambuHubUrl: row.bambu_hub_url,
    thumbHash: row.thumb_hash,
    gallery: json<string[]>(row.gallery_json, []),
    formats: json<string[]>(row.formats_json, []),
    fileCount: row.file_count,
    totalBytes: row.total_bytes,
    plateCount: row.plate_count,
    printer: row.printer,
    filaments: json<LibraryFilament[]>(row.filaments_json, []),
    estSeconds: row.est_seconds,
    estGrams: row.est_grams,
    isSliced: row.is_sliced === 1,
    bbox: json<Bbox | null>(row.bbox_json, null),
    state: row.state,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    updatedAt: row.updated_at,
    printedCount: s?.printed_count ?? 0,
    failedCount: s?.failed_count ?? 0,
    lastPrintedAt: s?.last_printed_at ?? null,
  }
}

const toFile = (row: FileRow): LibraryFile => ({
  id: row.id,
  relPath: row.rel_path,
  filename: row.filename,
  kind: row.kind,
  size: row.size,
  sha256: row.sha256,
  geomHash: row.geom_hash,
  mtime: row.mtime,
  triangles: row.triangles,
  bbox: json<Bbox | null>(row.bbox_json, null),
  isSliced: row.is_sliced === 1,
  printer: row.printer,
  seconds: row.seconds,
  grams: row.grams,
  plates: json<LibraryPlate[]>(row.plates_json, []),
  filaments: json<LibraryFilament[]>(row.filaments_json, []),
  generator: row.generator,
  thumbHash: row.thumb_hash,
})

const toPrint = (row: PrintRow): LibraryPrint => ({
  id: row.id,
  modelId: row.model_id,
  source: row.source,
  title: row.title,
  result: row.result,
  startedAt: row.started_at,
  endedAt: row.ended_at,
  seconds: row.seconds,
  grams: row.grams,
  notes: row.notes,
  matchState: row.match_state,
  matchScore: row.match_score,
  ...(row.model_title !== undefined ? { modelTitle: row.model_title, modelThumb: row.model_thumb ?? null } : {}),
})

const toDevice = (row: DeviceRow): LibraryDevice => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
  revokedAt: row.revoked_at,
})

type O = [string, string]
const own = (owner: Owner): O => [owner.tenantId, owner.oid]

export function createLibraryRepository(db: SqliteDatabase): LibraryRepository {
  const WHERE_OWNER = 'owner_tenant_id = ? AND owner_oid = ?'

  const getModelRow = db.prepare<[...O, string], ModelRow>(`SELECT * FROM library_models WHERE ${WHERE_OWNER} AND id = ?`)
  const modelRows = db.prepare<[...O, string], ModelRow>(`SELECT * FROM library_models WHERE ${WHERE_OWNER} AND state = ?`)
  const statsRows = db.prepare<O, StatsRow>(`
    SELECT model_id,
      SUM(result = 'completed') AS printed_count,
      SUM(result = 'failed') AS failed_count,
      MAX(COALESCE(started_at, created_at)) AS last_printed_at
    FROM library_prints
    WHERE ${WHERE_OWNER} AND model_id IS NOT NULL AND match_state IN ('manual', 'auto', 'confirmed')
    GROUP BY model_id`)
  const fileRows = db.prepare<[...O, string], FileRow>(
    `SELECT * FROM library_files WHERE ${WHERE_OWNER} AND model_id = ? ORDER BY kind, filename`)
  const getState = db.prepare<[...O, string], { value: string }>(
    `SELECT value FROM library_state WHERE ${WHERE_OWNER} AND key = ?`)
  const setState = db.prepare<[...O, string, string]>(`
    INSERT INTO library_state (owner_tenant_id, owner_oid, key, value) VALUES (?, ?, ?, ?)
    ON CONFLICT (owner_tenant_id, owner_oid, key) DO UPDATE SET value = excluded.value, updated_at = ${NOW}`)
  const setStatus = db.prepare<[LibraryStatus, ...O, string]>(`
    UPDATE library_models SET status = ?, edit_version = edit_version + 1, updated_at = ${NOW}
    WHERE ${WHERE_OWNER} AND id = ?`)
  const getPrintRow = db.prepare<[...O, number], PrintRow>(`SELECT * FROM library_prints WHERE ${WHERE_OWNER} AND id = ?`)
  const setMatch = db.prepare<[string | null, string, number | null, ...O, number]>(`
    UPDATE library_prints SET model_id = ?, match_state = ?, match_score = ? WHERE ${WHERE_OWNER} AND id = ?`)
  const getCollectionRow = db.prepare<[...O, number], CollectionRow>(
    `SELECT * FROM library_collections WHERE ${WHERE_OWNER} AND id = ?`)
  const collectionByName = db.prepare<[...O, string], CollectionRow>(
    `SELECT * FROM library_collections WHERE ${WHERE_OWNER} AND name = ? COLLATE NOCASE`)

  const stateValue = <T>(owner: Owner, key: string, fallback: T): T =>
    json<T>(getState.get(...own(owner), key)?.value ?? null, fallback)
  const putState = (owner: Owner, key: string, value: unknown) =>
    setState.run(...own(owner), key, JSON.stringify(value))
  const statsMap = (owner: Owner) => new Map(statsRows.all(...own(owner)).map(r => [r.model_id, r]))

  function applyPrintResult(owner: Owner, modelId: string, result: LibraryPrintResult) {
    const model = getModelRow.get(...own(owner), modelId)
    if (!model) return
    const next = statusAfterPrint(model.status, result)
    if (next) setStatus.run(next, ...own(owner), modelId)
  }

  // ── Sync ──

  const insertModel = db.prepare(`
    INSERT INTO library_models (
      owner_tenant_id, owner_oid, id, title, category, folder, status, tags_json, notes, designer,
      license, description, source_site, source_url, source_model_id,
      edit_version, disk_version, disk_created_at, last_seen_at
    ) VALUES (
      @tenant, @oid, @id, @title, @category, @folder, @status, @tags, @notes, @designer,
      @license, @description, @sourceSite, @sourceUrl, @sourceModelId,
      @diskVersion, @diskVersion, @diskCreatedAt, @seen
    )`)
  const updateFromDisk = db.prepare(`
    UPDATE library_models SET
      title = @title, status = @status, tags_json = @tags, notes = @notes,
      designer = @designer, source_url = @sourceUrl, disk_version = @diskVersion
    WHERE owner_tenant_id = @tenant AND owner_oid = @oid AND id = @id`)
  const updateLocation = db.prepare(`
    UPDATE library_models SET
      category = @category, folder = @folder, license = @license, description = @description,
      source_site = @sourceSite, source_model_id = @sourceModelId,
      thumb_hash = @thumbHash, gallery_json = @gallery, formats_json = @formats,
      file_count = @fileCount, total_bytes = @totalBytes, plate_count = @plateCount,
      printer = @printer, filaments_json = @filaments, est_seconds = @estSeconds,
      est_grams = @estGrams, is_sliced = @isSliced, bbox_json = @bbox,
      state = 'present', last_seen_at = @seen, updated_at = ${NOW}
    WHERE owner_tenant_id = @tenant AND owner_oid = @oid AND id = @id`)
  const deleteModelFiles = db.prepare<[...O, string]>(`DELETE FROM library_files WHERE ${WHERE_OWNER} AND model_id = ?`)
  const deleteFileByPath = db.prepare<[...O, string]>(`DELETE FROM library_files WHERE ${WHERE_OWNER} AND rel_path = ?`)
  const insertFile = db.prepare(`
    INSERT INTO library_files (
      owner_tenant_id, owner_oid, model_id, rel_path, filename, kind, size, sha256, geom_hash, mtime,
      triangles, bbox_json, is_sliced, printer, seconds, grams, plates_json, profile_title,
      filaments_json, generator, thumb_hash
    ) VALUES (
      @tenant, @oid, @modelId, @relPath, @filename, @kind, @size, @sha256, @geomHash, @mtime,
      @triangles, @bbox, @isSliced, @printer, @seconds, @grams, @plates, @profileTitle,
      @filaments, @generator, @thumbHash
    )`)

  const syncModels = db.transaction((owner: Owner, models: SyncedModel[], seen: string) => {
    const base = { tenant: owner.tenantId, oid: owner.oid }
    for (const model of models) {
      const editable = {
        ...base,
        id: model.id,
        title: model.title,
        status: model.status,
        tags: JSON.stringify(model.tags),
        notes: model.notes,
        designer: model.designer,
        sourceUrl: model.sourceUrl,
        diskVersion: model.diskVersion,
      }
      const existing = getModelRow.get(...own(owner), model.id)
      if (!existing) {
        insertModel.run({
          ...editable,
          category: model.category,
          folder: model.folder,
          license: model.license,
          description: model.description,
          sourceSite: model.sourceSite,
          sourceModelId: model.sourceModelId,
          diskCreatedAt: model.diskCreatedAt,
          seen,
        })
      } else if (model.diskVersion >= existing.edit_version) {
        // The disk has caught up with (or is ahead of) the edits made here.
        updateFromDisk.run(editable)
      }
      const agg = aggregateFiles(model.files)
      updateLocation.run({
        ...base,
        id: model.id,
        category: model.category,
        folder: model.folder,
        license: model.license,
        description: model.description,
        sourceSite: model.sourceSite,
        sourceModelId: model.sourceModelId,
        thumbHash: model.thumbHash,
        gallery: JSON.stringify(model.gallery),
        formats: JSON.stringify(agg.formats),
        fileCount: agg.fileCount,
        totalBytes: agg.totalBytes,
        plateCount: agg.plateCount,
        printer: agg.printer?.slice(0, 120) ?? null,
        filaments: JSON.stringify(agg.filaments),
        estSeconds: agg.estSeconds,
        estGrams: agg.estGrams,
        isSliced: agg.isSliced ? 1 : 0,
        bbox: agg.bbox ? JSON.stringify(agg.bbox) : null,
        seen,
      })
      deleteModelFiles.run(...own(owner), model.id)
      for (const f of model.files) {
        // A file that moved between model folders still owns its path exactly once.
        deleteFileByPath.run(...own(owner), f.relPath)
        insertFile.run({
          ...base,
          modelId: model.id,
          relPath: f.relPath,
          filename: f.filename,
          kind: f.kind,
          size: f.size,
          sha256: f.sha256,
          geomHash: f.geomHash,
          mtime: f.mtime,
          triangles: f.triangles,
          bbox: f.bbox ? JSON.stringify(f.bbox) : null,
          isSliced: f.isSliced ? 1 : 0,
          printer: f.printer,
          seconds: f.seconds,
          grams: f.grams,
          plates: JSON.stringify(f.plates),
          profileTitle: f.profileTitle,
          filaments: JSON.stringify(f.filaments),
          generator: f.generator,
          thumbHash: f.thumbHash,
        })
      }
    }
  })

  const markMissing = db.prepare<[...O, string]>(`
    UPDATE library_models SET state = 'missing', updated_at = ${NOW}
    WHERE ${WHERE_OWNER} AND state = 'present' AND last_seen_at < ?`)

  const commitSync = db.transaction((owner: Owner, input: Parameters<LibraryRepository['commitSync']>[1]) => {
    const missing = markMissing.run(...own(owner), input.startedAt).changes
    if (input.plan !== undefined) putState(owner, 'plan', input.plan)
    if (Array.isArray(input.batches)) putState(owner, 'batches', input.batches.slice(0, 200))
    putState(owner, 'last_sync', input.lastSync)
    return { missing }
  })

  const hasThumb = db.prepare<[...O, string], { hash: string }>(
    `SELECT hash FROM library_thumbs WHERE ${WHERE_OWNER} AND hash = ?`)
  const insertThumb = db.prepare<[...O, string]>(
    `INSERT OR IGNORE INTO library_thumbs (owner_tenant_id, owner_oid, hash) VALUES (?, ?, ?)`)
  const pendingEditRows = db.prepare<O, ModelRow>(`
    SELECT * FROM library_models WHERE ${WHERE_OWNER} AND edit_version > disk_version AND state = 'present'`)

  // ── Reads ──

  const countsByStatus = db.prepare<O, { status: LibraryStatus; n: number }>(
    `SELECT status, COUNT(*) AS n FROM library_models WHERE ${WHERE_OWNER} AND state = 'present' GROUP BY status`)
  const countsByCategory = db.prepare<O, { category: string; n: number }>(`
    SELECT category, COUNT(*) AS n FROM library_models WHERE ${WHERE_OWNER} AND state = 'present'
    GROUP BY category ORDER BY category`)
  const countMissing = db.prepare<O, { n: number }>(
    `SELECT COUNT(*) AS n FROM library_models WHERE ${WHERE_OWNER} AND state = 'missing'`)
  const countSuggested = db.prepare<O, { n: number }>(`
    SELECT COUNT(*) AS n FROM library_prints
    WHERE ${WHERE_OWNER} AND match_state = 'suggested' AND result IN ('completed', 'failed')`)
  const geomDuplicates = db.prepare<O, { geom_hash: string }>(`
    SELECT f.geom_hash
    FROM library_files f JOIN library_models m
      ON m.owner_tenant_id = f.owner_tenant_id AND m.owner_oid = f.owner_oid AND m.id = f.model_id AND m.state = 'present'
    WHERE f.owner_tenant_id = ? AND f.owner_oid = ? AND f.geom_hash IS NOT NULL
    GROUP BY f.geom_hash HAVING COUNT(DISTINCT f.model_id) > 1`)
  const filesByGeom = db.prepare<[...O, string], FileRow & { title: string; category: string; status: LibraryStatus; model_thumb: string | null }>(`
    SELECT f.*, m.title, m.category, m.status, m.thumb_hash AS model_thumb
    FROM library_files f JOIN library_models m
      ON m.owner_tenant_id = f.owner_tenant_id AND m.owner_oid = f.owner_oid AND m.id = f.model_id AND m.state = 'present'
    WHERE f.owner_tenant_id = ? AND f.owner_oid = ? AND f.geom_hash = ? ORDER BY m.category, m.title`)
  const fileNamesRows = db.prepare<O, { model_id: string; filename: string }>(
    `SELECT model_id, filename FROM library_files WHERE ${WHERE_OWNER}`)
  const deviceRows = db.prepare<O, DeviceRow>(
    `SELECT * FROM library_devices WHERE ${WHERE_OWNER} ORDER BY created_at DESC`)

  function filtered(owner: Owner, query: LibraryModelQuery, rows: ModelRow[]): ModelRow[] {
    let fileNames: Map<string, string> | null = null
    if (query.q?.trim()) {
      fileNames = new Map()
      for (const f of fileNamesRows.all(...own(owner))) {
        fileNames.set(f.model_id, `${fileNames.get(f.model_id) ?? ''} ${f.filename}`)
      }
    }
    return rows.filter(r => matchesQuery({
      title: r.title,
      designer: r.designer,
      category: r.category,
      notes: r.notes,
      tags: json<string[]>(r.tags_json, []),
      printer: r.printer,
      filaments: json<LibraryFilament[]>(r.filaments_json, []),
      formats: json<string[]>(r.formats_json, []),
      status: r.status,
      favorite: r.favorite === 1,
    }, query, fileNames?.get(r.id) ?? ''))
  }

  const memberIds = db.prepare<[number], { model_id: string }>(
    'SELECT model_id FROM library_collection_models WHERE collection_id = ?')

  function inCollection(owner: Owner, rows: ModelRow[], collection: CollectionRow): ModelRow[] {
    if (collection.kind === 'smart') return filtered(owner, json<LibraryQuery>(collection.query_json, {}), rows)
    const members = new Set(memberIds.all(collection.id).map(r => r.model_id))
    return rows.filter(r => members.has(r.id))
  }

  function query(owner: Owner, q: LibraryModelQuery): LibraryModel[] {
    const stats = statsMap(owner)
    let rows = filtered(owner, q, modelRows.all(...own(owner), q.state === 'missing' ? 'missing' : 'present'))
    if (q.collection !== undefined) {
      const collection = getCollectionRow.get(...own(owner), q.collection)
      rows = collection ? inCollection(owner, rows, collection) : []
    }
    const sorters: Record<string, (a: ModelRow, b: ModelRow) => number> = {
      recent: (a, b) => b.first_seen_at.localeCompare(a.first_seen_at),
      title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
      updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
      printed: (a, b) => (stats.get(b.id)?.last_printed_at ?? '').localeCompare(stats.get(a.id)?.last_printed_at ?? ''),
      size: (a, b) => b.total_bytes - a.total_bytes,
    }
    rows.sort(sorters[q.sort ?? 'recent'] ?? sorters.recent)
    return rows.map(r => toModel(r, stats))
  }

  const editRow = db.prepare(`
    UPDATE library_models SET
      title = @title, status = @status, tags_json = @tags, notes = @notes, favorite = @favorite,
      designer = @designer, source_url = @sourceUrl, bambu_hub_url = @bambuHubUrl,
      edit_version = edit_version + 1, updated_at = ${NOW}
    WHERE owner_tenant_id = @tenant AND owner_oid = @oid AND id = @id`)

  // ── Prints ──

  const insertManualPrint = db.prepare(`
    INSERT INTO library_prints (
      owner_tenant_id, owner_oid, model_id, source, title, result, started_at, notes, grams, seconds, match_state
    ) VALUES (@tenant, @oid, @modelId, 'manual', @title, @result, @startedAt, @notes, @grams, @seconds, 'manual')`)
  const printsForModel = db.prepare<[...O, string], PrintRow>(`
    SELECT * FROM library_prints
    WHERE ${WHERE_OWNER} AND model_id = ? AND match_state IN ('manual', 'auto', 'confirmed')
    ORDER BY COALESCE(started_at, created_at) DESC`)
  const deleteManual = db.prepare<[...O, number]>(
    `DELETE FROM library_prints WHERE ${WHERE_OWNER} AND id = ? AND source = 'manual'`)
  const suggestionRows = db.prepare<O, PrintRow>(`
    SELECT p.*, m.title AS model_title, m.thumb_hash AS model_thumb
    FROM library_prints p LEFT JOIN library_models m
      ON m.owner_tenant_id = p.owner_tenant_id AND m.owner_oid = p.owner_oid AND m.id = p.model_id
    WHERE p.owner_tenant_id = ? AND p.owner_oid = ?
      AND p.match_state IN ('suggested', 'unmatched') AND p.result IN ('completed', 'failed')
    ORDER BY COALESCE(p.started_at, p.created_at) DESC LIMIT 200`)
  const upsertJob = db.prepare(`
    INSERT INTO library_prints (
      owner_tenant_id, owner_oid, source, job_key, title, result, started_at, ended_at, seconds, grams,
      materials_json, match_state
    ) VALUES (
      @tenant, @oid, 'bambu', @key, @title, @result, @startedAt, @endedAt, @seconds, @grams, @materials, 'unmatched'
    )
    ON CONFLICT (owner_tenant_id, owner_oid, job_key) WHERE job_key IS NOT NULL DO UPDATE SET
      title = excluded.title, result = excluded.result, started_at = excluded.started_at,
      ended_at = excluded.ended_at, seconds = excluded.seconds, grams = excluded.grams,
      materials_json = excluded.materials_json`)
  const jobsNeedingMatch = db.prepare<O, PrintRow>(`
    SELECT * FROM library_prints WHERE ${WHERE_OWNER} AND source = 'bambu' AND match_state IN ('unmatched', 'suggested')`)
  const matchModels = db.prepare<O, { id: string; title: string }>(
    `SELECT id, title FROM library_models WHERE ${WHERE_OWNER}`)
  const matchFiles = db.prepare<O, { model_id: string; filename: string; grams: number | null; plates_json: string; profile_title: string | null; mtime: string | null }>(
    `SELECT model_id, filename, grams, plates_json, profile_title, mtime FROM library_files WHERE ${WHERE_OWNER}`)

  function matchPrints(owner: Owner): LibraryMatchCounts {
    const files = new Map<string, MatchModel['files']>()
    for (const f of matchFiles.all(...own(owner))) {
      if (!files.has(f.model_id)) files.set(f.model_id, [])
      files.get(f.model_id)!.push({
        filename: f.filename,
        grams: f.grams,
        plates: json<LibraryPlate[]>(f.plates_json, []),
        profileTitle: f.profile_title,
        mtime: f.mtime,
      })
    }
    const models = matchModels.all(...own(owner)).map(m => ({ ...m, files: files.get(m.id) ?? [] }))
    const counts: LibraryMatchCounts = { auto: 0, suggested: 0, unmatched: 0 }
    for (const job of jobsNeedingMatch.all(...own(owner))) {
      const match = scoreJobAgainstModels({ title: job.title, grams: job.grams, startedAt: job.started_at }, models)
      if (match && match.score >= AUTO_MATCH_SCORE && !match.ambiguous) {
        setMatch.run(match.modelId, 'auto', match.score, ...own(owner), job.id)
        applyPrintResult(owner, match.modelId, job.result)
        counts.auto += 1
      } else if (match && match.score >= SUGGEST_MATCH_SCORE && !match.ambiguous) {
        setMatch.run(match.modelId, 'suggested', match.score, ...own(owner), job.id)
        counts.suggested += 1
      } else {
        setMatch.run(null, 'unmatched', match?.score ?? null, ...own(owner), job.id)
        counts.unmatched += 1
      }
    }
    return counts
  }

  const importJobs = db.transaction((owner: Owner, jobs: LibraryImportedJob[], syncedAt: string, cursor: string) => {
    for (const job of jobs) {
      upsertJob.run({
        tenant: owner.tenantId,
        oid: owner.oid,
        key: job.key,
        title: job.title,
        result: job.result,
        startedAt: job.startedAt,
        endedAt: job.endedAt,
        seconds: job.seconds,
        grams: job.grams,
        materials: JSON.stringify(job.materials.slice(0, 16)),
      })
    }
    putState(owner, 'print_history_cursor', cursor)
    putState(owner, 'print_history_last_sync', syncedAt)
    return matchPrints(owner)
  })

  // ── Collections ──

  const collectionRows = db.prepare<O, CollectionRow>(
    `SELECT * FROM library_collections WHERE ${WHERE_OWNER} ORDER BY name COLLATE NOCASE, id`)
  const manualCounts = db.prepare<O, { collection_id: number; n: number }>(`
    SELECT cm.collection_id, COUNT(*) AS n
    FROM library_collection_models cm
    JOIN library_collections c ON c.id = cm.collection_id
    JOIN library_models m
      ON m.owner_tenant_id = c.owner_tenant_id AND m.owner_oid = c.owner_oid AND m.id = cm.model_id AND m.state = 'present'
    WHERE c.owner_tenant_id = ? AND c.owner_oid = ?
    GROUP BY cm.collection_id`)
  const insertCollection = db.prepare<[...O, string, string, string | null]>(
    'INSERT INTO library_collections (owner_tenant_id, owner_oid, name, kind, query_json) VALUES (?, ?, ?, ?, ?)')
  const updateCollectionRow = db.prepare<[string, string | null, ...O, number]>(`
    UPDATE library_collections SET name = ?, query_json = ?, updated_at = ${NOW} WHERE ${WHERE_OWNER} AND id = ?`)
  const deleteCollectionRow = db.prepare<[...O, number]>(`DELETE FROM library_collections WHERE ${WHERE_OWNER} AND id = ?`)
  const addMember = db.prepare<[number, string]>(
    'INSERT OR IGNORE INTO library_collection_models (collection_id, model_id) VALUES (?, ?)')
  const removeMember = db.prepare<[number, string]>(
    'DELETE FROM library_collection_models WHERE collection_id = ? AND model_id = ?')
  const collectionsForModel = db.prepare<[...O, string], { id: number }>(`
    SELECT c.id FROM library_collections c JOIN library_collection_models cm ON cm.collection_id = c.id
    WHERE c.owner_tenant_id = ? AND c.owner_oid = ? AND cm.model_id = ? ORDER BY c.id`)

  function hydrateCollection(owner: Owner, row: CollectionRow, counts?: Map<number, number>): LibraryCollection {
    const savedQuery = row.kind === 'smart' ? json<LibraryQuery>(row.query_json, {}) : null
    const count = savedQuery
      ? filtered(owner, savedQuery, modelRows.all(...own(owner), 'present')).length
      : (counts ?? new Map(manualCounts.all(...own(owner)).map(r => [r.collection_id, r.n]))).get(row.id) ?? 0
    return {
      id: row.id, name: row.name, kind: row.kind, query: savedQuery, count,
      createdAt: row.created_at, updatedAt: row.updated_at,
    }
  }

  const createCollection = db.transaction((owner: Owner, input: Parameters<LibraryRepository['createCollection']>[1]) => {
    if (collectionByName.get(...own(owner), input.name)) return 'exists' as const
    const id = Number(insertCollection.run(
      ...own(owner), input.name, input.kind, input.kind === 'smart' ? JSON.stringify(cleanSmartQuery(input.query)) : null,
    ).lastInsertRowid)
    if (input.kind === 'manual') {
      for (const modelId of input.modelIds) if (getModelRow.get(...own(owner), modelId)) addMember.run(id, modelId)
    }
    return hydrateCollection(owner, getCollectionRow.get(...own(owner), id)!)
  })

  // ── Devices ──

  const insertDevice = db.prepare<[string, ...O, string, string]>(
    'INSERT INTO library_devices (id, owner_tenant_id, owner_oid, name, token_hash) VALUES (?, ?, ?, ?, ?)')
  const getDevice = db.prepare<[string], DeviceRow>('SELECT * FROM library_devices WHERE id = ?')
  const revokeDeviceRow = db.prepare<[...O, string]>(`
    UPDATE library_devices SET revoked_at = ${NOW} WHERE ${WHERE_OWNER} AND id = ? AND revoked_at IS NULL`)
  const deviceRowByHash = db.prepare<[string], DeviceRow>(
    'SELECT * FROM library_devices WHERE token_hash = ? AND revoked_at IS NULL')
  const touchDevice = db.prepare<[string]>(`UPDATE library_devices SET last_seen_at = ${NOW} WHERE id = ?`)

  return {
    async syncModels(owner, models, seen) { syncModels(owner, models, seen) },
    async commitSync(owner, input) { return commitSync(owner, input) },
    async knownThumbs(owner, hashes) {
      return new Set(hashes.filter(h => hasThumb.get(...own(owner), h)))
    },
    async recordThumb(owner, hash) { insertThumb.run(...own(owner), hash) },
    async pendingEdits(owner) {
      return pendingEditRows.all(...own(owner)).map(row => ({
        id: row.id,
        title: row.title,
        status: row.status,
        tags: json<string[]>(row.tags_json, []),
        notes: row.notes,
        designer: row.designer,
        sourceUrl: row.source_url,
        workshopVersion: row.edit_version,
      }))
    },

    async overview(owner) {
      const plan = stateValue<LibraryPlan | null>(owner, 'plan', null)
      return {
        byStatus: Object.fromEntries(countsByStatus.all(...own(owner)).map(r => [r.status, r.n])),
        byCategory: countsByCategory.all(...own(owner)).map(r => ({ category: r.category, count: r.n })),
        missing: countMissing.get(...own(owner))?.n ?? 0,
        suggestions: countSuggested.get(...own(owner))?.n ?? 0,
        duplicateGroups: geomDuplicates.all(...own(owner)).length,
        lastSync: stateValue<LibraryOverview['lastSync']>(owner, 'last_sync', null),
        planSummary: plan
          ? { createdAt: plan.createdAt, summary: plan.summary, pending: Array.isArray(plan.models) ? plan.models.length : 0 }
          : null,
        batches: stateValue<LibraryBatch[]>(owner, 'batches', []),
        devices: deviceRows.all(...own(owner)).map(toDevice),
        printHistoryLastSync: stateValue<string | null>(owner, 'print_history_last_sync', null),
      }
    },
    async queryModels(owner, q) { return query(owner, q) },
    async getModel(owner, id) {
      const row = getModelRow.get(...own(owner), id)
      if (!row) return null
      return {
        ...toModel(row, statsMap(owner)),
        files: fileRows.all(...own(owner), id).map(toFile),
        prints: printsForModel.all(...own(owner), id).map(toPrint),
        collectionIds: collectionsForModel.all(...own(owner), id).map(r => r.id),
      }
    },
    async editModel(owner, id, edit) {
      const row = getModelRow.get(...own(owner), id)
      if (!row) return null
      editRow.run({
        tenant: owner.tenantId,
        oid: owner.oid,
        id,
        title: edit.title ?? row.title,
        status: edit.status ?? row.status,
        tags: edit.tags !== undefined ? JSON.stringify(edit.tags) : row.tags_json,
        notes: edit.notes ?? row.notes,
        favorite: edit.favorite !== undefined ? (edit.favorite ? 1 : 0) : row.favorite,
        designer: edit.designer !== undefined ? edit.designer : row.designer,
        sourceUrl: edit.sourceUrl !== undefined ? edit.sourceUrl : row.source_url,
        bambuHubUrl: edit.bambuHubUrl !== undefined ? edit.bambuHubUrl : row.bambu_hub_url,
      })
      return toModel(getModelRow.get(...own(owner), id)!, statsMap(owner))
    },

    async logPrint(owner, modelId, input) {
      const row = getModelRow.get(...own(owner), modelId)
      if (!row) return null
      const id = Number(insertManualPrint.run({
        tenant: owner.tenantId, oid: owner.oid, modelId, title: row.title, ...input,
      }).lastInsertRowid)
      applyPrintResult(owner, modelId, input.result)
      return toPrint(getPrintRow.get(...own(owner), id)!)
    },
    async deleteManualPrint(owner, id) { return deleteManual.run(...own(owner), id).changes === 1 },
    async listMatches(owner) { return suggestionRows.all(...own(owner)).map(toPrint) },
    async confirmMatch(owner, printId, modelId) {
      const job = getPrintRow.get(...own(owner), printId)
      if (!job || job.source !== 'bambu') return 'not_found'
      const target = modelId ?? job.model_id
      if (!target || !getModelRow.get(...own(owner), target)) return 'no_model'
      setMatch.run(target, 'confirmed', job.match_score, ...own(owner), job.id)
      applyPrintResult(owner, target, job.result)
      return toPrint(getPrintRow.get(...own(owner), job.id)!)
    },
    async rejectMatch(owner, printId) {
      const job = getPrintRow.get(...own(owner), printId)
      if (!job || job.source !== 'bambu') return null
      setMatch.run(null, 'rejected', job.match_score, ...own(owner), job.id)
      return toPrint(getPrintRow.get(...own(owner), job.id)!)
    },
    async importJobs(owner, jobs, syncedAt, cursor) { return importJobs(owner, jobs, syncedAt, cursor) },
    async printHistoryCursor(owner) { return stateValue<string | null>(owner, 'print_history_cursor', null) },
    async matchPrints(owner) { return db.transaction(() => matchPrints(owner))() },

    async listCollections(owner) {
      const counts = new Map(manualCounts.all(...own(owner)).map(r => [r.collection_id, r.n]))
      return collectionRows.all(...own(owner)).map(row => hydrateCollection(owner, row, counts))
    },
    async createCollection(owner, input) { return createCollection(owner, input) },
    async updateCollection(owner, id, input) {
      const row = getCollectionRow.get(...own(owner), id)
      if (!row) return 'not_found'
      const other = collectionByName.get(...own(owner), input.name)
      if (other && other.id !== row.id) return 'exists'
      const savedQuery = row.kind === 'smart' && input.query !== undefined
        ? JSON.stringify(cleanSmartQuery(input.query))
        : row.query_json
      updateCollectionRow.run(input.name, savedQuery, ...own(owner), id)
      return hydrateCollection(owner, getCollectionRow.get(...own(owner), id)!)
    },
    async deleteCollection(owner, id) { return deleteCollectionRow.run(...own(owner), id).changes === 1 },
    async setMembership(owner, id, modelId, member) {
      const collection = getCollectionRow.get(...own(owner), id)
      if (!collection) return 'not_found'
      if (collection.kind !== 'manual') return 'smart'
      if (!getModelRow.get(...own(owner), modelId)) return 'no_model'
      if (member) addMember.run(id, modelId)
      else removeMember.run(id, modelId)
      return 'ok'
    },

    async duplicates(owner) {
      return geomDuplicates.all(...own(owner)).map(g => ({
        geomHash: g.geom_hash,
        files: filesByGeom.all(...own(owner), g.geom_hash).map(f => ({
          id: f.id,
          modelId: f.model_id,
          relPath: f.rel_path,
          filename: f.filename,
          kind: f.kind,
          size: f.size,
          thumbHash: f.thumb_hash,
          title: f.title,
          category: f.category,
          status: f.status,
          modelThumb: f.model_thumb,
        })),
      }))
    },
    async plan(owner) { return stateValue<LibraryPlan | null>(owner, 'plan', null) },

    async createDevice(owner, id, name, tokenHash) {
      insertDevice.run(id, ...own(owner), name, tokenHash)
      return toDevice(getDevice.get(id)!)
    },
    async listDevices(owner) { return deviceRows.all(...own(owner)).map(toDevice) },
    async revokeDevice(owner, id) { return revokeDeviceRow.run(...own(owner), id).changes === 1 },
    async deviceByHash(tokenHash) {
      const row = deviceRowByHash.get(tokenHash)
      if (!row) return null
      touchDevice.run(row.id)
      return { id: row.id, owner: { tenantId: row.owner_tenant_id, oid: row.owner_oid }, name: row.name }
    },
  }
}
