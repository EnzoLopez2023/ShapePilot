// Factories and tree walkers for the scene graph. Every mutation helper here is
// pure and returns a new tree -- the history hook owns the state, this file
// owns the shape of the edit.
import type {
  DesignDocument, DocumentKind, GroupObject, ObjectMode, SceneObject,
  Shape2DKind, Shape2DObject, Shape2DParams, SolidKind, SolidObject, SolidParams,
  TextObject, Transform, Triple,
} from './document.ts'
import { defaultMachineFor } from './machines.ts'

export const IDENTITY_TRANSFORM: Transform = {
  position: [0, 0, 0],
  rotationDeg: [0, 0, 0],
  scale: [1, 1, 1],
}

export const newId = (): string => crypto.randomUUID()

const base = (name: string, at?: Partial<Transform>) => ({
  id: newId(),
  name,
  transform: { ...IDENTITY_TRANSFORM, ...at },
  mode: 'solid' as ObjectMode,
  visible: true,
  locked: false,
})

// -- Factories ---------------------------------------------------------------

const SHAPE_DEFAULTS: Record<Shape2DKind, Shape2DParams> = {
  circle: { radiusMm: 15 },
  ellipse: { radiusMm: 20, radiusYMm: 12 },
  rect: { widthMm: 40, heightMm: 25, cornerRadiusMm: 0 },
  square: { widthMm: 30, heightMm: 30, cornerRadiusMm: 0 },
  triangle: { widthMm: 30, heightMm: 26 },
  polygon: { radiusMm: 18, sides: 6 },
}

export const SHAPE_LABELS: Record<Shape2DKind, string> = {
  circle: 'Circle',
  ellipse: 'Ellipse',
  rect: 'Rectangle',
  square: 'Square',
  triangle: 'Triangle',
  polygon: 'Polygon',
}

export function createShape2D(
  shape: Shape2DKind,
  position: Triple = [0, 0, 0],
  params: Shape2DParams = {},
): Shape2DObject {
  return {
    ...base(SHAPE_LABELS[shape], { position }),
    type: 'shape2d',
    shape,
    params: { ...SHAPE_DEFAULTS[shape], ...params },
    thicknessMm: 5,
  }
}

const SOLID_DEFAULTS: Record<SolidKind, SolidParams> = {
  box: { widthMm: 20, depthMm: 20, heightMm: 20 },
  cylinder: { radiusMm: 10, heightMm: 20, segments: 64 },
  sphere: { radiusMm: 10, segments: 48 },
  cone: { radiusMm: 10, topRadiusMm: 0, heightMm: 20, segments: 64 },
  torus: { radiusMm: 12, tubeMm: 4, segments: 64 },
  wedge: { widthMm: 20, depthMm: 20, heightMm: 20 },
}

export const SOLID_LABELS: Record<SolidKind, string> = {
  box: 'Box',
  cylinder: 'Cylinder',
  sphere: 'Sphere',
  cone: 'Cone',
  torus: 'Torus',
  wedge: 'Wedge',
}

export function createSolid(
  primitive: SolidKind,
  position: Triple = [0, 0, 0],
  params: SolidParams = {},
): SolidObject {
  return {
    ...base(SOLID_LABELS[primitive], { position }),
    type: 'solid',
    primitive,
    params: { ...SOLID_DEFAULTS[primitive], ...params },
  }
}

export function createText(text = 'Text', position: Triple = [0, 0, 0]): TextObject {
  return {
    ...base(text.slice(0, 24) || 'Text', { position }),
    type: 'text',
    text,
    fontId: 'inter-regular',
    sizeMm: 12,
    letterSpacing: 0,
    thicknessMm: 5,
  }
}

export function emptyDocument(kind: DocumentKind, name?: string): DesignDocument {
  return {
    id: newId(),
    name: name ?? DEFAULT_NAMES[kind],
    kind,
    objects: [],
    machine: defaultMachineFor(kind),
    ...(kind === 'playground' ? { chat: [] } : {}),
    revision: 0,
  }
}

const DEFAULT_NAMES: Record<DocumentKind, string> = {
  shaper: 'Untitled cut',
  bambu: 'Untitled model',
  playground: 'Untitled idea',
}

// -- Tree walkers -------------------------------------------------------------

const isGroup = (o: SceneObject): o is GroupObject => o.type === 'group'

/** Depth-first, parents before children. */
export function* walk(objects: readonly SceneObject[]): Generator<SceneObject> {
  for (const o of objects) {
    yield o
    if (isGroup(o)) yield* walk(o.children)
  }
}

export const flatten = (objects: readonly SceneObject[]): SceneObject[] => [...walk(objects)]

export function findObject(objects: readonly SceneObject[], id: string): SceneObject | undefined {
  for (const o of walk(objects)) if (o.id === id) return o
  return undefined
}

/** Returns the ids of `id` and everything beneath it. */
export function subtreeIds(objects: readonly SceneObject[], id: string): string[] {
  const found = findObject(objects, id)
  if (!found) return []
  return isGroup(found) ? [found.id, ...flatten(found.children).map(o => o.id)] : [found.id]
}

/**
 * Rebuild the tree with `fn` applied to every object whose id is in `ids`.
 * Returning `null` from `fn` drops the object (and, for a group, its subtree).
 */
export function mapObjects(
  objects: readonly SceneObject[],
  ids: ReadonlySet<string>,
  fn: (o: SceneObject) => SceneObject | null,
): SceneObject[] {
  const out: SceneObject[] = []
  for (const o of objects) {
    const descended = isGroup(o) ? { ...o, children: mapObjects(o.children, ids, fn) } : o
    if (!ids.has(o.id)) { out.push(descended); continue }
    const next = fn(descended)
    if (next) out.push(next)
  }
  return out
}

export const removeObjects = (objects: readonly SceneObject[], ids: ReadonlySet<string>): SceneObject[] =>
  mapObjects(objects, ids, () => null)

export const updateObjects = (
  objects: readonly SceneObject[],
  ids: ReadonlySet<string>,
  patch: (o: SceneObject) => SceneObject,
): SceneObject[] => mapObjects(objects, ids, patch)

/** Translate in place. `dz` is ignored by the 2D sub-app, which passes 0. */
export const translateObjects = (
  objects: readonly SceneObject[],
  ids: ReadonlySet<string>,
  dx: number, dy: number, dz = 0,
): SceneObject[] =>
  updateObjects(objects, ids, o => ({
    ...o,
    transform: {
      ...o.transform,
      position: [
        o.transform.position[0] + dx,
        o.transform.position[1] + dy,
        o.transform.position[2] + dz,
      ] as Triple,
    },
  }))

/**
 * Tinkercad's Group: the selected top-level objects become one object. Order is
 * preserved and the group lands where the first member was, so the operation
 * reads as "these are now one thing" rather than a reflow.
 */
export function groupObjects(objects: readonly SceneObject[], ids: ReadonlySet<string>): {
  objects: SceneObject[]
  groupId: string | null
} {
  const members = objects.filter(o => ids.has(o.id))
  if (members.length < 2) return { objects: [...objects], groupId: null }

  const group: GroupObject = {
    ...base('Group'),
    type: 'group',
    children: members.map(m => ({ ...m })),
  }
  const firstIndex = objects.findIndex(o => ids.has(o.id))
  const rest = objects.filter(o => !ids.has(o.id))
  const out = [...rest]
  // `firstIndex` counts removed siblings too, so clamp into the shortened array.
  out.splice(Math.min(firstIndex, out.length), 0, group)
  return { objects: out, groupId: group.id }
}

/** Inverse of `groupObjects`. Children resurface where the group sat. */
export function ungroupObject(objects: readonly SceneObject[], id: string): {
  objects: SceneObject[]
  childIds: string[]
} {
  const index = objects.findIndex(o => o.id === id)
  const target = index >= 0 ? objects[index] : undefined
  if (!target || !isGroup(target)) {
    // Not at this level -- recurse so nested groups can be opened too.
    let childIds: string[] = []
    const out = objects.map(o => {
      if (!isGroup(o)) return o
      const inner = ungroupObject(o.children, id)
      if (inner.childIds.length) childIds = inner.childIds
      return { ...o, children: inner.objects }
    })
    return { objects: out, childIds }
  }
  const out = [...objects]
  out.splice(index, 1, ...target.children)
  return { objects: out, childIds: target.children.map(c => c.id) }
}

/** Deep copy with fresh ids, for Duplicate. */
export function cloneObject(o: SceneObject, offsetMm = 0): SceneObject {
  const copy: SceneObject = {
    ...o,
    id: newId(),
    transform: {
      ...o.transform,
      position: [
        o.transform.position[0] + offsetMm,
        o.transform.position[1] + offsetMm,
        o.transform.position[2],
      ] as Triple,
    },
  }
  return isGroup(copy) ? { ...copy, children: copy.children.map(c => cloneObject(c)) } : copy
}
