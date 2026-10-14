// The assembled case as meshes, for the 3D view.
//
// Every panel is built from its own cut drawing: the exterior is the stock and
// each pocket layer is cut its depth into the inner face, which is exactly a
// stack of z-bands (geometry/bands.ts). So what the 3D view shows is what the
// Shaper files cut -- there is no second description of the case to drift.
// Each panel is then placed in the case frame by an affine map.
//
// Case frame: X across the case from the outside of the left side, Y back from
// the front edge, Z up from the bottom. The viewer looks from -Y, so the front
// of the case faces the camera.
import { difference } from '../../../geometry/boolean.ts'
import { meshFromBands } from '../../../geometry/bands.ts'
import type { Band } from '../../../geometry/bands.ts'
import type { Mesh } from '../../../geometry/mesh.ts'
import type { MultiPolygon, Ring } from '../../../geometry/vec.ts'
import type { CutDrawing } from '../../../export/cutLayers.ts'
import { backDrawing, sideDrawing, topBottomDrawing } from '../export/cutDrawing.ts'
import { cabinetDims } from './cabinet.ts'
import type { CabinetParams } from './cabinet.ts'

type Vec3 = [number, number, number]
/** From a part's own frame (drawing X, drawing Y, height off the outer face). */
type Place = (x: number, y: number, z: number) => Vec3

export interface CabinetSolid {
  /** Sides, top, bottom, back -- and the case cleat and spacer, when hung. */
  caseMesh: Mesh
  /** One slab per slot, seated on its dado floors. */
  trays: Mesh
  /** The wall half of the cleat, seated; null for a free-standing case. */
  wallCleat: Mesh | null
}

/** A panel's drawing as bands: stock everywhere, less each pocket near the face. */
export function drawingBands(drawing: CutDrawing, thicknessMm: number): Band[] {
  const outline = drawing.layers
    .filter(l => l.cutType === 'exterior')
    .flatMap(l => l.polygons)
  const pockets = drawing.layers
    .filter(l => l.cutType === 'pocket' && (l.depthMm ?? 0) > 0)
    .map(l => ({ floor: thicknessMm - Math.min(l.depthMm!, thicknessMm), polygons: l.polygons }))
  const cuts = [...new Set([0, thicknessMm, ...pockets.map(p => p.floor)])]
    .filter(z => z >= 0 && z <= thicknessMm)
    .sort((a, b) => a - b)
  const bands: Band[] = []
  for (let i = 1; i < cuts.length; i++) {
    const z0 = cuts[i - 1]!, z1 = cuts[i]!
    const open = pockets.filter(p => p.floor <= z0).map(p => p.polygons)
    bands.push({ z0, z1, region: open.length ? difference(outline, ...open) : outline })
  }
  return bands
}

const extrude = (ring: Ring, heightMm: number): Mesh =>
  meshFromBands([{ z0: 0, z1: heightMm, region: [[ring]] as MultiPolygon }])

const box = (x0: number, y0: number, x1: number, y1: number, heightMm: number): Mesh =>
  extrude([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], heightMm)

/**
 * Every part, placed and welded into one buffer. A mirroring map turns a solid
 * inside out, so its triangles are rewound to keep the faces pointing outward --
 * the viewer only draws front faces.
 */
export function placeAll(parts: readonly { mesh: Mesh; place: Place }[]): Mesh {
  const vertexCount = parts.reduce((s, p) => s + p.mesh.positions.length / 3, 0)
  const indexCount = parts.reduce((s, p) => s + p.mesh.indices.length, 0)
  const positions = new Float32Array(vertexCount * 3)
  const indices = new Uint32Array(indexCount)
  const bbox: Mesh['bbox'] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  let vOut = 0, iOut = 0
  for (const { mesh, place } of parts) {
    const o = place(0, 0, 0)
    const ax = place(1, 0, 0), ay = place(0, 1, 0), az = place(0, 0, 1)
    const u = ax.map((v, k) => v - o[k]!), v = ay.map((w, k) => w - o[k]!)
    const w = az.map((x, k) => x - o[k]!)
    const det = u[0]! * (v[1]! * w[2]! - v[2]! * w[1]!)
      - u[1]! * (v[0]! * w[2]! - v[2]! * w[0]!)
      + u[2]! * (v[0]! * w[1]! - v[1]! * w[0]!)
    const base = vOut / 3
    const src = mesh.positions
    for (let i = 0; i < src.length; i += 3) {
      const p = place(src[i]!, src[i + 1]!, src[i + 2]!)
      for (let k = 0; k < 3; k++) {
        positions[vOut + k] = p[k]!
        if (p[k]! < bbox[k]!) bbox[k] = p[k]!
        if (p[k]! > bbox[k + 3]!) bbox[k + 3] = p[k]!
      }
      vOut += 3
    }
    const idx = mesh.indices
    for (let i = 0; i < idx.length; i += 3) {
      indices[iOut] = base + idx[i]!
      indices[iOut + 1] = base + idx[det < 0 ? i + 2 : i + 1]!
      indices[iOut + 2] = base + idx[det < 0 ? i + 1 : i + 2]!
      iOut += 3
    }
  }
  return { positions, indices, triangleCount: indexCount / 3, bbox }
}

export function cabinetSolid(p: CabinetParams): CabinetSolid {
  const d = cabinetDims(p)
  const t = p.stockMm
  const W = d.overallWidthMm
  const H = d.overallHeightMm
  const D = d.panelDepthMm

  // The side is drawn inner face up with the front edge at X = 0, so its
  // drawing X is the case's depth and its drawing Y the case's height.
  const side = meshFromBands(drawingBands(sideDrawing(p), t))
  // Top and bottom are drawn with the rear edge at Y = 0.
  const topBottom = meshFromBands(drawingBands(topBottomDrawing(p), t))
  const back = meshFromBands(drawingBands(backDrawing(p), p.backMm))

  const parts: { mesh: Mesh; place: Place }[] = [
    { mesh: side, place: (x, y, z) => [z, x, y] },
    { mesh: side, place: (x, y, z) => [W - z, x, y] },
    { mesh: topBottom, place: (x, y, z) => [t + x, D - y, z] },
    { mesh: topBottom, place: (x, y, z) => [t + x, D - y, H - z] },
    {
      mesh: back,
      place: (x, y, z) => [t - d.backRabbetMm + x, p.trayDepthMm + z, t - d.backRabbetMm + y],
    },
  ]

  // Cleat profiles are in the side's frame (depth, height), extruded across
  // the case between the sides.
  const across: Place = (x, y, z) => [t + z, x, y]
  if (d.cleat) {
    parts.push(
      { mesh: extrude(d.cleat.caseProfile, d.cleat.lengthMm), place: across },
      { mesh: extrude(d.cleat.spacerProfile, d.cleat.lengthMm), place: across },
    )
  }

  // A tray is a slab across both dados, flush with the front edge.
  const trayX = t + p.dadoDepthMm - p.slideClearanceMm / 2
  const slab = box(0, 0, p.trayWidthMm, p.trayDepthMm, p.trayThicknessMm)
  const trays = placeAll(d.dadoFloorsMm.map(floor => ({
    mesh: slab,
    place: (x: number, y: number, z: number): Vec3 => [trayX + x, y, floor + z],
  })))

  return {
    caseMesh: placeAll(parts),
    trays,
    wallCleat: d.cleat
      ? placeAll([{ mesh: extrude(d.cleat.wallProfile, d.cleat.lengthMm), place: across }])
      : null,
  }
}
