// The model Library: what the organizer on the owner's Mac syncs, what the
// pages read, and the pure rules both sides share -- cleaning a synced model,
// filtering the hub, and guessing which model a printer job printed.
//
// Moved from Workshop (library-server.js), where it was written against one
// SQLite file per user. Here every row is owner-scoped instead, and the print
// history comes straight from this app's own job ledger rather than over HTTP.

export const LIBRARY_STATUSES = ['inbox', 'want', 'queued', 'printed', 'failed', 'skip'] as const
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number]

export const LIBRARY_STATUS_LABELS: Record<LibraryStatus, string> = {
  inbox: 'Inbox',
  want: 'Want to print',
  queued: 'Queued',
  printed: 'Printed',
  failed: 'Failed',
  skip: 'Skipped',
}

export const LIBRARY_SORTS = ['recent', 'title', 'updated', 'printed', 'size'] as const
export type LibrarySort = (typeof LIBRARY_SORTS)[number]

export const LIBRARY_FILE_KINDS = ['stl', '3mf', 'obj', 'step', 'other'] as const
export type LibraryFileKind = (typeof LIBRARY_FILE_KINDS)[number]

/** A job title this close to a model's names is linked without asking. */
export const AUTO_MATCH_SCORE = 0.95
/** Closer than this, and the match is offered for review. */
export const SUGGEST_MATCH_SCORE = 0.6

export const LIBRARY_LIMITS = {
  title: 200,
  notes: 20_000,
  designer: 200,
  sourceUrl: 2_000,
  category: 120,
  collectionName: 80,
  tag: 40,
  tags: 30,
  modelsPerSync: 500,
  filesPerModel: 2_000,
} as const

export type Bbox = [number, number, number]

export interface LibraryFilament {
  type: string | null
  color: string | null
  profile?: string | null
  grams?: number | null
}

export interface LibraryPlate {
  index: number
  name: string | null
  objects?: string[]
  seconds?: number | null
  grams?: number | null
}

export interface LibraryModel {
  id: string
  title: string
  category: string
  folder: string | null
  status: LibraryStatus
  tags: string[]
  notes: string
  favorite: boolean
  designer: string | null
  license: string | null
  description: string | null
  sourceSite: string | null
  sourceUrl: string | null
  sourceModelId: string | null
  /** A plain link to the model's project in Workshop's Bambu Hub. */
  bambuHubUrl: string | null
  thumbHash: string | null
  gallery: string[]
  formats: string[]
  fileCount: number
  totalBytes: number
  plateCount: number
  printer: string | null
  filaments: LibraryFilament[]
  estSeconds: number | null
  estGrams: number | null
  isSliced: boolean
  bbox: Bbox | null
  state: 'present' | 'missing'
  firstSeenAt: string
  lastSeenAt: string
  updatedAt: string
  printedCount: number
  failedCount: number
  lastPrintedAt: string | null
}

export interface LibraryFile {
  id: number
  relPath: string
  filename: string
  kind: LibraryFileKind
  size: number
  sha256: string
  geomHash: string | null
  mtime: string | null
  triangles: number | null
  bbox: Bbox | null
  isSliced: boolean
  printer: string | null
  seconds: number | null
  grams: number | null
  plates: LibraryPlate[]
  filaments: LibraryFilament[]
  generator: string | null
  thumbHash: string | null
}

export type LibraryPrintResult = 'completed' | 'failed' | 'active' | 'unknown'
export type LibraryMatchState = 'manual' | 'auto' | 'confirmed' | 'suggested' | 'unmatched' | 'rejected'

export interface LibraryPrint {
  id: number
  modelId: string | null
  source: 'manual' | 'bambu'
  title: string | null
  result: LibraryPrintResult
  startedAt: string | null
  endedAt: string | null
  seconds: number | null
  grams: number | null
  notes: string
  matchState: LibraryMatchState
  matchScore: number | null
  /** Only on review rows: the suggested model's title and thumbnail. */
  modelTitle?: string | null
  modelThumb?: string | null
}

export interface LibraryModelDetail extends LibraryModel {
  files: LibraryFile[]
  prints: LibraryPrint[]
  /** Manual collections this model is in. */
  collectionIds: number[]
}

export interface LibraryModelPage {
  total: number
  items: LibraryModel[]
}

/** The hub filters, as a query and as what a smart collection saves. */
export interface LibraryQuery {
  q?: string
  status?: LibraryStatus | ''
  category?: string
  format?: string
  tag?: string
  favorite?: boolean
  sort?: LibrarySort
}

export interface LibraryModelQuery extends LibraryQuery {
  state?: 'present' | 'missing'
  collection?: number
  limit?: number
  offset?: number
}

export interface LibraryCollection {
  id: number
  name: string
  /** Manual collections hold chosen models; smart ones are saved filters. */
  kind: 'manual' | 'smart'
  query: LibraryQuery | null
  count: number
  createdAt: string
  updatedAt: string
}

export interface LibraryBatch {
  batch: string
  at: string
  ops: number
  undone: boolean
  kind: string | null
}

export interface LibraryDevice {
  id: string
  name: string
  createdAt: string
  lastSeenAt: string | null
  revokedAt: string | null
}

export interface LibraryPlanSummary {
  models: number
  moves: number
  extracts: number
  trash: number
  trashBytes: number
  alreadyOrganized: number
  byCategory: Record<string, number>
}

export interface LibraryPlanModel {
  id: string
  title: string
  origin: 'library' | 'intake'
  sourceLabel: string
  category: string
  suggestedCategory: string | null
  status: LibraryStatus
  dest: string | null
  thumb: string | null
  designer: string | null
  moves: { from: string; to: string }[]
  moveCount: number
  extractCount: number
  trash: { path: string; reason: string }[]
  trashCount: number
}

/** Written by the organizer; the server stores it as it arrives. */
export interface LibraryPlan {
  createdAt: string
  intakeOnly: boolean
  summary: LibraryPlanSummary
  skipped: number
  models: LibraryPlanModel[]
}

export interface LibraryOverview {
  byStatus: Partial<Record<LibraryStatus, number>>
  byCategory: { category: string; count: number }[]
  missing: number
  suggestions: number
  duplicateGroups: number
  lastSync: { at: string; device: string; stats: { models: number; files: number } | null } | null
  planSummary: { createdAt: string; pending: number; summary: LibraryPlanSummary } | null
  batches: LibraryBatch[]
  devices: LibraryDevice[]
  /** The printer's job ledger is the household's, so only an administrator links prints from it. */
  printHistory: { available: boolean; lastSync: string | null }
}

export interface LibraryDuplicateFile {
  id: number
  modelId: string
  relPath: string
  filename: string
  kind: LibraryFileKind
  size: number
  thumbHash: string | null
  title: string
  category: string
  status: LibraryStatus
  modelThumb: string | null
}

export interface LibraryDuplicateGroup {
  geomHash: string
  files: LibraryDuplicateFile[]
}

export interface LibraryMatchCounts {
  auto: number
  suggested: number
  unmatched: number
}

// ── Cleaning what the organizer sends ────────────────────────────────────────

export const SHA256_RE = /^[0-9a-f]{64}$/
const MODEL_ID_RE = /^[0-9a-f-]{8,64}$/i

const text = (value: unknown, max: number): string | null =>
  value == null ? null : String(value).slice(0, max)

export const num = (value: unknown): number | null =>
  value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/** Trimmed, de-duplicated case-insensitively, at most 30 of 40 characters. */
export function cleanTags(tags: unknown): string[] {
  const out: string[] = []
  for (const tag of list(tags)) {
    const t = String(tag).trim().replace(/\s+/g, ' ').slice(0, LIBRARY_LIMITS.tag)
    if (t && !out.some(o => o.toLowerCase() === t.toLowerCase())) out.push(t)
    if (out.length >= LIBRARY_LIMITS.tags) break
  }
  return out
}

export interface SyncedFile {
  relPath: string
  filename: string
  kind: LibraryFileKind
  size: number
  sha256: string
  geomHash: string | null
  mtime: string | null
  triangles: number | null
  bbox: Bbox | null
  isSliced: boolean
  printer: string | null
  seconds: number | null
  grams: number | null
  plates: LibraryPlate[]
  profileTitle: string | null
  filaments: LibraryFilament[]
  generator: string | null
  thumbHash: string | null
}

/** One model folder as the organizer reports it, cleaned and bounded. */
export interface SyncedModel {
  id: string
  /** The fields a person can also edit here; disk wins only when it has caught up. */
  title: string
  status: LibraryStatus
  tags: string[]
  notes: string
  designer: string | null
  sourceUrl: string | null
  /** model.json's `workshopVersion`: the last edit from this app the disk has applied. */
  diskVersion: number
  category: string
  folder: string | null
  license: string | null
  description: string | null
  sourceSite: string | null
  sourceModelId: string | null
  diskCreatedAt: string | null
  thumbHash: string | null
  gallery: string[]
  files: SyncedFile[]
}

const bbox = (value: unknown): Bbox | null => {
  if (!Array.isArray(value) || value.length < 3) return null
  const triple = value.slice(0, 3).map(num)
  return triple.every(v => v !== null) ? (triple as Bbox) : null
}

/** Throws on a model without a usable id; every other field degrades to a default. */
export function cleanSyncedModel(raw: unknown): SyncedModel {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !MODEL_ID_RE.test(raw.id)) {
    throw new Error('model id is required')
  }
  const source = isRecord(raw.source) ? raw.source : {}
  const files: SyncedFile[] = []
  for (const f of list(raw.files).slice(0, LIBRARY_LIMITS.filesPerModel)) {
    if (!isRecord(f)) continue
    const relPath = text(f.relPath, 2_000)
    if (!relPath || typeof f.sha256 !== 'string' || !SHA256_RE.test(f.sha256)) continue
    files.push({
      relPath,
      filename: text(f.filename, 500) ?? relPath,
      kind: (LIBRARY_FILE_KINDS as readonly unknown[]).includes(f.kind) ? f.kind as LibraryFileKind : 'other',
      size: num(f.size) ?? 0,
      sha256: f.sha256,
      geomHash: typeof f.geomHash === 'string' && SHA256_RE.test(f.geomHash) ? f.geomHash : null,
      mtime: num(f.mtimeMs) ? new Date(Number(f.mtimeMs)).toISOString() : null,
      triangles: num(f.triangles),
      bbox: bbox(f.bbox),
      isSliced: Boolean(f.isSliced),
      printer: text(f.printer, 120),
      seconds: num(f.seconds),
      grams: num(f.grams),
      plates: list(f.plates).slice(0, 64) as LibraryPlate[],
      profileTitle: text(f.profileTitle, 300),
      filaments: list(f.filaments).slice(0, 16) as LibraryFilament[],
      generator: text(f.generator, 40),
      thumbHash: typeof f.thumb === 'string' && SHA256_RE.test(f.thumb) ? f.thumb : null,
    })
  }
  return {
    id: raw.id,
    title: text(raw.title, LIBRARY_LIMITS.title) || 'Untitled model',
    status: (LIBRARY_STATUSES as readonly unknown[]).includes(raw.status) ? raw.status as LibraryStatus : 'inbox',
    tags: cleanTags(raw.tags),
    notes: text(raw.notes, LIBRARY_LIMITS.notes) ?? '',
    designer: text(raw.designer, LIBRARY_LIMITS.designer),
    sourceUrl: text(source.url, LIBRARY_LIMITS.sourceUrl),
    diskVersion: Number.isInteger(raw.workshopVersion) ? Number(raw.workshopVersion) : 0,
    category: text(raw.category, LIBRARY_LIMITS.category) || '_Inbox',
    folder: text(raw.folder, 1_000),
    license: text(raw.license, 200),
    description: text(raw.description, 8_000),
    sourceSite: text(source.site, 40),
    sourceModelId: text(source.modelId, 120),
    diskCreatedAt: text(raw.createdAt, 40),
    thumbHash: typeof raw.thumb === 'string' && SHA256_RE.test(raw.thumb) ? raw.thumb : null,
    gallery: list(raw.gallery).filter((h): h is string => typeof h === 'string' && SHA256_RE.test(h)).slice(0, 40),
    files,
  }
}

export interface FileAggregate {
  formats: string[]
  fileCount: number
  totalBytes: number
  plateCount: number
  printer: string | null
  filaments: LibraryFilament[]
  estSeconds: number | null
  estGrams: number | null
  isSliced: boolean
  bbox: Bbox | null
}

/** The model-level summary of its files: the heaviest sliced file sets the estimate. */
export function aggregateFiles(files: SyncedFile[]): FileAggregate {
  const formats = [...new Set(files.map(f => (f.isSliced ? 'sliced' : f.kind)))].sort()
  const sliced = files.filter(f => f.isSliced && f.grams != null)
  const best = [...sliced].sort((a, b) => (b.grams ?? 0) - (a.grams ?? 0))[0] ?? null
  const withFilaments = files.find(f => f.filaments.length)
  const bboxFile = files.filter(f => f.bbox).sort((a, b) => (b.triangles ?? 0) - (a.triangles ?? 0))[0]
  return {
    formats,
    fileCount: files.length,
    totalBytes: files.reduce((n, f) => n + f.size, 0),
    plateCount: files.reduce((n, f) => Math.max(n, f.plates.length), 0),
    printer: files.find(f => f.printer)?.printer ?? null,
    filaments: withFilaments?.filaments.slice(0, 16) ?? [],
    estSeconds: best?.seconds ?? null,
    estGrams: best?.grams ?? null,
    isSliced: sliced.length > 0 || files.some(f => f.isSliced),
    bbox: bboxFile?.bbox ?? null,
  }
}

// ── Hub filters ──────────────────────────────────────────────────────────────

/** What a filter needs to know about one model; the repository builds these from rows. */
export interface FilterableModel {
  title: string
  designer: string | null
  category: string
  notes: string
  tags: string[]
  printer: string | null
  filaments: LibraryFilament[]
  formats: string[]
  status: LibraryStatus
  favorite: boolean
}

/** Search, status (comma-separated allowed), category, format, tag and favorite. */
export function matchesQuery(model: FilterableModel, query: LibraryQuery, fileNames = ''): boolean {
  const status = query.status ?? ''
  if (status && !status.split(',').includes(model.status)) return false
  if (query.category && model.category !== query.category) return false
  if (query.format && !model.formats.includes(query.format)) return false
  const tag = (query.tag ?? '').toLowerCase()
  if (tag && !model.tags.some(t => t.toLowerCase() === tag)) return false
  if (query.favorite && !model.favorite) return false
  const q = (query.q ?? '').trim().toLowerCase()
  if (!q) return true
  const hay = [
    model.title, model.designer, model.category, model.notes, model.tags.join(' '), model.printer,
    model.filaments.map(f => `${f.type ?? ''} ${f.color ?? ''}`).join(' '), fileNames,
  ].join(' ').toLowerCase()
  return q.split(/\s+/).every(term => hay.includes(term))
}

/** Saved filters for a smart collection; only the hub's own keys are kept. */
export function cleanSmartQuery(raw: unknown): LibraryQuery {
  const q = isRecord(raw) ? raw : {}
  const out: LibraryQuery = {}
  const str = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
  if (str(q.q, 200)) out.q = str(q.q, 200)
  if ((LIBRARY_STATUSES as readonly unknown[]).includes(q.status)) out.status = q.status as LibraryStatus
  if (str(q.category, LIBRARY_LIMITS.category)) out.category = str(q.category, LIBRARY_LIMITS.category)
  if (str(q.format, 20)) out.format = str(q.format, 20)
  if (str(q.tag, LIBRARY_LIMITS.tag)) out.tag = str(q.tag, LIBRARY_LIMITS.tag)
  if (q.favorite === true) out.favorite = true
  if ((LIBRARY_SORTS as readonly unknown[]).includes(q.sort)) out.sort = q.sort as LibrarySort
  return out
}

export function cleanCollectionName(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, LIBRARY_LIMITS.collectionName) : ''
}

// ── Which model did a printer job print? ─────────────────────────────────────

export function normalizeTitle(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\.(gcode\.3mf|3mf|stl|gcode|obj|step)$/g, '')
    .replace(/[+_]/g, ' ')
    .replace(/\((?:sliced|\d+)\)/g, ' ')
    .replace(/\bplate[ -]?\d+\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function trigrams(value: string): Map<string, number> {
  const s = `  ${value} `
  const grams = new Map<string, number>()
  for (let i = 0; i < s.length - 2; i += 1) {
    const g = s.slice(i, i + 3)
    grams.set(g, (grams.get(g) ?? 0) + 1)
  }
  return grams
}

/** Dice coefficient over character trigrams (1 = identical after normalization). */
export function titleSimilarity(a: unknown, b: unknown): number {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const ga = trigrams(na)
  const gb = trigrams(nb)
  let shared = 0
  let total = 0
  for (const [g, n] of ga) {
    shared += Math.min(n, gb.get(g) ?? 0)
    total += n
  }
  for (const n of gb.values()) total += n
  return (2 * shared) / total
}

export interface MatchJob {
  title: string | null
  grams: number | null
  startedAt: string | null
}

export interface MatchFile {
  filename: string
  grams: number | null
  plates: LibraryPlate[]
  profileTitle: string | null
  mtime: string | null
}

export interface MatchModel {
  id: string
  title: string
  files: MatchFile[]
}

export interface JobMatch {
  modelId: string
  score: number
  ambiguous: boolean
}

/**
 * Scores every model for one printer job. Bambu job titles are usually the
 * project or plate name, so the job title is compared with model titles, file
 * names and plate names; matching sliced weights nudge the score.
 *
 * MakerWorld print profiles often name the job after the profile instead
 * ("0.16mm layer, 2 walls, 15% infill"). Those names are shared by many
 * models, so a profile-name match is only confident when the job's weight
 * agrees with the file's; otherwise it is at most a suggestion.
 */
export function scoreJobAgainstModels(job: MatchJob, models: MatchModel[]): JobMatch | null {
  const scored: { modelId: string; score: number; files: MatchFile[] }[] = []
  const grams = num(job.grams)
  for (const model of models) {
    const { files } = model
    const names = [model.title, ...files.map(f => f.filename), ...files.flatMap(f => f.plates.map(p => p.name).filter(Boolean))]
    let score = Math.max(...names.map(n => titleSimilarity(job.title, n)))
    // A job may print the whole project or a single plate, so compare with both.
    const weights = files.flatMap(f => [num(f.grams), ...f.plates.map(p => num(p.grams))]).filter((w): w is number => Boolean(w))
    const weightKnown = Boolean(grams && weights.length)
    const weightClose = weightKnown && weights.some(w => Math.abs(w - grams!) / Math.max(w, grams!) <= 0.1)
    if (weightKnown) score += weightClose ? 0.1 : -0.05
    const profiles = files.map(f => f.profileTitle).filter(Boolean)
    const profileSimilarity = profiles.length ? Math.max(...profiles.map(p => titleSimilarity(job.title, p))) : 0
    if (profileSimilarity >= 0.9) score = Math.max(score, weightClose ? 0.97 : weightKnown ? 0.5 : 0.75)
    scored.push({ modelId: model.id, score: Math.max(0, Math.min(1, score)), files })
  }
  if (!scored.length) return null
  scored.sort((a, b) => b.score - a.score)
  const [best] = scored
  let tied = scored.filter(s => best.score - s.score < 0.04)
  // Copies of the same project (e.g. a later revision re-downloaded) tie on
  // name. A copy whose every file was written after the print started cannot
  // be what was printed, so if exactly one tied copy predates the job, it wins.
  const started = Date.parse(job.startedAt ?? '')
  if (tied.length > 1 && Number.isFinite(started)) {
    const predates = tied.filter(s => s.files.some(f => Date.parse(f.mtime ?? '') <= started))
    if (predates.length === 1) tied = predates
  }
  // Two models equally close is neither an automatic match nor a useful suggestion.
  return { modelId: tied[0].modelId, score: tied[0].score, ambiguous: tied.length > 1 }
}

/** A completed print marks a model printed; a failure only marks it failed if it was never printed. */
export function statusAfterPrint(status: LibraryStatus, result: LibraryPrintResult): LibraryStatus | null {
  if (result === 'completed' && status !== 'printed') return 'printed'
  if (result === 'failed' && (status === 'inbox' || status === 'want' || status === 'queued')) return 'failed'
  return null
}
