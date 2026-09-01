// Typed async repository contracts.
//
// Everything above lib/db talks to these. better-sqlite3 is synchronous, but
// the contracts are async so the storage engine can change without a rewrite of
// every route, and so nothing above this line can accidentally depend on
// synchronous statement execution.

/** The only authorization key in the app. */
export interface Owner {
  readonly tenantId: string
  readonly oid: string
}

export type AppRole = 'user' | 'admin'

export interface Membership {
  tenantId: string
  oid: string
  role: AppRole
  displayName: string | null
  email: string | null
  createdAt: string
  updatedAt: string
}

export interface MembershipUpsert {
  owner: Owner
  displayName?: string | null
  email?: string | null
  /** Applied only when the membership row is created. */
  initialRole?: AppRole
}

export interface MembershipRepository {
  ensure(input: MembershipUpsert): Promise<Membership>
  find(owner: Owner): Promise<Membership | null>
  list(): Promise<Membership[]>
  setRole(owner: Owner, role: AppRole): Promise<Membership | null>
}

/**
 * How a designer opens before anyone touches it.
 *
 * One shape per designer rather than one shared shape, because the settings
 * are not the same question: a keycap tray has a build plate and a buffer
 * guide, the Bambu designer has a gizmo and a solid/hole mode, and offering
 * either one the other's controls would be offering a setting that does
 * nothing.
 */
export interface KeycapTrayDefaults {
  view: '2d' | '3d'
  snapMm: number
  gridMm: number
  showLabels: boolean
  showPlate: boolean
  showBuffer: boolean
  bufferMm: number
  imperial: boolean
  target: 'print' | 'cnc'
}

export interface ShaperDefaults {
  imperial: boolean
  snapMm: number
  gridMm: number
}

export interface BambuDefaults {
  imperial: boolean
  snapMm: number
  gizmo: 'translate' | 'rotate' | 'scale'
  addMode: 'solid' | 'hole'
}

export interface DesignerDefaults {
  keycapTray: KeycapTrayDefaults
  shaper: ShaperDefaults
  bambu: BambuDefaults
}

export interface AppPreferences {
  themeMode: 'light' | 'dark' | 'system'
  units: 'mm' | 'in'
  reducedMotion: 'system' | 'reduce' | 'no-preference'
  designerDefaults: DesignerDefaults
}

export interface SettingsRepository {
  get(owner: Owner): Promise<AppPreferences | null>
  put(owner: Owner, preferences: AppPreferences): Promise<AppPreferences>
}

export interface AuditEventInput {
  owner: Owner | null
  category: string
  action: string
  outcome: 'success' | 'failure'
  httpMethod?: string | null
  httpPath?: string | null
  httpStatus?: number | null
  requestId?: string | null
  subject?: string | null
  detail?: unknown
}

export interface AuditEvent {
  id: string
  occurredAt: string
  actorTenantId: string | null
  actorOid: string | null
  category: string
  action: string
  outcome: string
  httpMethod: string | null
  httpPath: string | null
  httpStatus: number | null
  requestId: string | null
  subject: string | null
  detail: string | null
}

export interface AuditQuery {
  category?: string
  actor?: Owner
  limit?: number
  before?: string
}

export interface AuditRepository {
  record(event: AuditEventInput): Promise<void>
  list(query?: AuditQuery): Promise<AuditEvent[]>
}

// -- Keycap tray -------------------------------------------------------------
// Field names and value semantics are the pinned Hearth API contract.

export type TrayProfileKind = 'rect' | 'preset' | 'custom'

export interface PocketRecord {
  id: string
  units: number
  heightUnits: number
  x: number
  y: number
  rotationDeg: number
  mirrorX?: boolean
  flipY?: boolean
  isThrough: boolean
  shape?: 'rect' | 'iso-enter'
  label?: string
  labelMode: string
  depthMm?: number
  widthMm?: number
  heightMm?: number
  cornerRadiusMm?: number
}

export interface TrayDesignRecord {
  id: string
  /** The keycap project this tray is cut for, or null when it stands alone. */
  projectId: string | null
  name: string
  notes?: string
  profile: { kind: TrayProfileKind } & Record<string, unknown>
  sizing: Record<string, unknown>
  floorThicknessMm: number
  pocketDepthMm: number
  engraveDepthMm: number
  pockets: PocketRecord[]
  createdAt: string
  updatedAt: string
  revision: number
}

export interface TrayDesignSummary {
  id: string
  projectId: string | null
  /** Denormalised for the picker, which shows the project beside the tray. */
  projectName: string | null
  name: string
  notes?: string
  profileKind: TrayProfileKind
  pocketCount: number
  createdAt: string
  updatedAt: string
}

/** The write payload; matches what the client sends. */
export interface TrayDesignInput {
  name: string
  /** Null unassigns; undefined on update leaves the current link alone. */
  projectId?: string | null
  notes?: string | null
  profile: { kind?: unknown } & Record<string, unknown>
  sizing?: unknown
  floorThicknessMm?: number
  pocketDepthMm?: number
  engraveDepthMm?: number
  pockets?: PocketInput[]
}

export interface PocketInput {
  units: number
  heightUnits?: number
  x: number
  y: number
  rotationDeg?: number
  mirrorX?: boolean | null
  flipY?: boolean | null
  isThrough?: boolean
  shape?: 'rect' | 'iso-enter' | null
  label?: string | null
  labelMode?: string
  depthMm?: number | null
  widthMm?: number | null
  heightMm?: number | null
  cornerRadiusMm?: number | null
}

export interface LibraryPocketRecord {
  id: string
  name: string
  units: number
  widthMm?: number
  heightMm?: number
  cornerRadiusMm?: number
  notes?: string
}

export interface LibraryPocketInput {
  name: string
  units?: number
  widthMm?: number | null
  heightMm?: number | null
  cornerRadiusMm?: number | null
  notes?: string | null
}

export interface KeycapTrayRepository {
  /**
   * `projectId` filters: a string selects one project, `null` selects the
   * unassigned trays, and omitting it returns everything.
   */
  listDesigns(owner: Owner, projectId?: string | null): Promise<TrayDesignSummary[]>
  getDesign(owner: Owner, id: string): Promise<TrayDesignRecord | null>
  createDesign(owner: Owner, input: TrayDesignInput): Promise<{ id: string }>
  updateDesign(owner: Owner, id: string, input: TrayDesignInput): Promise<boolean>
  /**
   * `projectId` retargets the copy: omitting it keeps the source's project,
   * `null` leaves the copy unassigned, and a string moves it to that project
   * (the route has already proved the caller owns it).
   */
  cloneDesign(
    owner: Owner, id: string, name?: string, projectId?: string | null,
  ): Promise<{ id: string } | null>
  deleteDesign(owner: Owner, id: string): Promise<boolean>
  listLibraryPockets(owner: Owner): Promise<LibraryPocketRecord[]>
  createLibraryPocket(owner: Owner, input: LibraryPocketInput): Promise<{ id: string }>
  deleteLibraryPocket(owner: Owner, id: string): Promise<boolean>
}

export class DuplicateLibraryPocketError extends Error {
  readonly pocketName: string
  constructor(pocketName: string) {
    super(`a pocket named "${pocketName}" already exists`)
    this.name = 'DuplicateLibraryPocketError'
    this.pocketName = pocketName
  }
}

export class InvalidProfileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidProfileError'
  }
}



// -- Keycap projects ----------------------------------------------------------
// A project is one keycap set: what it holds, photographs of it, and the trays
// cut for it. The set is stored as line items rather than a size histogram, so
// the 1u(35) / 1.25u(5) breakdown is an aggregate the client derives and the
// legends -- the part a photo actually shows -- survive.

export type SetItemSource = 'manual' | 'photo'

export const SET_ITEM_SOURCES: readonly SetItemSource[] = ['manual', 'photo']

export interface SetItemRecord {
  id: string
  /** The cap's printed legend, when it has one. Blanks and modifiers may not. */
  legend?: string
  /** Cap width in u, the same vocabulary as a pocket. */
  units: number
  heightUnits: number
  shape?: 'rect' | 'iso-enter'
  /** How many identical caps this row stands for. */
  count: number
  /** 'Function keys', 'Numpad', 'Modifiers' -- free text, grouped in the UI. */
  group?: string
  color?: string
  source: SetItemSource
}

export interface SetItemInput {
  legend?: string | null
  units: number
  heightUnits?: number
  shape?: 'rect' | 'iso-enter' | null
  count?: number
  group?: string | null
  color?: string | null
  source?: SetItemSource
}

export interface ProjectPhotoRecord {
  hash: string
  caption?: string
  createdAt: string
}

export interface ProjectPhotoInput {
  hash: string
  caption?: string | null
}

/**
 * How many pockets of each size the project's trays already hold. Computed in
 * SQL rather than by reading every tray, and joined against the set items by
 * the same `(units, heightUnits, shape)` key the client groups on.
 */
export interface CoverageRow {
  units: number
  heightUnits: number
  shape: 'rect' | 'iso-enter' | null
  /** A quarter turn swaps a pocket's sides, so it is part of its footprint. */
  rotationDeg: number
  pockets: number
}

export interface KeycapProjectRecord {
  id: string
  name: string
  notes?: string
  setName?: string
  manufacturer?: string
  /** Cherry, SA, DSA -- the cap sculpt, not the tray outline. */
  capProfile?: string
  colorway?: string
  items: SetItemRecord[]
  photos: ProjectPhotoRecord[]
  coverage: CoverageRow[]
  createdAt: string
  updatedAt: string
}

export interface KeycapProjectSummary {
  id: string
  name: string
  setName?: string
  capProfile?: string
  colorway?: string
  /** Sum of `count` across the set items, not the number of rows. */
  capCount: number
  trayCount: number
  photoCount: number
  createdAt: string
  updatedAt: string
}

export interface KeycapProjectInput {
  name: string
  notes?: string | null
  setName?: string | null
  manufacturer?: string | null
  capProfile?: string | null
  colorway?: string | null
  /** Replaces the whole set on update, the way pockets replace on a tray. */
  items?: SetItemInput[]
}

export interface KeycapProjectRepository {
  list(owner: Owner): Promise<KeycapProjectSummary[]>
  /**
   * `excludeTrayId` leaves one tray out of `coverage`. The designer holds that
   * tray's pockets in memory, unsaved edits and all, and counting the stale
   * saved copy as well would double them.
   */
  get(owner: Owner, id: string, excludeTrayId?: string): Promise<KeycapProjectRecord | null>
  create(owner: Owner, input: KeycapProjectInput): Promise<{ id: string }>
  update(owner: Owner, id: string, input: KeycapProjectInput): Promise<boolean>
  /** Cascades items and photos; the project's trays survive, unassigned. */
  remove(owner: Owner, id: string): Promise<boolean>
  addPhoto(owner: Owner, id: string, photo: ProjectPhotoInput): Promise<boolean>
  removePhoto(owner: Owner, id: string, hash: string): Promise<boolean>
}

export class TooManyPhotosError extends Error {
  constructor(limit: number) {
    super(`a project holds at most ${limit} photos`)
    this.name = 'TooManyPhotosError'
  }
}

// -- Design documents ---------------------------------------------------------
// Shared by the Shaper, Bambu and Playground sub-apps. The scene tree crosses
// this boundary as already-validated JSON: server/validation/designDocument.ts
// rebuilds it before anything reaches a transaction, so the repository stores a
// string and never inspects it.

export type DesignDocumentKind = 'shaper' | 'bambu' | 'playground'

export const DESIGN_DOCUMENT_KINDS: readonly DesignDocumentKind[] =
  ['shaper', 'bambu', 'playground']

export interface DesignDocumentRecord {
  id: string
  kind: DesignDocumentKind
  name: string
  notes: string | null
  /** The serialised scene. Opaque here by design. */
  docJson: string
  createdAt: string
  updatedAt: string
}

export interface DesignDocumentSummary {
  id: string
  kind: DesignDocumentKind
  name: string
  notes: string | null
  /** Cheap enough to compute on write and worth having in a picker. */
  objectCount: number
  createdAt: string
  updatedAt: string
}

export interface DesignDocumentInput {
  kind: DesignDocumentKind
  name: string
  notes?: string | null
  docJson: string
  objectCount: number
}

export interface DesignDocumentRepository {
  list(owner: Owner, kind?: DesignDocumentKind): Promise<DesignDocumentSummary[]>
  get(owner: Owner, id: string): Promise<DesignDocumentRecord | null>
  create(owner: Owner, input: DesignDocumentInput): Promise<{ id: string }>
  update(owner: Owner, id: string, input: DesignDocumentInput): Promise<boolean>
  /** `kind` retargets the copy, which is how "continue in Bambu Designer" works. */
  clone(owner: Owner, id: string, name?: string, kind?: DesignDocumentKind): Promise<{ id: string } | null>
  remove(owner: Owner, id: string): Promise<boolean>
}


// -- Design assets ------------------------------------------------------------
// Metadata only. The bytes live behind the artifact store; this records which
// owner has which content hash, so a lookup can be scoped by owner rather than
// letting a hash act as a bearer token for anyone who guesses it.

export type DesignAssetFormat =
  | 'stl' | 'obj' | 'svg' | 'dxf' | '3mf'
  | 'png' | 'jpeg' | 'webp'

export const DESIGN_ASSET_FORMATS: readonly DesignAssetFormat[] =
  ['stl', 'obj', 'svg', 'dxf', '3mf', 'png', 'jpeg', 'webp']

/**
 * Reference photographs rather than geometry -- a picture of a keycap set,
 * read by the assistant to propose that set's inventory. They live here rather
 * than in a table of their own because everything that makes the asset store
 * the right home for imported bytes is true of them too: content-addressed,
 * owner-scoped, out of the backup manifest, and safe to lose. `importFile` in
 * src/import/index.ts still refuses them; only the photo uploader offers them.
 */
export const IMAGE_ASSET_FORMATS: readonly DesignAssetFormat[] =
  ['png', 'jpeg', 'webp']

export const isImageAssetFormat = (format: string): format is DesignAssetFormat =>
  (IMAGE_ASSET_FORMATS as readonly string[]).includes(format)

export interface DesignAssetRecord {
  hash: string
  filename: string
  format: DesignAssetFormat
  byteLength: number
  createdAt: string
}

export interface DesignAssetInput {
  hash: string
  filename: string
  format: DesignAssetFormat
  byteLength: number
}

export interface DesignAssetRepository {
  list(owner: Owner): Promise<DesignAssetRecord[]>
  find(owner: Owner, hash: string): Promise<DesignAssetRecord | null>
  /** Idempotent: re-uploading identical content is a no-op by construction. */
  record(owner: Owner, input: DesignAssetInput): Promise<DesignAssetRecord>
}

export interface Repositories {
  memberships: MembershipRepository
  settings: SettingsRepository
  audit: AuditRepository
  keycapTrays: KeycapTrayRepository
  keycapProjects: KeycapProjectRepository
  designDocuments: DesignDocumentRepository
  designAssets: DesignAssetRepository
}
