// Complete runtime validation for the switch tray write routes.
//
// The same contract the keycap tray keeps: every payload is *rebuilt* from
// validated parts rather than passed through, every object rejects keys it does
// not know, and a number is a number rather than a coerced string. Nothing
// reaches SQLite until it has been through here.
//
// A switch tray carries no cell list -- the layout is generated -- so what is
// validated is the handful of parameters that generate it. That also means the
// bounds matter more than usual: a pitch of 0 or a margin of 10,000 would not
// be a bad row, it would be a planner that never terminates.
import type { SwitchTrayInput } from '../../lib/db/repositories/contracts.ts'
import {
  absent, optionalBoolean, optionalNumber, optionalString, rejectUnknownKeys,
  requireEnum, requireNumber, requireObject, requireString, bad,
} from './primitives.ts'
import { PROFILE_LIMITS, validateTrayProfile } from './trayProfile.ts'

export const RETENTIONS = ['shelf', 'clip', 'plain'] as const
export const STAGGERS = ['none', 'brick'] as const
export const ORIGINS = ['centred', 'maximised'] as const
export const FOOT_PATTERNS = ['corners', 'corners+edges'] as const
export const FOOT_TIERS = ['stacked', 'bottom'] as const

/**
 * Bounds. Every one is far outside any real tray -- a Systainer insert is
 * 249 x 165 mm and the closest two MX switches will ever stand is 16 mm -- and
 * their job is to keep a hostile or broken payload out of storage and out of
 * the fill planner.
 */
export const LIMITS = {
  ...PROFILE_LIMITS,
  nameMaxLength: 200,
  notesMaxLength: 4_000,
  labelMaxLength: 200,
  /** A tray of 250 cells would already be absurd; this is the ceiling on skips. */
  maxSkippedCells: 2_048,
  skippedCellMaxLength: 16,
  /** Any switch dimension, and any plate thickness. */
  maxDimensionMm: 100,
  minPitchMm: 1,
  maxPitchMm: 200,
  maxMarginMm: 200,
  maxFootHeightMm: 200,
  maxCaseHeightMm: 2_000,
} as const

const dim = (value: unknown, field: string) =>
  requireNumber(value, field, { exclusiveMin: 0, max: LIMITS.maxDimensionMm })

function validateSwitchProfile(value: unknown): Record<string, unknown> {
  const s = requireObject(value, 'switch')
  rejectUnknownKeys(s, [
    'id', 'label', 'bodyMm', 'housingMm', 'flangeToTopMm', 'flangeToTipMm',
    'clipPlateMm', 'standardPitchMm', 'minPitchMm', 'source',
  ], 'switch')
  // `id` is free text on purpose: the switch is stored whole, so a tray built
  // on a profile this build has never heard of still opens and still prints.
  return {
    id: requireString(s.id, 'switch.id', LIMITS.labelMaxLength),
    label: requireString(s.label, 'switch.label', LIMITS.labelMaxLength),
    bodyMm: dim(s.bodyMm, 'switch.bodyMm'),
    housingMm: dim(s.housingMm, 'switch.housingMm'),
    flangeToTopMm: dim(s.flangeToTopMm, 'switch.flangeToTopMm'),
    flangeToTipMm: dim(s.flangeToTipMm, 'switch.flangeToTipMm'),
    clipPlateMm: dim(s.clipPlateMm, 'switch.clipPlateMm'),
    standardPitchMm: requireNumber(s.standardPitchMm, 'switch.standardPitchMm', {
      min: LIMITS.minPitchMm, max: LIMITS.maxPitchMm,
    }),
    minPitchMm: requireNumber(s.minPitchMm, 'switch.minPitchMm', {
      min: LIMITS.minPitchMm, max: LIMITS.maxPitchMm,
    }),
    source: requireString(s.source, 'switch.source', LIMITS.notesMaxLength),
  }
}

function validatePlate(value: unknown): Record<string, unknown> {
  const p = requireObject(value, 'plate')
  rejectUnknownKeys(p, [
    'retention', 'shelfMm', 'recessMm', 'holeClearanceMm', 'recessClearanceMm', 'cornerRadiusMm',
  ], 'plate')
  return {
    retention: requireEnum(p.retention, 'plate.retention', RETENTIONS),
    shelfMm: dim(p.shelfMm, 'plate.shelfMm'),
    recessMm: requireNumber(p.recessMm, 'plate.recessMm', { min: 0, max: LIMITS.maxDimensionMm }),
    holeClearanceMm: requireNumber(p.holeClearanceMm, 'plate.holeClearanceMm', {
      min: 0, max: LIMITS.maxDimensionMm,
    }),
    recessClearanceMm: requireNumber(p.recessClearanceMm, 'plate.recessClearanceMm', {
      min: 0, max: LIMITS.maxDimensionMm,
    }),
    cornerRadiusMm: requireNumber(p.cornerRadiusMm, 'plate.cornerRadiusMm', {
      min: 0, max: LIMITS.maxRadiusMm,
    }),
  }
}

function validateFill(value: unknown): Record<string, unknown> {
  const f = requireObject(value, 'fill')
  rejectUnknownKeys(f, [
    'pitchXMm', 'pitchYMm', 'marginMm', 'stagger', 'origin', 'spreadEvenly',
  ], 'fill')
  const pitch = (v: unknown, field: string) =>
    requireNumber(v, field, { min: LIMITS.minPitchMm, max: LIMITS.maxPitchMm })
  return {
    pitchXMm: pitch(f.pitchXMm, 'fill.pitchXMm'),
    pitchYMm: pitch(f.pitchYMm, 'fill.pitchYMm'),
    marginMm: requireNumber(f.marginMm, 'fill.marginMm', { min: 0, max: LIMITS.maxMarginMm }),
    stagger: requireEnum(f.stagger, 'fill.stagger', STAGGERS),
    origin: requireEnum(f.origin, 'fill.origin', ORIGINS),
    spreadEvenly: f.spreadEvenly === true,
  }
}

function validateFeet(value: unknown): Record<string, unknown> | undefined {
  if (absent(value)) return undefined
  const f = requireObject(value, 'feet')
  rejectUnknownKeys(f, [
    'tier', 'heightMm', 'sizeMm', 'pattern', 'bottomTierHeightMm', 'separate',
  ], 'feet')
  const separate = optionalBoolean(f.separate, 'feet.separate')
  const bottom = optionalNumber(f.bottomTierHeightMm, 'feet.bottomTierHeightMm', {
    min: 0, max: LIMITS.maxFootHeightMm,
  })
  // Optional: trays saved before the two builds were distinguished carry no
  // tier, and read back as the stacked one they were.
  const tier = absent(f.tier) ? undefined : requireEnum(f.tier, 'feet.tier', FOOT_TIERS)
  return {
    ...(tier === undefined ? {} : { tier }),
    heightMm: requireNumber(f.heightMm, 'feet.heightMm', {
      exclusiveMin: 0, max: LIMITS.maxFootHeightMm,
    }),
    sizeMm: dim(f.sizeMm, 'feet.sizeMm'),
    pattern: requireEnum(f.pattern, 'feet.pattern', FOOT_PATTERNS),
    ...(bottom === undefined ? {} : { bottomTierHeightMm: bottom }),
    ...(separate === undefined ? {} : { separate }),
  }
}

function validateNameplate(value: unknown): Record<string, unknown> | undefined {
  if (absent(value)) return undefined
  const n = requireObject(value, 'nameplate')
  rejectUnknownKeys(n, ['heightMm', 'fontSizeMm', 'x', 'y'], 'nameplate')
  return {
    heightMm: dim(n.heightMm, 'nameplate.heightMm'),
    fontSizeMm: dim(n.fontSizeMm, 'nameplate.fontSizeMm'),
    x: requireNumber(n.x, 'nameplate.x', { max: LIMITS.maxCoordinateMm }),
    y: requireNumber(n.y, 'nameplate.y', { max: LIMITS.maxCoordinateMm }),
  }
}

/** `"col,row"` and nothing else -- these index a generated grid. */
const CELL_KEY = /^-?\d{1,6},-?\d{1,6}$/

function validateSkippedCells(value: unknown): string[] | undefined {
  if (absent(value)) return undefined
  if (!Array.isArray(value)) bad('skippedCells', 'skippedCells must be an array of "col,row" keys')
  const cells = value as unknown[]
  if (cells.length > LIMITS.maxSkippedCells) {
    bad('skippedCells', `skippedCells must hold at most ${LIMITS.maxSkippedCells} entries`)
  }
  const seen = new Set<string>()
  for (const [index, cell] of cells.entries()) {
    const key = requireString(cell, `skippedCells[${index}]`, LIMITS.skippedCellMaxLength)
    if (!CELL_KEY.test(key)) {
      bad(`skippedCells[${index}]`, `skippedCells[${index}] must look like "3,4"`)
    }
    seen.add(key)
  }
  return [...seen]
}

const DESIGN_KEYS = [
  'name', 'notes', 'profile', 'switch', 'plate', 'fill', 'feet', 'nameplate',
  'skippedCells', 'caseClearHeightMm',
  // Accepted and ignored: the client round-trips whole records, and these are
  // server-owned. Refusing them would make a save of an opened tray a 400.
  'id', 'createdAt', 'updatedAt', 'revision',
] as const

export function validateSwitchTrayInput(value: unknown): SwitchTrayInput {
  const body = requireObject(value, 'body')
  rejectUnknownKeys(body, DESIGN_KEYS, 'body')

  if (typeof body.name !== 'string' || body.name.trim() === '') {
    bad('name', 'name is required')
  }
  const name = requireString(body.name, 'name', LIMITS.nameMaxLength)
  const notes = optionalString(body.notes, 'notes', LIMITS.notesMaxLength)

  const feet = validateFeet(body.feet)
  const nameplate = validateNameplate(body.nameplate)
  const skippedCells = validateSkippedCells(body.skippedCells)
  const caseClearHeightMm = optionalNumber(body.caseClearHeightMm, 'caseClearHeightMm', {
    exclusiveMin: 0, max: LIMITS.maxCaseHeightMm,
  })

  return {
    name,
    notes: notes ?? null,
    profile: validateTrayProfile(body.profile),
    switch: validateSwitchProfile(body.switch),
    plate: validatePlate(body.plate),
    fill: validateFill(body.fill),
    feet: feet ?? null,
    nameplate: nameplate ?? null,
    skippedCells: skippedCells ?? null,
    caseClearHeightMm: caseClearHeightMm ?? null,
  }
}

export function validateCloneRequest(value: unknown): { name?: string } {
  const body = requireObject(value ?? {}, 'body')
  rejectUnknownKeys(body, ['name'], 'body')
  if (absent(body.name)) return {}
  const name = requireString(body.name, 'name', LIMITS.nameMaxLength)
  return name.trim() === '' ? {} : { name }
}
