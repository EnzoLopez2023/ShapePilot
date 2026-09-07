// Complete runtime validation for the keycap tray write routes.
//
// Every design and library body is validated in full — shape, discriminated
// profile, geometry, sizing, dimensions and every pocket field — *before* a
// repository call opens a transaction. A rejected body is a stable typed 400
// carrying the offending field, and it can never reach SQLite.
//
// What is deliberately preserved from the pinned Hearth route:
//
//   * the messages `name is required` and `profile.kind is required`
//   * optional dimensions keep their pinned defaults (2.4 / 10 / 0.4)
//   * `sizing` may be absent, exactly as before, and is stored as `{}`
//   * `shape` is accepted on the wire, validated, and persisted (ShapePilot's
//     ISO Enter editor needs it); `mirrorX`/`flipY` pack into the `mirror_x`
//     column as a 0-3 bitfield. Legacy rows are 0/NULL, so import is unchanged.
//
// What is new is only refusal: NaN, Infinity, numeric strings, unknown keys,
// unknown enum values, unknown preset ids, degenerate or unbounded geometry and
// absurd magnitudes are 400s instead of rows. `rotationDeg` is now any finite
// angle in [0, 360) rather than only 0 or 90.
import type {
  LibraryPocketInput, PocketInput, TrayDesignInput,
} from '../../lib/db/repositories/contracts.ts'
import {
  absent, bad, optionalBoolean, optionalNumber, optionalString, rejectUnknownKeys,
  requireEnum, requireNumber, requireObject, requireString,
} from './primitives.ts'
import { PROFILE_LIMITS, validateTrayProfile } from './trayProfile.ts'

interface PocketSizing {
  pitch: number
  widthOffset: number
  height: number
  cornerRadius: number
  cornerSegments: number
}

const DEFAULT_SIZING: PocketSizing = {
  pitch: 19.05,
  widthOffset: -0.25,
  height: 18.8,
  cornerRadius: 1,
  cornerSegments: 16,
}

export { KNOWN_PRESET_PROFILE_IDS, PROFILE_KINDS } from './trayProfile.ts'

export const LABEL_MODES = ['guide', 'engrave', 'none'] as const
export const POCKET_SHAPES = ['rect', 'iso-enter'] as const

/**
 * Bounds. Every one of these is far beyond any real tray — a Systainer insert
 * is 249 x 165 mm with about eighty 1u pockets — and their only job is to keep
 * a hostile or broken payload from reaching storage or the mesher.
 */
export const LIMITS = {
  ...PROFILE_LIMITS,
  nameMaxLength: 200,
  notesMaxLength: 4_000,
  labelMaxLength: 200,
  clientIdMaxLength: 128,
  maxPockets: 512,
  maxDepthMm: 1_000,
  maxUnits: 100,
  maxPitchMm: 1_000,
  maxWidthOffsetMm: 1_000,
  maxCornerSegments: 256,
} as const


// -- sizing -------------------------------------------------------------------

function validateSizing(value: unknown): { stored: unknown; effective: PocketSizing } {
  if (absent(value)) return { stored: undefined, effective: DEFAULT_SIZING }
  const sizing = requireObject(value, 'sizing')
  if (Object.keys(sizing).length === 0) {
    return { stored: sizing, effective: DEFAULT_SIZING }
  }
  rejectUnknownKeys(
    sizing, ['pitch', 'widthOffset', 'height', 'cornerRadius', 'cornerSegments'], 'sizing')

  const effective = {
    pitch: requireNumber(
      sizing.pitch, 'sizing.pitch', { exclusiveMin: 0, max: LIMITS.maxPitchMm }),
    widthOffset: requireNumber(
      sizing.widthOffset, 'sizing.widthOffset', { max: LIMITS.maxWidthOffsetMm }),
    height: requireNumber(
      sizing.height, 'sizing.height', { exclusiveMin: 0, max: LIMITS.maxPitchMm }),
    cornerRadius: requireNumber(
      sizing.cornerRadius, 'sizing.cornerRadius', { min: 0, max: LIMITS.maxRadiusMm }),
    cornerSegments: requireNumber(sizing.cornerSegments, 'sizing.cornerSegments', {
    exclusiveMin: 0, max: LIMITS.maxCornerSegments, integer: true,
    }),
  }
  return { stored: sizing, effective }
}

// -- pockets ------------------------------------------------------------------

const POCKET_KEYS = [
  'id', 'units', 'heightUnits', 'x', 'y', 'rotationDeg', 'mirrorX', 'flipY',
  'isThrough', 'shape', 'depthMm', 'label', 'labelMode',
  'widthMm', 'heightMm', 'cornerRadiusMm', 'locatingPosts',
] as const

/**
 * One post per 1u slot in this pocket. Absent or null means none; an object
 * sets all three dimensions. `boreDiameterMm` must be smaller than
 * `outerDiameterMm`, or there is no wall left for the post to print.
 */
function validateLocatingPosts(
  value: unknown, field: string,
): { heightMm: number; outerDiameterMm: number; boreDiameterMm: number } | undefined {
  if (absent(value)) return undefined
  const posts = requireObject(value, field)
  rejectUnknownKeys(posts, ['heightMm', 'outerDiameterMm', 'boreDiameterMm'], field)
  const heightMm = requireNumber(posts.heightMm, `${field}.heightMm`, {
    exclusiveMin: 0, max: LIMITS.maxDepthMm,
  })
  const outerDiameterMm = requireNumber(posts.outerDiameterMm, `${field}.outerDiameterMm`, {
    exclusiveMin: 0, max: LIMITS.maxExtentMm,
  })
  const boreDiameterMm = requireNumber(posts.boreDiameterMm, `${field}.boreDiameterMm`, {
    exclusiveMin: 0, max: LIMITS.maxExtentMm,
  })
  if (boreDiameterMm >= outerDiameterMm) {
    bad(`${field}.boreDiameterMm`, `${field}.boreDiameterMm must be smaller than outerDiameterMm`)
  }
  return { heightMm, outerDiameterMm, boreDiameterMm }
}

function validatePocket(value: unknown, index: number, sizing: PocketSizing): PocketInput {
  const field = `pockets[${index}]`
  const pocket = requireObject(value, field)
  rejectUnknownKeys(pocket, POCKET_KEYS, field)

  optionalString(pocket.id, `${field}.id`, LIMITS.clientIdMaxLength)
  requireNumber(pocket.units, `${field}.units`, { exclusiveMin: 0, max: LIMITS.maxUnits })
  optionalNumber(pocket.heightUnits, `${field}.heightUnits`, {
    exclusiveMin: 0, max: LIMITS.maxUnits,
  })
  requireNumber(pocket.x, `${field}.x`, { max: LIMITS.maxCoordinateMm })
  requireNumber(pocket.y, `${field}.y`, { max: LIMITS.maxCoordinateMm })

  if (!absent(pocket.rotationDeg)) {
    const rotation = requireNumber(pocket.rotationDeg, `${field}.rotationDeg`, { min: 0, max: 360 })
    if (rotation >= 360) {
      bad(`${field}.rotationDeg`, `${field}.rotationDeg must be in [0, 360)`)
    }
  }

  optionalBoolean(pocket.isThrough, `${field}.isThrough`)
  optionalBoolean(pocket.mirrorX, `${field}.mirrorX`)
  optionalBoolean(pocket.flipY, `${field}.flipY`)

  // `shape`, `mirrorX` and `flipY` are all persisted -- `shape` in its own
  // column, the two flags packed into `mirror_x` as a 0-3 bitfield by the repo.
  if (!absent(pocket.shape)) requireEnum(pocket.shape, `${field}.shape`, POCKET_SHAPES)

  if (!absent(pocket.label)) requireString(pocket.label, `${field}.label`, LIMITS.labelMaxLength)
  if (!absent(pocket.labelMode)) requireEnum(pocket.labelMode, `${field}.labelMode`, LABEL_MODES)

  optionalNumber(pocket.depthMm, `${field}.depthMm`, { exclusiveMin: 0, max: LIMITS.maxDepthMm })
  optionalNumber(pocket.widthMm, `${field}.widthMm`, { exclusiveMin: 0, max: LIMITS.maxExtentMm })
  optionalNumber(pocket.heightMm, `${field}.heightMm`, { exclusiveMin: 0, max: LIMITS.maxExtentMm })
  optionalNumber(pocket.cornerRadiusMm, `${field}.cornerRadiusMm`, {
    min: 0, max: LIMITS.maxRadiusMm,
  })
  // Rebuilt rather than passed through, so nothing unvalidated survives.
  ;(pocket as Record<string, unknown>).locatingPosts =
    validateLocatingPosts(pocket.locatingPosts, `${field}.locatingPosts`)

  const shape = (pocket.shape ?? 'rect') as (typeof POCKET_SHAPES)[number]
  const explicitWidth = pocket.widthMm as number | undefined
  const width = shape === 'iso-enter'
    ? explicitWidth ?? sizing.pitch * 1.5 + sizing.widthOffset
    : explicitWidth ?? sizing.pitch * (pocket.units as number) + sizing.widthOffset
  const heightUnits = (pocket.heightUnits as number | undefined) ?? 1
  const height = (pocket.heightMm as number | undefined)
    ?? (heightUnits <= 1 ? sizing.height : sizing.pitch * heightUnits + sizing.widthOffset)
  if (!(width > 0)) bad(`${field}.widthMm`, `${field} resolves to a non-positive width`)
  if (!(height > 0)) bad(`${field}.heightMm`, `${field} resolves to a non-positive height`)

  return pocket as unknown as PocketInput
}

function validatePockets(value: unknown, sizing: PocketSizing): PocketInput[] | undefined {
  if (absent(value)) return undefined
  if (!Array.isArray(value)) bad('pockets', 'pockets must be an array')
  const pockets = value as unknown[]
  if (pockets.length > LIMITS.maxPockets) {
    bad('pockets', `a design may have at most ${LIMITS.maxPockets} pockets`)
  }
  return pockets.map((pocket, index) => validatePocket(pocket, index, sizing))
}

// -- entry points -------------------------------------------------------------

const DESIGN_KEYS = [
  'name', 'projectId', 'notes', 'profile', 'sizing', 'floorThicknessMm', 'pocketDepthMm',
  'engraveDepthMm', 'cornerSpacers', 'nameplate', 'pockets',
] as const

/**
 * Corner-spacer posts: absent or null means none, an object sets both
 * dimensions. Bounded like every other extent so a broken payload cannot reach
 * the mesher.
 */
function validateCornerSpacers(
  value: unknown,
): { heightMm: number; sizeMm: number; separate?: boolean } | undefined {
  if (absent(value)) return undefined
  const spacers = requireObject(value, 'cornerSpacers')
  rejectUnknownKeys(spacers, ['heightMm', 'sizeMm', 'separate'], 'cornerSpacers')
  const separate = optionalBoolean(spacers.separate, 'cornerSpacers.separate')
  return {
    heightMm: requireNumber(spacers.heightMm, 'cornerSpacers.heightMm', {
      exclusiveMin: 0, max: LIMITS.maxDepthMm,
    }),
    sizeMm: requireNumber(spacers.sizeMm, 'cornerSpacers.sizeMm', {
      exclusiveMin: 0, max: LIMITS.maxExtentMm,
    }),
    ...(separate === undefined ? {} : { separate }),
  }
}

/**
 * Raised tray-name text: absent or null means none, an object sets the emboss
 * height, cap height and the run's centre. Bounded like every other extent so a
 * broken payload cannot reach the mesher.
 */
function validateNameplate(
  value: unknown,
): { heightMm: number; fontSizeMm: number; x: number; y: number } | undefined {
  if (absent(value)) return undefined
  const np = requireObject(value, 'nameplate')
  rejectUnknownKeys(np, ['heightMm', 'fontSizeMm', 'x', 'y'], 'nameplate')
  return {
    heightMm: requireNumber(np.heightMm, 'nameplate.heightMm', {
      exclusiveMin: 0, max: LIMITS.maxDepthMm,
    }),
    fontSizeMm: requireNumber(np.fontSizeMm, 'nameplate.fontSizeMm', {
      exclusiveMin: 0, max: LIMITS.maxExtentMm,
    }),
    x: requireNumber(np.x, 'nameplate.x', { max: LIMITS.maxCoordinateMm }),
    y: requireNumber(np.y, 'nameplate.y', { max: LIMITS.maxCoordinateMm }),
  }
}

/** Row ids are integers in SQLite and strings on the wire. */
const ROW_ID = /^[0-9]{1,19}$/

/**
 * Three distinct meanings, all of them wanted:
 *   * absent   -- leave the tray's project link exactly as it is
 *   * `null`   -- unassign it
 *   * an id    -- link it, once the route has proved the caller owns that project
 */
function validateProjectId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const id = requireString(value, 'projectId', 19)
  if (!ROW_ID.test(id)) bad('projectId', 'projectId must be a project id')
  return id
}

/**
 * Validate a create or update body completely. Field order matters: `name` and
 * then `profile.kind` are checked first so the pinned 400s are unchanged.
 */
export function validateTrayDesignInput(value: unknown): TrayDesignInput {
  const body = requireObject(value, 'body')
  rejectUnknownKeys(body, DESIGN_KEYS, 'body')

  if (typeof body.name !== 'string' || body.name.trim() === '') {
    bad('name', 'name is required')
  }
  const name = requireString(body.name, 'name', LIMITS.nameMaxLength)
  const profile = validateTrayProfile(body.profile)

  const notes = absent(body.notes)
    ? undefined
    : requireString(body.notes, 'notes', LIMITS.notesMaxLength)

  const sizing = validateSizing(body.sizing)

  const floorThicknessMm = optionalNumber(body.floorThicknessMm, 'floorThicknessMm', {
    exclusiveMin: 0, max: LIMITS.maxDepthMm,
  })
  const pocketDepthMm = optionalNumber(body.pocketDepthMm, 'pocketDepthMm', {
    exclusiveMin: 0, max: LIMITS.maxDepthMm,
  })
  const engraveDepthMm = optionalNumber(body.engraveDepthMm, 'engraveDepthMm', {
    min: 0, max: LIMITS.maxDepthMm,
  })
  const cornerSpacers = validateCornerSpacers(body.cornerSpacers)
  const nameplate = validateNameplate(body.nameplate)

  const pockets = validatePockets(body.pockets, sizing.effective)

  const projectId = validateProjectId(body.projectId)

  // Rebuilt rather than passed through, so nothing unvalidated survives.
  const input: TrayDesignInput = { name, profile }
  if (projectId !== undefined) input.projectId = projectId
  if (notes !== undefined) input.notes = notes
  if (sizing.stored !== undefined) input.sizing = sizing.stored
  if (floorThicknessMm !== undefined) input.floorThicknessMm = floorThicknessMm
  if (pocketDepthMm !== undefined) input.pocketDepthMm = pocketDepthMm
  if (engraveDepthMm !== undefined) input.engraveDepthMm = engraveDepthMm
  if (cornerSpacers !== undefined) input.cornerSpacers = cornerSpacers
  if (nameplate !== undefined) input.nameplate = nameplate
  if (pockets !== undefined) input.pockets = pockets
  return input
}

const LIBRARY_KEYS = [
  'name', 'units', 'widthMm', 'heightMm', 'cornerRadiusMm', 'notes',
] as const

export function validateLibraryPocketInput(value: unknown): LibraryPocketInput {
  const body = requireObject(value, 'body')
  rejectUnknownKeys(body, LIBRARY_KEYS, 'body')

  if (typeof body.name !== 'string' || body.name.trim() === '') {
    bad('name', 'name is required')
  }
  const name = requireString(body.name, 'name', LIMITS.nameMaxLength)

  const units = optionalNumber(body.units, 'units', { exclusiveMin: 0, max: LIMITS.maxUnits })
  const widthMm = optionalNumber(body.widthMm, 'widthMm', {
    exclusiveMin: 0, max: LIMITS.maxExtentMm,
  })
  const heightMm = optionalNumber(body.heightMm, 'heightMm', {
    exclusiveMin: 0, max: LIMITS.maxExtentMm,
  })
  const cornerRadiusMm = optionalNumber(body.cornerRadiusMm, 'cornerRadiusMm', {
    min: 0, max: LIMITS.maxRadiusMm,
  })
  const notes = absent(body.notes)
    ? undefined
    : requireString(body.notes, 'notes', LIMITS.notesMaxLength)

  return {
    name,
    units: units ?? 1,
    widthMm: widthMm ?? null,
    heightMm: heightMm ?? null,
    cornerRadiusMm: cornerRadiusMm ?? null,
    notes: notes ?? null,
  }
}

/**
 * The clone body carries an optional replacement name and an optional target
 * project. `projectId` has the same three meanings as on a design write: absent
 * keeps the source's project, `null` unassigns the copy, an id moves it (the
 * route then proves the caller owns that project).
 */
export function validateCloneRequest(value: unknown): { name?: string; projectId?: string | null } {
  const body = requireObject(value ?? {}, 'body')
  rejectUnknownKeys(body, ['name', 'projectId'], 'body')
  const result: { name?: string; projectId?: string | null } = {}
  if (!absent(body.name)) {
    const name = requireString(body.name, 'name', LIMITS.nameMaxLength)
    if (name.trim() !== '') result.name = name
  }
  if ('projectId' in body) {
    const projectId = validateProjectId(body.projectId)
    if (projectId !== undefined) result.projectId = projectId
  }
  return result
}
