// Filling build plates: lay a batch of parts out on the bed so a 3MF opens in
// the slicer ready to slice, rather than as a pile to arrange.
//
// Shelf packing: tallest-first rows, left to right, a new plate when a row will
// not fit. Gridfinity parts are near-rectangles of a few sizes, which is where
// shelves do about as well as anything cleverer.
import type { Mesh } from '../geometry/mesh.ts'
import type { PlateObject, ThreeMfPart } from './threemf.ts'

/** Space between parts, and from the bed's edge -- room for a brim and the purge line. */
export const PLATE_GAP_MM = 5
export const PLATE_MARGIN_MM = 8

export interface Footprint { widthMm: number; depthMm: number }
export interface Spot { plate: number; x: number; y: number }

/** Where each footprint goes, in input order. Throws if one cannot fit a bed at all. */
export function packPlates(items: readonly Footprint[], bedMm: number): Spot[] {
  const usable = bedMm - 2 * PLATE_MARGIN_MM
  const order = items.map((_, i) => i).sort((a, b) =>
    items[b].depthMm - items[a].depthMm || items[b].widthMm - items[a].widthMm)
  const spots: Spot[] = new Array<Spot>(items.length)
  let plate = 0
  let x = 0
  let rowY = 0
  let rowDepth = 0
  for (const i of order) {
    const { widthMm: w, depthMm: d } = items[i]
    if (w > usable || d > usable) {
      throw new Error(`a ${Math.round(w)} × ${Math.round(d)} mm part is bigger than the ${bedMm} mm bed`)
    }
    if (x > 0 && x + w > usable) { x = 0; rowY += rowDepth + PLATE_GAP_MM; rowDepth = 0 }
    if (rowY + d > usable) { plate++; x = 0; rowY = 0; rowDepth = 0 }
    spots[i] = { plate, x: PLATE_MARGIN_MM + x, y: PLATE_MARGIN_MM + rowY }
    x += w + PLATE_GAP_MM
    rowDepth = Math.max(rowDepth, d)
  }
  return spots
}

const footprintOf = (parts: readonly ThreeMfPart[]): [number, number, number, number] => {
  const b = [Infinity, Infinity, -Infinity, -Infinity]
  for (const { mesh } of parts) {
    b[0] = Math.min(b[0], mesh.bbox[0]); b[1] = Math.min(b[1], mesh.bbox[1])
    b[2] = Math.max(b[2], mesh.bbox[3]); b[3] = Math.max(b[3], mesh.bbox[4])
  }
  return b as [number, number, number, number]
}

const moved = (mesh: Mesh, dx: number, dy: number): Mesh => {
  const positions = new Float32Array(mesh.positions)
  for (let i = 0; i < positions.length; i += 3) { positions[i] += dx; positions[i + 1] += dy }
  const [x0, y0, z0, x1, y1, z1] = mesh.bbox
  return { ...mesh, positions, bbox: [x0 + dx, y0 + dy, z0, x1 + dx, y1 + dy, z1] }
}

/** Pack whole objects (each keeping its parts together) onto as few plates as it takes. */
export function fillPlates(
  objects: readonly { name: string; parts: readonly ThreeMfPart[] }[], bedMm: number,
): { placed: PlateObject[]; plates: number } {
  const boxes = objects.map(o => footprintOf(o.parts))
  const spots = packPlates(boxes.map(([x0, y0, x1, y1]) => ({ widthMm: x1 - x0, depthMm: y1 - y0 })), bedMm)
  const placed = objects.map((o, i) => {
    const [x0, y0] = boxes[i]
    const { plate, x, y } = spots[i]
    return {
      name: o.name,
      plate,
      parts: o.parts.map(p => ({ ...p, mesh: moved(p.mesh, x - x0, y - y0) })),
    }
  })
  return { placed, plates: Math.max(0, ...spots.map(s => s.plate + 1)) }
}
