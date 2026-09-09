// Complete runtime validation for the tool tray write routes.
//
// Same contract as its siblings: every payload is *rebuilt* from validated
// parts rather than passed through, every object rejects keys it does not know,
// and a number is a number rather than a coerced string. Nothing reaches SQLite
// until it has been through here.
//
// A tool tray is the first designer here whose payload is genuinely UNBOUNDED
// in shape -- a list of pockets, each a list of steps, each with a footprint
// that may eventually be a traced outline of a few hundred points. So the
// budgets below are not tidiness: without them one row can hold a megabyte, and
// the mesher's band count is driven by the depths in that row, which puts both
// the polygon clipper and the T-junction pass in reach of a hostile payload.
import type { ToolTrayInput } from '../../lib/db/repositories/contracts.ts'
import {
  absent, optionalNumber, optionalString, rejectUnknownKeys,
  requireEnum, requireNumber, requireObject, requireString, bad,
} from './primitives.ts'
import { PROFILE_LIMITS, validateTrayProfile } from './trayProfile.ts'

export const POCKET_KINDS = ['bin', 'channel', 'cradle', 'outline', 'composite'] as const
export const STEP_SHAPES = ['rect', 'ellipse', 'polygon', 'channel', 'outline'] as const
export const FINGER_STYLES = ['scallop', 'slot'] as const
export const FINGER_SIDES = ['left', 'right', 'top', 'bottom'] as const
export const FOOT_PATTERNS = ['corners', 'corners+edges'] as const
export const RELIEF_MODES = ['ignore', 'avoid', 'generate'] as const

export const LIMITS = {
  ...PROFILE_LIMITS,
  nameMaxLength: 200,
  notesMaxLength: 4_000,
  labelMaxLength: 200,
  presetIdMaxLength: 120,
  /** Any single dimension of a tray, a pocket or a step. */
  maxDimensionMm: 2_000,
  maxHeightMm: 500,
  maxCaseHeightMm: 2_000,
  minLayerMm: 0.01,
  maxLayerMm: 5,
  maxFootHeightMm: 200,
  /**
   * The budgets. A tray of 128 pockets on a 249 x 165 mm outline would already
   * be absurd, and 16 steps is twice the most complicated reference pocket.
   */
  maxPockets: 128,
  maxStepsPerPocket: 16,
  /** Points across every channel path and traced outline in one tray. */
  maxTotalPoints: 8_000,
  maxPathPoints: 512,
  maxPolygonSides: 256,
} as const

const dim = (value: unknown, field: string) =>
  requireNumber(value, field, { exclusiveMin: 0, max: LIMITS.maxDimensionMm })

/** Points are counted across the whole payload, so the budget is shared. */
interface Budget { points: number }

function validatePoint(value: unknown, field: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    bad(field, `${field} must be a pair of numbers`)
  }
  const pair = value as unknown[]
  return [
    requireNumber(pair[0], `${field}[0]`, { min: -LIMITS.maxDimensionMm, max: LIMITS.maxDimensionMm }),
    requireNumber(pair[1], `${field}[1]`, { min: -LIMITS.maxDimensionMm, max: LIMITS.maxDimensionMm }),
  ]
}

function validateRing(value: unknown, field: string, budget: Budget): [number, number][] {
  if (!Array.isArray(value) || value.length < 3) {
    bad(field, `${field} must be a ring of at least three points`)
  }
  const ring = value as unknown[]
  if (ring.length > LIMITS.maxPathPoints) {
    bad(field, `${field} has more than ${LIMITS.maxPathPoints} points`)
  }
  budget.points += ring.length
  if (budget.points > LIMITS.maxTotalPoints) {
    bad(field, `the design has more than ${LIMITS.maxTotalPoints} outline points in total`)
  }
  return ring.map((p, i) => validatePoint(p, `${field}[${i}]`))
}

function validateStepShape(value: unknown, field: string, budget: Budget): Record<string, unknown> {
  const s = requireObject(value, field)
  const kind = requireEnum(s.kind, `${field}.kind`, STEP_SHAPES)

  switch (kind) {
    case 'rect': {
      rejectUnknownKeys(s, ['kind', 'widthMm', 'heightMm', 'cornerRadiusMm'], field)
      const cornerRadiusMm = optionalNumber(s.cornerRadiusMm, `${field}.cornerRadiusMm`, {
        min: 0, max: LIMITS.maxDimensionMm,
      })
      return {
        kind,
        widthMm: dim(s.widthMm, `${field}.widthMm`),
        heightMm: dim(s.heightMm, `${field}.heightMm`),
        ...(cornerRadiusMm === undefined ? {} : { cornerRadiusMm }),
      }
    }
    case 'ellipse':
      rejectUnknownKeys(s, ['kind', 'rxMm', 'ryMm'], field)
      return {
        kind,
        rxMm: dim(s.rxMm, `${field}.rxMm`),
        ryMm: dim(s.ryMm, `${field}.ryMm`),
      }
    case 'polygon': {
      rejectUnknownKeys(s, ['kind', 'sides', 'radiusMm', 'rotationDeg'], field)
      const rotationDeg = optionalNumber(s.rotationDeg, `${field}.rotationDeg`, {
        min: -3_600, max: 3_600,
      })
      return {
        kind,
        sides: requireNumber(s.sides, `${field}.sides`, { min: 3, max: LIMITS.maxPolygonSides }),
        radiusMm: dim(s.radiusMm, `${field}.radiusMm`),
        ...(rotationDeg === undefined ? {} : { rotationDeg }),
      }
    }
    case 'channel': {
      rejectUnknownKeys(s, ['kind', 'path', 'widthMm'], field)
      if (!Array.isArray(s.path) || s.path.length < 2) {
        bad(`${field}.path`, `${field}.path must have at least two points`)
      }
      const path = s.path as unknown[]
      if (path.length > LIMITS.maxPathPoints) {
        bad(`${field}.path`, `${field}.path has more than ${LIMITS.maxPathPoints} points`)
      }
      budget.points += path.length
      if (budget.points > LIMITS.maxTotalPoints) {
        bad(`${field}.path`, `the design has more than ${LIMITS.maxTotalPoints} points in total`)
      }
      return {
        kind,
        path: path.map((p, i) => validatePoint(p, `${field}.path[${i}]`)),
        widthMm: dim(s.widthMm, `${field}.widthMm`),
      }
    }
    case 'outline': {
      rejectUnknownKeys(s, ['kind', 'rings', 'sourceName'], field)
      if (!Array.isArray(s.rings) || s.rings.length === 0) {
        bad(`${field}.rings`, `${field}.rings must be a non-empty list of polygons`)
      }
      const sourceName = optionalString(s.sourceName, `${field}.sourceName`, LIMITS.labelMaxLength)
      return {
        kind,
        rings: (s.rings as unknown[]).map((poly, pi) => {
          if (!Array.isArray(poly) || poly.length === 0) {
            bad(`${field}.rings[${pi}]`, `${field}.rings[${pi}] must be a list of rings`)
          }
          return (poly as unknown[]).map((ring, ri) =>
            validateRing(ring, `${field}.rings[${pi}][${ri}]`, budget))
        }),
        ...(sourceName === undefined ? {} : { sourceName }),
      }
    }
  }
}

function validateStep(value: unknown, field: string, budget: Budget): Record<string, unknown> {
  const s = requireObject(value, field)
  rejectUnknownKeys(s, ['shape', 'offset', 'depthMm', 'liftOverKeepOut'], field)

  // `null` is meaningful here -- it is a through-cut -- so it cannot go through
  // `optionalNumber`, which treats null as absent.
  let depthMm: number | null = null
  if (s.depthMm !== null) {
    if (absent(s.depthMm)) bad(`${field}.depthMm`, `${field}.depthMm is required (null cuts through)`)
    depthMm = requireNumber(s.depthMm, `${field}.depthMm`, {
      exclusiveMin: 0, max: LIMITS.maxHeightMm,
    })
  }

  const lift = s.liftOverKeepOut
  if (!absent(lift) && typeof lift !== 'boolean') {
    bad(`${field}.liftOverKeepOut`, `${field}.liftOverKeepOut must be a boolean`)
  }

  return {
    shape: validateStepShape(s.shape, `${field}.shape`, budget),
    ...(absent(s.offset) ? {} : { offset: validatePoint(s.offset, `${field}.offset`) }),
    depthMm,
    ...(lift === true ? { liftOverKeepOut: true } : {}),
  }
}

function validateFingerAccess(value: unknown, field: string): Record<string, unknown> | undefined {
  if (absent(value)) return undefined
  const f = requireObject(value, field)
  rejectUnknownKeys(f, ['style', 'side', 'widthMm', 'reachMm', 'depthMm'], field)
  const depthMm = optionalNumber(f.depthMm, `${field}.depthMm`, {
    exclusiveMin: 0, max: LIMITS.maxHeightMm,
  })
  return {
    style: requireEnum(f.style, `${field}.style`, FINGER_STYLES),
    side: requireEnum(f.side, `${field}.side`, FINGER_SIDES),
    widthMm: dim(f.widthMm, `${field}.widthMm`),
    reachMm: dim(f.reachMm, `${field}.reachMm`),
    ...(depthMm === undefined ? {} : { depthMm }),
  }
}

function validatePocket(value: unknown, index: number, budget: Budget): Record<string, unknown> {
  const field = `pockets[${index}]`
  const p = requireObject(value, field)
  rejectUnknownKeys(p, [
    'id', 'kind', 'label', 'presetId', 'x', 'y', 'widthMm', 'heightMm',
    'rotationDeg', 'mirrorX', 'flipY', 'steps', 'fingerAccess',
  ], field)

  if (!Array.isArray(p.steps) || p.steps.length === 0) {
    bad(`${field}.steps`, `${field}.steps must be a non-empty list`)
  }
  const steps = p.steps as unknown[]
  if (steps.length > LIMITS.maxStepsPerPocket) {
    bad(`${field}.steps`, `${field} has more than ${LIMITS.maxStepsPerPocket} steps`)
  }

  const label = optionalString(p.label, `${field}.label`, LIMITS.labelMaxLength)
  // Free text, never checked against the catalogue: a tray built on a preset a
  // later build has never heard of must still open.
  const presetId = optionalString(p.presetId, `${field}.presetId`, LIMITS.presetIdMaxLength)
  const rotationDeg = optionalNumber(p.rotationDeg, `${field}.rotationDeg`, {
    min: -3_600, max: 3_600,
  })
  const finger = validateFingerAccess(p.fingerAccess, `${field}.fingerAccess`)

  const flag = (key: 'mirrorX' | 'flipY'): boolean | undefined => {
    const v = p[key]
    if (absent(v)) return undefined
    if (typeof v !== 'boolean') bad(`${field}.${key}`, `${field}.${key} must be a boolean`)
    return v as boolean
  }
  const mirrorX = flag('mirrorX')
  const flipY = flag('flipY')

  return {
    id: requireString(p.id, `${field}.id`, LIMITS.labelMaxLength),
    kind: requireEnum(p.kind, `${field}.kind`, POCKET_KINDS),
    ...(label === undefined ? {} : { label }),
    ...(presetId === undefined ? {} : { presetId }),
    x: requireNumber(p.x, `${field}.x`, { min: -LIMITS.maxDimensionMm, max: LIMITS.maxDimensionMm }),
    y: requireNumber(p.y, `${field}.y`, { min: -LIMITS.maxDimensionMm, max: LIMITS.maxDimensionMm }),
    widthMm: dim(p.widthMm, `${field}.widthMm`),
    heightMm: dim(p.heightMm, `${field}.heightMm`),
    ...(rotationDeg === undefined ? {} : { rotationDeg }),
    ...(mirrorX === undefined ? {} : { mirrorX }),
    ...(flipY === undefined ? {} : { flipY }),
    steps: steps.map((s, i) => validateStep(s, `${field}.steps[${i}]`, budget)),
    ...(finger === undefined ? {} : { fingerAccess: finger }),
  }
}

function validatePockets(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) bad('pockets', 'pockets must be a list')
  const list = value as unknown[]
  if (list.length > LIMITS.maxPockets) {
    bad('pockets', `a tray may not have more than ${LIMITS.maxPockets} pockets`)
  }
  const budget: Budget = { points: 0 }
  return list.map((p, i) => validatePocket(p, i, budget))
}

function validateFeet(value: unknown): Record<string, unknown> | undefined {
  if (absent(value)) return undefined
  const f = requireObject(value, 'feet')
  rejectUnknownKeys(f, ['heightMm', 'sizeMm', 'pattern'], 'feet')
  return {
    heightMm: requireNumber(f.heightMm, 'feet.heightMm', {
      exclusiveMin: 0, max: LIMITS.maxFootHeightMm,
    }),
    sizeMm: dim(f.sizeMm, 'feet.sizeMm'),
    pattern: requireEnum(f.pattern, 'feet.pattern', FOOT_PATTERNS),
  }
}

const DESIGN_KEYS = [
  'name', 'notes', 'profile', 'heightMm', 'layerHeightMm', 'minFloorMm',
  'pockets', 'feet', 'undersideReliefs', 'caseClearHeightMm',
  // Accepted and ignored: the client round-trips whole records, and these are
  // server-owned. Refusing them would make a save of an opened tray a 400.
  'id', 'createdAt', 'updatedAt', 'revision',
] as const

export function validateToolTrayInput(value: unknown): ToolTrayInput {
  const body = requireObject(value, 'body')
  rejectUnknownKeys(body, DESIGN_KEYS, 'body')

  if (typeof body.name !== 'string' || body.name.trim() === '') {
    bad('name', 'name is required')
  }
  const name = requireString(body.name, 'name', LIMITS.nameMaxLength)
  const notes = optionalString(body.notes, 'notes', LIMITS.notesMaxLength)

  const feet = validateFeet(body.feet)
  const reliefs = absent(body.undersideReliefs)
    ? undefined
    : requireEnum(body.undersideReliefs, 'undersideReliefs', RELIEF_MODES)
  const caseClearHeightMm = optionalNumber(body.caseClearHeightMm, 'caseClearHeightMm', {
    exclusiveMin: 0, max: LIMITS.maxCaseHeightMm,
  })

  return {
    name,
    notes: notes ?? null,
    profile: validateTrayProfile(body.profile),
    heightMm: requireNumber(body.heightMm, 'heightMm', {
      exclusiveMin: 0, max: LIMITS.maxHeightMm,
    }),
    layerHeightMm: requireNumber(body.layerHeightMm, 'layerHeightMm', {
      min: LIMITS.minLayerMm, max: LIMITS.maxLayerMm,
    }),
    minFloorMm: requireNumber(body.minFloorMm, 'minFloorMm', {
      min: 0, max: LIMITS.maxHeightMm,
    }),
    pockets: validatePockets(body.pockets),
    feet: feet ?? null,
    undersideReliefs: reliefs ?? null,
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
