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

export interface AppPreferences {
  themeMode: 'light' | 'dark' | 'system'
  units: 'mm' | 'in'
  reducedMotion: 'system' | 'reduce' | 'no-preference'
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
  listDesigns(owner: Owner): Promise<TrayDesignSummary[]>
  getDesign(owner: Owner, id: string): Promise<TrayDesignRecord | null>
  createDesign(owner: Owner, input: TrayDesignInput): Promise<{ id: string }>
  updateDesign(owner: Owner, id: string, input: TrayDesignInput): Promise<boolean>
  cloneDesign(owner: Owner, id: string, name?: string): Promise<{ id: string } | null>
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

export interface Repositories {
  memberships: MembershipRepository
  settings: SettingsRepository
  audit: AuditRepository
  keycapTrays: KeycapTrayRepository
}
