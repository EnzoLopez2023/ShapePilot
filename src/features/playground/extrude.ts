// A traced drawing -> something printable.
//
// A trace comes back as flat paths, 1 mm thick, which is a picture rather than
// a part. Giving them a real thickness and, optionally, a plate behind them is
// what turns a photographed logo into a badge -- the one step that otherwise
// meant handing the design to another designer and building the plate by hand.
import type { PathObject, SceneObject, Triple } from '../../model/document.ts'
import { IDENTITY_TRANSFORM, newId } from '../../model/scene.ts'

export interface BadgeOptions {
  /** How thick the traced shapes become. */
  thicknessMm: number
  /** A plate behind them, or none. */
  plate?: {
    /** How far the plate reaches past the artwork on every side. */
    marginMm: number
    thicknessMm: number
  }
}

const isPath = (o: SceneObject): o is PathObject => o.type === 'path'

/** The artwork's extent in x and y, including each object's own offset. */
export function artworkBounds(objects: readonly SceneObject[]): {
  min: [number, number]; max: [number, number]
} | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const object of objects) {
    if (!isPath(object)) continue
    const [dx, dy] = object.transform.position
    for (const ring of object.rings) {
      for (const [x, y] of ring) {
        minX = Math.min(minX, x + dx); maxX = Math.max(maxX, x + dx)
        minY = Math.min(minY, y + dy); maxY = Math.max(maxY, y + dy)
      }
    }
  }
  return Number.isFinite(minX) ? { min: [minX, minY], max: [maxX, maxY] } : null
}

/**
 * The scene with the artwork given depth, and a plate under it if asked for.
 * The artwork is lifted to sit on the plate, so the two meet instead of
 * intersecting, and the plate is added first so it reads as the background.
 */
export function extrudeToBadge(
  objects: readonly SceneObject[], options: BadgeOptions,
): SceneObject[] {
  const lift = options.plate?.thicknessMm ?? 0
  const raised = objects.map(object => {
    if (!isPath(object)) return object
    const [x, y, z] = object.transform.position
    return {
      ...object,
      thicknessMm: options.thicknessMm,
      transform: { ...object.transform, position: [x, y, z + lift] as Triple },
    }
  })
  if (!options.plate) return raised

  const bounds = artworkBounds(objects)
  if (!bounds) return raised
  const { marginMm, thicknessMm } = options.plate
  const [minX, minY] = bounds.min
  const [maxX, maxY] = bounds.max
  const x0 = minX - marginMm, x1 = maxX + marginMm
  const y0 = minY - marginMm, y1 = maxY + marginMm

  const plate: PathObject = {
    id: newId(),
    name: 'Backing plate',
    type: 'path',
    // Counter-clockwise, the outer winding every ring here uses.
    rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
    thicknessMm,
    transform: { ...IDENTITY_TRANSFORM },
    mode: 'solid',
    visible: true,
    locked: false,
  }
  return [plate, ...raised]
}
