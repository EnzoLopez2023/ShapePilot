// Complete runtime validation for the keycap project write routes.
//
// The combinators below are deliberately a third copy rather than a shared
// module: server/validation/keycapTray.ts and designDocument.ts already each
// keep their own, with signatures tuned to what they validate, and unifying
// three sets of bounds behind one interface is a refactor of two heavily tested
// files rather than part of this feature.
//
// `validateSetItems` is exported on its own because two callers need exactly
// the same rules: the PUT route, and the assistant's photo extraction. Model
// output is structurally guaranteed by the response schema but not sane -- a
// 6.25u Escape key is well-formed JSON -- so it goes through the same gate a
// hand-typed body does.
import { ApiError } from '../errors/ApiError.ts'
import type {
  KeycapProjectInput, ProjectPhotoInput, SetItemInput,
} from '../../lib/db/repositories/contracts.ts'
import { SET_ITEM_SOURCES } from '../../lib/db/repositories/contracts.ts'
import { POCKET_SHAPES } from './keycapTray.ts'

/**
 * Bounds. A keyboard set is at most a few hundred distinct caps, and 13u is the
 * widest pocket the library ships; these only exist to keep a broken or hostile
 * payload out of storage.
 */
export const LIMITS = {
  nameMaxLength: 200,
  notesMaxLength: 4_000,
  setNameMaxLength: 200,
  manufacturerMaxLength: 120,
  capProfileMaxLength: 60,
  colorwayMaxLength: 120,
  legendMaxLength: 40,
  groupMaxLength: 60,
  colorMaxLength: 40,
  captionMaxLength: 200,
  maxItems: 300,
  maxPhotos: 12,
  minCount: 1,
  maxCount: 999,
  /** Matches LIBRARY_UNITS in the client's model/presets.ts: 1u to 13u. */
  minUnits: 0.25,
  maxUnits: 13,
  minHeightUnits: 1,
  maxHeightUnits: 5,
} as const

/** A content hash names bytes in the asset store; anything else is not one. */
const HEX64 = /^[0-9a-f]{64}$/

const bad = (field: string, message: string): never => {
  throw new ApiError(400, 'bad_request', message, { field })
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(value)) bad(field, `${field} must be a JSON object`)
  return value as Record<string, unknown>
}

function rejectUnknownKeys(
  value: Record<string, unknown>, allowed: readonly string[], field: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      bad(`${field}.${key}`, `${field} does not accept the field "${key}"`)
    }
  }
}

const absent = (value: unknown): boolean => value === undefined || value === null

interface NumberBounds {
  min: number
  max: number
  integer?: boolean
}

/** A number and nothing else: `"1"`, `true`, `NaN` and `Infinity` are refused. */
function requireNumber(value: unknown, field: string, bounds: NumberBounds): number {
  if (typeof value !== 'number') bad(field, `${field} must be a number`)
  const numeric = value as number
  if (!Number.isFinite(numeric)) bad(field, `${field} must be a finite number`)
  if (bounds.integer && !Number.isInteger(numeric)) bad(field, `${field} must be a whole number`)
  if (numeric < bounds.min) bad(field, `${field} must be at least ${bounds.min}`)
  if (numeric > bounds.max) bad(field, `${field} must be at most ${bounds.max}`)
  return numeric
}

const optionalNumber = (
  value: unknown, field: string, bounds: NumberBounds,
): number | undefined => (absent(value) ? undefined : requireNumber(value, field, bounds))

function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') bad(field, `${field} must be text`)
  const text = value as string
  if (text.length > maxLength) {
    bad(field, `${field} must be at most ${maxLength} characters`)
  }
  return text
}

/**
 * Optional free text. An empty string is read as "not set" rather than stored,
 * so a cleared field and an untouched one look the same on the way back out.
 */
function optionalText(
  value: unknown, field: string, maxLength: number,
): string | undefined {
  if (absent(value)) return undefined
  const text = requireString(value, field, maxLength).trim()
  return text === '' ? undefined : text
}

function requireEnum<T extends string>(
  value: unknown, field: string, allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    bad(field, `${field} must be one of ${allowed.join(', ')}`)
  }
  return value as T
}

// -- set items ----------------------------------------------------------------

const ITEM_KEYS = [
  'legend', 'units', 'heightUnits', 'shape', 'count', 'group', 'color', 'source',
] as const

/**
 * Cap widths are quantised to quarter-units. Every real keycap is a whole
 * number of quarter-units wide, and letting arbitrary reals through would put
 * a 1.3333u row next to a 1.25u one in a breakdown meant to be read at a glance.
 */
const QUARTER_UNIT = 0.25

const onQuarterUnit = (value: number): boolean =>
  Math.abs(Math.round(value / QUARTER_UNIT) * QUARTER_UNIT - value) < 1e-9

export function validateSetItems(value: unknown, field = 'items'): SetItemInput[] {
  if (!Array.isArray(value)) bad(field, `${field} must be an array`)
  const raw = value as unknown[]
  if (raw.length > LIMITS.maxItems) {
    bad(field, `${field} must hold at most ${LIMITS.maxItems} rows`)
  }

  return raw.map((entry, index) => {
    const at = `${field}[${index}]`
    const item = requireObject(entry, at)
    rejectUnknownKeys(item, ITEM_KEYS, at)

    const units = requireNumber(item.units, `${at}.units`, {
      min: LIMITS.minUnits, max: LIMITS.maxUnits,
    })
    if (!onQuarterUnit(units)) {
      bad(`${at}.units`, `${at}.units must be a multiple of ${QUARTER_UNIT}`)
    }

    const heightUnits = optionalNumber(item.heightUnits, `${at}.heightUnits`, {
      min: LIMITS.minHeightUnits, max: LIMITS.maxHeightUnits,
    })
    if (heightUnits !== undefined && !onQuarterUnit(heightUnits)) {
      bad(`${at}.heightUnits`, `${at}.heightUnits must be a multiple of ${QUARTER_UNIT}`)
    }

    const count = optionalNumber(item.count, `${at}.count`, {
      min: LIMITS.minCount, max: LIMITS.maxCount, integer: true,
    })

    // Rebuilt field by field, so nothing unvalidated survives.
    const built: SetItemInput = { units }
    const legend = optionalText(item.legend, `${at}.legend`, LIMITS.legendMaxLength)
    if (legend !== undefined) built.legend = legend
    if (heightUnits !== undefined) built.heightUnits = heightUnits
    if (!absent(item.shape)) {
      built.shape = requireEnum(item.shape, `${at}.shape`, POCKET_SHAPES)
    }
    if (count !== undefined) built.count = count
    const group = optionalText(item.group, `${at}.group`, LIMITS.groupMaxLength)
    if (group !== undefined) built.group = group
    const color = optionalText(item.color, `${at}.color`, LIMITS.colorMaxLength)
    if (color !== undefined) built.color = color
    if (!absent(item.source)) {
      built.source = requireEnum(item.source, `${at}.source`, SET_ITEM_SOURCES)
    }
    return built
  })
}

// -- project ------------------------------------------------------------------

const PROJECT_KEYS = [
  'name', 'notes', 'setName', 'manufacturer', 'capProfile', 'colorway', 'items',
] as const

export function validateKeycapProjectInput(value: unknown): KeycapProjectInput {
  const body = requireObject(value, 'body')
  rejectUnknownKeys(body, PROJECT_KEYS, 'body')

  if (typeof body.name !== 'string' || body.name.trim() === '') {
    bad('name', 'name is required')
  }
  const name = requireString(body.name, 'name', LIMITS.nameMaxLength)

  const input: KeycapProjectInput = { name }
  const notes = optionalText(body.notes, 'notes', LIMITS.notesMaxLength)
  if (notes !== undefined) input.notes = notes
  const setName = optionalText(body.setName, 'setName', LIMITS.setNameMaxLength)
  if (setName !== undefined) input.setName = setName
  const manufacturer = optionalText(
    body.manufacturer, 'manufacturer', LIMITS.manufacturerMaxLength)
  if (manufacturer !== undefined) input.manufacturer = manufacturer
  const capProfile = optionalText(body.capProfile, 'capProfile', LIMITS.capProfileMaxLength)
  if (capProfile !== undefined) input.capProfile = capProfile
  const colorway = optionalText(body.colorway, 'colorway', LIMITS.colorwayMaxLength)
  if (colorway !== undefined) input.colorway = colorway

  // An absent `items` leaves the inventory alone; `[]` clears it. The
  // distinction is load-bearing in the repository, so it survives here.
  if (body.items !== undefined) input.items = validateSetItems(body.items)
  return input
}

const PHOTO_KEYS = ['hash', 'caption'] as const

export function validateProjectPhotoInput(value: unknown): ProjectPhotoInput {
  const body = requireObject(value, 'body')
  rejectUnknownKeys(body, PHOTO_KEYS, 'body')

  const hash = requireString(body.hash, 'hash', 64)
  if (!HEX64.test(hash)) bad('hash', 'hash must be a 64-character content hash')

  const photo: ProjectPhotoInput = { hash }
  const caption = optionalText(body.caption, 'caption', LIMITS.captionMaxLength)
  if (caption !== undefined) photo.caption = caption
  return photo
}
