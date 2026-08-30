// The document every designer sub-app reads and writes. One envelope, three
// kinds: Shaper opening a Bambu or Playground file is the point of the shared
// shape, not an afterthought.
//
// Millimetres, y-up (CAD convention), matching src/geometry/vec.ts. The SVG
// exporter is still the only place y-down exists.

export type DocumentKind = 'shaper' | 'bambu' | 'playground'

export type Triple = readonly [number, number, number]

export interface Transform {
  /** Millimetres from the document origin. Shaper ignores z. */
  position: Triple
  /** Degrees about x, y, z, applied in that order. */
  rotationDeg: Triple
  scale: Triple
}

/**
 * Tinkercad's central idea: a shape either adds material or removes it, and
 * grouping is what resolves the two. A `hole` outside any group is inert.
 */
export type ObjectMode = 'solid' | 'hole'

/** The five cut types Shaper Origin encodes -- see src/export/shaperSvg.ts. */
export type CutType = 'exterior' | 'interior' | 'pocket' | 'online' | 'guide'

export interface CutSpec {
  type: CutType
  /** Pocket depth in mm. Ignored by the through and marking cut types. */
  depthMm?: number
}

export interface SceneObjectBase {
  id: string
  name: string
  transform: Transform
  mode: ObjectMode
  visible: boolean
  locked: boolean
  /** CSS hex. Presentation only -- never reaches an exporter. */
  color?: string
  /** Shaper only. The 3D sub-apps carry it through untouched. */
  cut?: CutSpec
}

export type Shape2DKind = 'circle' | 'ellipse' | 'rect' | 'square' | 'triangle' | 'polygon'

/**
 * One flat bag rather than a union per shape: the hand-written validator stays
 * readable, and the inspector can bind a field without narrowing first. Which
 * keys matter is decided by `shape` -- see src/geometry/fromScene.ts.
 */
export interface Shape2DParams {
  widthMm?: number
  heightMm?: number
  radiusMm?: number
  radiusYMm?: number
  /** Regular polygon only. 3..64. */
  sides?: number
  cornerRadiusMm?: number
}

export type SolidKind = 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus' | 'wedge'

export interface SolidParams {
  widthMm?: number
  depthMm?: number
  heightMm?: number
  radiusMm?: number
  /** Cone top radius; 0 is a true point. */
  topRadiusMm?: number
  /** Torus tube radius. */
  tubeMm?: number
  /** Radial resolution. 8..256. */
  segments?: number
}

export type ImportFormat = 'stl' | 'obj' | 'svg' | 'dxf' | '3mf'

/**
 * Imported binaries are not persisted server-side (PRODUCT.md: the server holds
 * parameters, never fabrication data). The bytes live in the browser's IndexedDB
 * keyed by `hash`; this is the reference the document carries.
 */
export interface AssetRef {
  /** SHA-256 of the file bytes, lowercase hex. */
  hash: string
  filename: string
  byteLength: number
}

export interface Shape2DObject extends SceneObjectBase {
  type: 'shape2d'
  shape: Shape2DKind
  params: Shape2DParams
  /** Extrusion height when a 2D shape is used in a 3D sub-app. */
  thicknessMm?: number
}

export interface TextObject extends SceneObjectBase {
  type: 'text'
  text: string
  /** Key into src/text/fonts.ts. Outlines are resolved at render time. */
  fontId: string
  sizeMm: number
  letterSpacing?: number
  thicknessMm?: number
}

export interface SolidObject extends SceneObjectBase {
  type: 'solid'
  primitive: SolidKind
  params: SolidParams
}

export interface ImportedObject extends SceneObjectBase {
  type: 'imported'
  format: ImportFormat
  asset: AssetRef
}

export interface GroupObject extends SceneObjectBase {
  type: 'group'
  children: SceneObject[]
}

export type SceneObject =
  | Shape2DObject
  | TextObject
  | SolidObject
  | ImportedObject
  | GroupObject

export type SceneObjectType = SceneObject['type']

// -- Machine profiles ---------------------------------------------------------

export interface CncProfile {
  kind: 'cnc'
  id: string
  label: string
  toolDiameterMm: number
  stockThicknessMm: number
  /** Advisory only; nothing is ever auto-corrected. */
  maxDepthPerPassMm: number
}

export interface PrinterProfile {
  kind: 'printer'
  id: string
  label: string
  /** Usable envelope with the main nozzle only, mm. */
  buildMm: Triple
  /** Reduced envelope when both nozzles are active, if the machine is dual. */
  dualNozzleBuildMm?: Triple
  nozzleDiameterMm: number
  maxNozzleC: number
  maxBedC: number
  /** Actively heated chamber, if fitted. */
  chamberC?: number
}

export type MachineProfile = CncProfile | PrinterProfile

// -- Playground transcript ----------------------------------------------------

/**
 * The prompt history only. The geometry it produced is already in `objects`, so
 * storing a program per turn would duplicate the document at every step.
 */
export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** ISO-8601. */
  at: string
  /** Assistant turns: what changed, e.g. "added cable-cutout, modified base". */
  summary?: string
}

// -- The document ------------------------------------------------------------

export interface DesignDocument {
  id: string
  name: string
  notes?: string
  kind: DocumentKind
  objects: SceneObject[]
  machine?: MachineProfile
  /** Playground only. */
  chat?: ChatTurn[]
  /**
   * Monotonic, bumped by every mutation. It is the useMemo key for geometry
   * rebuilds and the dirty flag for save -- never deep-compare the tree.
   */
  revision: number
}
