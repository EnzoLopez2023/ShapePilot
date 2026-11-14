// Runtime validation for the Gridfinity write routes. Same contract as the tray
// validators: rebuild every payload from validated parts, refuse unknown keys,
// and keep the bounds tight enough that the generator always terminates.
import type {
  GridfinityDesignInput, GridfinityLabelListInput,
} from '../../lib/db/repositories/contracts.ts'
import {
  ALIGNMENTS, BASEPLATE_CONTAINERS, BASEPLATE_LIMITS, BIN_LIMITS, LABEL_LIST_LIMITS,
  type GridfinityBaseplateParams, type GridfinityBinParams, type GridfinityPlacement,
} from '../../lib/contracts/gridfinity.ts'
import {
  absent, bad, optionalString, rejectUnknownKeys, requireEnum, requireNumber,
  requireObject, requireString,
} from './primitives.ts'

const NAME_MAX = 200
const NOTES_MAX = 4_000
const KINDS = ['bin', 'baseplate'] as const

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') bad(field, `${field} must be true or false`)
  return value as boolean
}

const int = (value: unknown, field: string, min: number, max: number) =>
  requireNumber(value, field, { integer: true, min, max })

function requireName(value: unknown, field: string, max: number): string {
  const name = requireString(value, field, max).trim()
  if (!name) bad(field, `${field} is required`)
  return name
}

export function validateBinParams(value: unknown): GridfinityBinParams {
  const p = requireObject(value, 'params')
  rejectUnknownKeys(p, [
    'gridX', 'gridY', 'heightUnits', 'stackingLip', 'scoop', 'labelTab', 'labelText',
    'labelListId', 'textSizeMm', 'magnets', 'labelSeparate', 'lid', 'lidLabel', 'labelSizeOnly', 'labelGlued',
    'compartmentsX', 'compartmentsY',
  ], 'params')
  const L = BIN_LIMITS
  const labelListId = optionalString(p.labelListId, 'params.labelListId', 40)
  return {
    gridX: int(p.gridX, 'params.gridX', L.minGrid, L.maxGrid),
    gridY: int(p.gridY, 'params.gridY', L.minGrid, L.maxGrid),
    heightUnits: int(p.heightUnits, 'params.heightUnits', L.minHeightUnits, L.maxHeightUnits),
    stackingLip: requireBoolean(p.stackingLip, 'params.stackingLip'),
    scoop: requireBoolean(p.scoop, 'params.scoop'),
    labelTab: requireBoolean(p.labelTab, 'params.labelTab'),
    labelText: requireString(p.labelText, 'params.labelText', L.labelMaxLength),
    ...(labelListId ? { labelListId } : {}),
    textSizeMm: requireNumber(p.textSizeMm, 'params.textSizeMm', { min: L.minTextMm, max: L.maxTextMm }),
    magnets: requireBoolean(p.magnets, 'params.magnets'),
    ...(absent(p.labelSeparate) ? {} : { labelSeparate: requireBoolean(p.labelSeparate, 'params.labelSeparate') }),
    ...(absent(p.lid) ? {} : { lid: requireBoolean(p.lid, 'params.lid') }),
    ...(absent(p.lidLabel) ? {} : { lidLabel: requireBoolean(p.lidLabel, 'params.lidLabel') }),
    ...(absent(p.labelSizeOnly) ? {} : { labelSizeOnly: requireBoolean(p.labelSizeOnly, 'params.labelSizeOnly') }),
    ...(absent(p.labelGlued) ? {} : { labelGlued: requireBoolean(p.labelGlued, 'params.labelGlued') }),
    ...(absent(p.compartmentsX) ? {} : { compartmentsX: int(p.compartmentsX, 'params.compartmentsX', 1, L.maxCompartments) }),
    ...(absent(p.compartmentsY) ? {} : { compartmentsY: int(p.compartmentsY, 'params.compartmentsY', 1, L.maxCompartments) }),
  }
}

export function validateBaseplateParams(value: unknown): GridfinityBaseplateParams {
  const p = requireObject(value, 'params')
  rejectUnknownKeys(p, [
    'container', 'drawerWidthMm', 'drawerDepthMm', 'clearanceMm', 'alignX', 'alignY', 'bedMm',
    'layout', 'heightLimitMm', 'gutter', 'gutterHeightUnits', 'gutterCompartments',
  ], 'params')
  const L = BASEPLATE_LIMITS
  const drawer = (v: unknown, field: string) => {
    const mm = requireNumber(v, field, { min: L.minDrawerMm, max: L.maxDrawerMm })
    return mm
  }
  return {
    ...(absent(p.container) ? {} : { container: requireEnum(p.container, 'params.container', BASEPLATE_CONTAINERS) }),
    drawerWidthMm: drawer(p.drawerWidthMm, 'params.drawerWidthMm'),
    drawerDepthMm: drawer(p.drawerDepthMm, 'params.drawerDepthMm'),
    clearanceMm: requireNumber(p.clearanceMm, 'params.clearanceMm', { min: 0, max: L.maxClearanceMm }),
    alignX: requireEnum(p.alignX, 'params.alignX', ALIGNMENTS),
    alignY: requireEnum(p.alignY, 'params.alignY', ALIGNMENTS),
    bedMm: requireNumber(p.bedMm, 'params.bedMm', { min: L.minBedMm, max: L.maxBedMm }),
    ...(absent(p.layout) ? {} : { layout: validateLayout(p.layout) }),
    ...(absent(p.heightLimitMm)
      ? {}
      : { heightLimitMm: requireNumber(p.heightLimitMm, 'params.heightLimitMm', { min: 1, max: L.maxHeightMm }) }),
    ...(absent(p.gutter) ? {} : { gutter: requireBoolean(p.gutter, 'params.gutter') }),
    ...(absent(p.gutterHeightUnits)
      ? {}
      : { gutterHeightUnits: int(p.gutterHeightUnits, 'params.gutterHeightUnits', L.minGutterUnits, L.maxGutterUnits) }),
    ...(absent(p.gutterCompartments)
      ? {}
      : { gutterCompartments: int(p.gutterCompartments, 'params.gutterCompartments', 1, L.maxGutterCompartments) }),
  }
}

function validateLayout(value: unknown): GridfinityPlacement[] {
  if (!Array.isArray(value)) bad('params.layout', 'params.layout must be a list')
  const list = value as unknown[]
  if (list.length > BASEPLATE_LIMITS.maxPlacements) {
    bad('params.layout', `a layout holds at most ${BASEPLATE_LIMITS.maxPlacements} stacks`)
  }
  return list.map((raw, i) => {
    const field = `params.layout[${i}]`
    const item = requireObject(raw, field)
    rejectUnknownKeys(item, ['col', 'row', 'stack', 'rotated'], field)
    if (!Array.isArray(item.stack) || !item.stack.length) bad(`${field}.stack`, 'a stack needs at least one bin')
    const stack = item.stack as unknown[]
    if (stack.length > BASEPLATE_LIMITS.maxStack) bad(`${field}.stack`, `a stack holds at most ${BASEPLATE_LIMITS.maxStack} bins`)
    return {
      col: int(item.col, `${field}.col`, 0, 100),
      row: int(item.row, `${field}.row`, 0, 100),
      stack: stack.map((id, k) => requireName(id, `${field}.stack[${k}]`, 40)),
      ...(absent(item.rotated) ? {} : { rotated: requireBoolean(item.rotated, `${field}.rotated`) }),
    }
  })
}

export function validateGridfinityDesignInput(value: unknown): GridfinityDesignInput {
  const body = requireObject(value, 'body')
  rejectUnknownKeys(body, ['id', 'name', 'notes', 'kind', 'params', 'createdAt', 'updatedAt', 'revision'], 'body')
  const kind = requireEnum(body.kind, 'kind', KINDS)
  const notes = absent(body.notes) ? null : requireString(body.notes, 'notes', NOTES_MAX)
  return {
    name: requireName(body.name, 'name', NAME_MAX),
    notes,
    kind,
    params: { ...(kind === 'bin' ? validateBinParams(body.params) : validateBaseplateParams(body.params)) },
  }
}

export function validateLabelListInput(value: unknown): GridfinityLabelListInput {
  const body = requireObject(value, 'body')
  rejectUnknownKeys(body, ['id', 'name', 'items', 'createdAt', 'updatedAt'], 'body')
  if (!Array.isArray(body.items)) bad('items', 'items must be a list')
  const raw = body.items as unknown[]
  if (!raw.length) bad('items', 'a list needs at least one item')
  if (raw.length > LABEL_LIST_LIMITS.maxItems) {
    bad('items', `a list holds at most ${LABEL_LIST_LIMITS.maxItems} items`)
  }
  const items = raw.map((item, i) => {
    const text = requireString(item, `items[${i}]`, LABEL_LIST_LIMITS.itemMaxLength).trim()
    if (!text) bad(`items[${i}]`, 'an item cannot be blank')
    return text
  })
  return { name: requireName(body.name, 'name', LABEL_LIST_LIMITS.nameMaxLength), items }
}

export function validateCloneRequest(value: unknown): { name?: string } {
  const body = requireObject(value, 'body')
  rejectUnknownKeys(body, ['name'], 'body')
  return absent(body.name) ? {} : { name: requireName(body.name, 'name', NAME_MAX) }
}
