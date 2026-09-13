// Resizing on the 2D canvas: where a selection frame sits, and what dragging
// one of its handles means for each kind of object.
//
// Every object is framed by its bounding box *before* its own rotation and
// position are applied, so the frame hugs a turned shape the way Shaper Studio
// does rather than growing into an upright box around it. A handle drag becomes
// a pair of scale factors in that local frame, and each object type answers
// them in its own terms: a rectangle changes its width, a pegboard snaps to its
// slot grid, and an imported outline -- which has no dimensions of its own,
// only the file it came from -- scales instead.
import type { BBox, MultiPolygon, Vec2 } from '../../geometry/vec.ts'
import {
  SKADIS_DEFAULT_HEIGHT_MM, SKADIS_DEFAULT_WIDTH_MM,
  snapSkadisHeightMm, snapSkadisWidthMm,
} from '../../geometry/skadis.ts'
import type {
  SceneObject, Shape2DParams, Transform, Triple,
} from '../../model/document.ts'

/** Nothing may be dragged below this: a shape with no width cannot be grabbed
 *  again, and undo is a poor way to discover that. */
const MIN_SIZE_MM = 0.2

/** The eight grips of a selection frame, named by compass point. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** Each grip's seat in the frame, as a fraction of its width and height. The
 *  model is y-up, so `n` is the high edge. */
export const HANDLE_SEATS: Record<Handle, Vec2> = {
  sw: [0, 0], s: [0.5, 0], se: [1, 0],
  w: [0, 0.5], e: [1, 0.5],
  nw: [0, 1], n: [0.5, 1], ne: [1, 1],
}

export const HANDLES = Object.keys(HANDLE_SEATS) as Handle[]

// Indexed by eighths of a turn, so a rotated shape gets the cursor its grip
// actually points at rather than the one it would have at rest.
const CURSORS = ['ew-resize', 'nesw-resize', 'ns-resize', 'nwse-resize']

/** The resize cursor for a grip on a shape turned by `rotationDeg`. */
export function handleCursor(handle: Handle, rotationDeg: number): string {
  const [sx, sy] = HANDLE_SEATS[handle]
  const deg = (Math.atan2(sy - 0.5, sx - 0.5) * 180) / Math.PI + rotationDeg
  const eighth = Math.round((((deg % 360) + 360) % 360) / 45) % 8
  return CURSORS[eighth % 4]
}

/** An object's bounds in its own space, plus the placement that puts them on
 *  the canvas. Rotating `box` by `rotationDeg` about the origin and shifting it
 *  to `position` gives the frame the user sees. */
export interface LocalFrame {
  box: BBox
  rotationDeg: number
  position: Vec2
}

const radians = (deg: number): number => (deg * Math.PI) / 180

/** Object space -> document space. */
export function localToWorld(frame: LocalFrame, lx: number, ly: number): Vec2 {
  const rad = radians(frame.rotationDeg)
  const cos = Math.cos(rad), sin = Math.sin(rad)
  return [
    frame.position[0] + lx * cos - ly * sin,
    frame.position[1] + lx * sin + ly * cos,
  ]
}

/** Document space -> object space. */
export function worldToLocal(frame: LocalFrame, wx: number, wy: number): Vec2 {
  const rad = radians(-frame.rotationDeg)
  const cos = Math.cos(rad), sin = Math.sin(rad)
  const dx = wx - frame.position[0], dy = wy - frame.position[1]
  return [dx * cos - dy * sin, dx * sin + dy * cos]
}

/** A point of the frame, given as fractions of its width and height. */
export function framePoint(frame: LocalFrame, fx: number, fy: number): Vec2 {
  const { box } = frame
  return localToWorld(
    frame,
    box.minX + fx * (box.maxX - box.minX),
    box.minY + fy * (box.maxY - box.minY),
  )
}

export const frameWidth = (frame: LocalFrame): number => frame.box.maxX - frame.box.minX
export const frameHeight = (frame: LocalFrame): number => frame.box.maxY - frame.box.minY

/**
 * Recover the object's own frame from the polygons the canvas already drew.
 * `compileObject` applies scale, then rotation, then position; undoing the last
 * two leaves the bounds the object's parameters describe, which is both what
 * the frame should hug and what a resize has to be measured against.
 */
export function localFrame(object: SceneObject, world: MultiPolygon): LocalFrame | null {
  const rotationDeg = object.transform.rotationDeg[2]
  const [px, py] = object.transform.position
  const rad = radians(-rotationDeg)
  const cos = Math.cos(rad), sin = Math.sin(rad)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const polygon of world) for (const ring of polygon) for (const [wx, wy] of ring) {
    const dx = wx - px, dy = wy - py
    const x = dx * cos - dy * sin
    const y = dx * sin + dy * cos
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null
  return { box: { minX, minY, maxX, maxY }, rotationDeg, position: [px, py] }
}

/** How one object answers a resize. Factors are relative to its current size. */
interface Resizer {
  /** The two axes cannot move independently -- a circle has one radius. */
  uniform: boolean
  /** The factors the object can actually take; a pegboard snaps to its grid. */
  normalize: (fx: number, fy: number) => Vec2
  /** Everything but the position fix, which `resizeEdit` adds. */
  patch: (fx: number, fy: number) => Partial<SceneObject>
}

const identityFactors = (fx: number, fy: number): Vec2 => [fx, fy]

/**
 * What resizing this object writes -- or null when it has no meaningful size on
 * a 2D canvas (a 3D primitive and an imported mesh both draw nothing here).
 */
export function resizerFor(object: SceneObject): Resizer | null {
  if (object.type === 'imported' || object.type === 'solid') return null

  // The fallback for anything with no dimensions of its own: an imported
  // outline is the file it came from, and a group is whatever its members are.
  const byScale: Resizer = {
    uniform: false,
    normalize: identityFactors,
    patch: (fx, fy) => ({
      transform: {
        ...object.transform,
        scale: [
          object.transform.scale[0] * fx,
          object.transform.scale[1] * fy,
          object.transform.scale[2],
        ] as Triple,
      },
    }),
  }
  if (object.type === 'path' || object.type === 'group') return byScale

  // Past here the object has real dimensions -- but only while its scale is
  // untouched. Once something has been scaled, its parameters no longer say how
  // big it is on screen, and scaling further is the only honest answer.
  const [sx, sy] = object.transform.scale
  if (sx !== 1 || sy !== 1) return byScale

  if (object.type === 'text') {
    return {
      uniform: true,
      normalize: identityFactors,
      patch: f => ({
        sizeMm: object.sizeMm * f,
        // Letter spacing is millimetres, so it has to grow with the type or the
        // box would not scale evenly with the factor.
        letterSpacing: (object.letterSpacing ?? 0) * f,
      } as Partial<SceneObject>),
    }
  }

  const p = object.params
  const sized = (params: Shape2DParams): Partial<SceneObject> =>
    ({ params: { ...p, ...params } } as Partial<SceneObject>)

  switch (object.shape) {
    case 'circle':
    case 'polygon':
      return {
        uniform: true,
        normalize: identityFactors,
        patch: f => sized({ radiusMm: (p.radiusMm ?? 10) * f }),
      }
    case 'square':
      return {
        uniform: true,
        normalize: identityFactors,
        patch: f => {
          const side = (p.widthMm ?? 10) * f
          return sized({ widthMm: side, heightMm: side })
        },
      }
    case 'ellipse':
      return {
        uniform: false,
        normalize: identityFactors,
        patch: (fx, fy) => sized({
          radiusMm: (p.radiusMm ?? 10) * fx,
          radiusYMm: (p.radiusYMm ?? p.radiusMm ?? 10) * fy,
        }),
      }
    case 'rect':
    case 'triangle':
      return {
        uniform: false,
        normalize: identityFactors,
        patch: (fx, fy) => sized({
          widthMm: (p.widthMm ?? 10) * fx,
          heightMm: (p.heightMm ?? p.widthMm ?? 10) * fy,
        }),
      }
    case 'skadis': {
      const w = p.widthMm ?? SKADIS_DEFAULT_WIDTH_MM
      const h = p.heightMm ?? SKADIS_DEFAULT_HEIGHT_MM
      return {
        uniform: false,
        // A board only exists on its slot grid, so the drag lands on the grid
        // rather than between two rows -- the rule the inspector field already
        // applies on commit, moved to where the size is actually chosen.
        normalize: (fx, fy) => [snapSkadisWidthMm(w * fx) / w, snapSkadisHeightMm(h * fy) / h],
        patch: (fx, fy) => sized({
          widthMm: snapSkadisWidthMm(w * fx),
          heightMm: snapSkadisHeightMm(h * fy),
        }),
      }
    }
  }
}

export interface ResizeEdit {
  /** Scale factors in the object's own frame, after its own rules. */
  factors: Vec2
  /** Where the object lands so the held edge stays put. */
  position: Vec2
  /** The frame it will have once committed -- what the canvas draws mid-drag. */
  frame: LocalFrame
  widthMm: number
  heightMm: number
  /** One patch, applied once on release, so a drag is one undo step. */
  patch: Partial<SceneObject>
}

export interface ResizeOptions {
  /** Grow about the centre rather than the opposite edge. */
  fromCentre?: boolean
  /** Hold the width-to-height ratio. Implied for a uniform object. */
  keepAspect?: boolean
  /** Rounds the new width and height; the canvas passes its snap increment. */
  snap?: (mm: number) => number
}

/** The no-op edit a drag starts from, before the pointer has moved. */
export const idleEdit = (frame: LocalFrame): ResizeEdit => ({
  factors: [1, 1],
  position: frame.position,
  frame,
  widthMm: frameWidth(frame),
  heightMm: frameHeight(frame),
  patch: {},
})

/**
 * One frame of a handle drag. `local` is the pointer in the object's own space,
 * measured against the frame the drag started from -- never the live one, or
 * the shape would chase the cursor.
 */
export function resizeEdit(
  object: SceneObject,
  frame: LocalFrame,
  handle: Handle,
  local: Vec2,
  options: ResizeOptions = {},
): ResizeEdit | null {
  const resizer = resizerFor(object)
  if (!resizer) return null

  const { box } = frame
  const w0 = frameWidth(frame), h0 = frameHeight(frame)
  if (w0 <= 0 || h0 <= 0) return null

  const [seatX, seatY] = HANDLE_SEATS[handle]
  const fromCentre = options.fromCentre ?? false
  // The part of the frame that does not move: the opposite edge, or the centre
  // when the drag grows both ways.
  const holdX = fromCentre ? 0.5 : 1 - seatX
  const holdY = fromCentre ? 0.5 : 1 - seatY
  const snap = options.snap ?? ((mm: number) => mm)

  /** One axis of the new size, or the old one when this grip does not move it. */
  const measure = (seat: number, hold: number, pointer: number, min: number, span: number) => {
    if (seat === 0.5) return span
    const reach = Math.abs(pointer - (min + hold * span))
    return Math.max(MIN_SIZE_MM, snap(fromCentre ? reach * 2 : reach))
  }

  let fx = measure(seatX, holdX, local[0], box.minX, w0) / w0
  let fy = measure(seatY, holdY, local[1], box.minY, h0) / h0

  if (resizer.uniform || options.keepAspect) {
    // A corner follows whichever axis the pointer moved further on; an edge
    // grip has only the one it owns.
    const corner = seatX !== 0.5 && seatY !== 0.5
    const f = corner
      ? (Math.abs(fx - 1) >= Math.abs(fy - 1) ? fx : fy)
      : (seatX !== 0.5 ? fx : fy)
    fx = f
    fy = f
  }

  const [nfx, nfy] = resizer.normalize(fx, fy)
  if (!Number.isFinite(nfx) || !Number.isFinite(nfy) || nfx <= 0 || nfy <= 0) return null

  // Every object here scales about its own origin, so the new frame is the old
  // one stretched about it -- which is generally not where the held edge was.
  const after: BBox = {
    minX: box.minX * nfx, maxX: box.maxX * nfx,
    minY: box.minY * nfy, maxY: box.maxY * nfy,
  }
  const heldBefore: Vec2 = [box.minX + holdX * w0, box.minY + holdY * h0]
  const heldAfter: Vec2 = [
    after.minX + holdX * (after.maxX - after.minX),
    after.minY + holdY * (after.maxY - after.minY),
  ]
  const rad = radians(frame.rotationDeg)
  const cos = Math.cos(rad), sin = Math.sin(rad)
  const dx = heldBefore[0] - heldAfter[0]
  const dy = heldBefore[1] - heldAfter[1]
  const position: Vec2 = [
    frame.position[0] + dx * cos - dy * sin,
    frame.position[1] + dx * sin + dy * cos,
  ]

  const base = resizer.patch(nfx, nfy)
  const transform: Transform = {
    ...object.transform,
    ...(base as { transform?: Transform }).transform,
    position: [position[0], position[1], object.transform.position[2]],
  }

  return {
    factors: [nfx, nfy],
    position,
    frame: { box: after, rotationDeg: frame.rotationDeg, position },
    widthMm: after.maxX - after.minX,
    heightMm: after.maxY - after.minY,
    patch: { ...base, transform } as Partial<SceneObject>,
  }
}

/**
 * The SVG transform that previews an in-progress resize. The document is only
 * written on release, so mid-drag the already-compiled polygons are stretched
 * in place: undo the object's placement, scale in its own frame, put it back
 * where the edit says it lands.
 */
export function previewTransform(before: LocalFrame, edit: ResizeEdit): string {
  const [px, py] = before.position
  const [nx, ny] = edit.position
  const r = before.rotationDeg
  return `translate(${nx} ${ny}) rotate(${r}) scale(${edit.factors[0]} ${edit.factors[1]}) `
    + `rotate(${-r}) translate(${-px} ${-py})`
}
