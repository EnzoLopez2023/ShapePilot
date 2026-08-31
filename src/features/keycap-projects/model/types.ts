// Keycap project types, as they cross the wire.
//
// These mirror the server contracts in lib/db/repositories/contracts.ts rather
// than importing them: the client owns its own view of the API, exactly as
// keycap-tray/service.ts and services/designDocuments.ts do.

/** Where a row came from. A row read off a photo is marked until it is edited. */
export type SetItemSource = 'manual' | 'photo'

export interface SetItem {
  /** Absent on a row that has not been saved yet. */
  id?: string
  legend?: string
  /** Cap width in u -- the same vocabulary as a pocket. */
  units: number
  heightUnits?: number
  shape?: 'rect' | 'iso-enter'
  count?: number
  group?: string
  color?: string
  source?: SetItemSource
}

export interface ProjectPhoto {
  hash: string
  caption?: string
  createdAt: string
}

/** How many pockets of each size the project's trays already hold. */
export interface CoverageRow {
  units: number
  heightUnits: number
  shape: 'rect' | 'iso-enter' | null
  /** A quarter turn swaps a pocket's sides, so it is part of its footprint. */
  rotationDeg?: number
  pockets: number
}

export interface KeycapProject {
  id: string
  name: string
  notes?: string
  setName?: string
  manufacturer?: string
  /** Cherry, SA, DSA -- the cap sculpt, not the tray outline. */
  capProfile?: string
  colorway?: string
  items: SetItem[]
  photos: ProjectPhoto[]
  coverage: CoverageRow[]
  createdAt: string
  updatedAt: string
}

export interface ProjectSummary {
  id: string
  name: string
  setName?: string
  capProfile?: string
  colorway?: string
  /** Sum of every row's count, not the number of rows. */
  capCount: number
  trayCount: number
  photoCount: number
  createdAt: string
  updatedAt: string
}

/** The write payload. `items` may be omitted to leave the inventory alone. */
export interface ProjectInput {
  name: string
  notes?: string
  setName?: string
  manufacturer?: string
  capProfile?: string
  colorway?: string
  items?: SetItem[]
}
