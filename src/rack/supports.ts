// Does any part need support? Answered against the geometry, not by eye.
//
// A slicer decides from consecutive SLICED LAYERS, not from facet normals: any
// material in a layer that is not over material in the layer below overhangs,
// and it is supported when that overhang is shallower than the threshold angle.
// Three separate features shipped here looking fine and sliced badly -- the
// shelf openings, the seam tabs, the front lip -- so this applies the rule
// directly at the real layer height.
//
// Width of an overhanging region is estimated as 2 x area / perimeter, which is
// exact for a long thin strip and generous for a small compact one. Islands of
// a square millimetre or so at the apex of a peak are inherent to any pointed
// feature and are what a slicer's "remove small overhangs" discards.
import type { MultiPolygon } from '../geometry/vec.ts'
import { multiArea } from '../geometry/vec.ts'
import { difference } from '../geometry/boolean.ts'
import type { RackConfig } from './config.ts'
import { derive } from './config.ts'
import type { PieceSpec } from './geometry.ts'
import { backReachMm, buildCleat, crossSectionAt, pieceList, pieceName } from './geometry.ts'

export interface Overhang {
  part: string
  z: number
  /** How far it juts past the layer below, mm. */
  jutMm: number
  areaMm2: number
}

const perimeter = (poly: MultiPolygon[number]): number =>
  poly.reduce((t, ring) => t + ring.reduce((s, p, i) => {
    const q = ring[(i + 1) % ring.length]!
    return s + Math.hypot(q[0] - p[0], q[1] - p[1])
  }, 0), 0)

function scan(
  part: string, sectionAt: (z: number) => MultiPolygon, z0: number, z1: number,
  layer: number, minArea: number,
): Overhang[] {
  const out: Overhang[] = []
  let prev = sectionAt(z0 + layer / 2)
  for (let z = z0 + layer * 1.5; z < z1; z += layer) {
    const cur = sectionAt(z)
    for (const poly of difference(cur, prev)) {
      const areaMm2 = multiArea([poly])
      if (areaMm2 < minArea) continue
      const p = perimeter(poly)
      out.push({ part, z: +z.toFixed(2), jutMm: p > 0 ? (2 * areaMm2) / p : 0, areaMm2 })
    }
    prev = cur
  }
  return out
}

/**
 * Every region a slicer would hold up, ignoring specks below `minAreaMm2`.
 * Empty means the whole set prints with supports switched off.
 */
export function unsupportedRegions(
  cfg: RackConfig, thresholdDeg = 30, minAreaMm2 = 2, layerMm?: number,
): Overhang[] {
  const d = derive(cfg)
  // Normally the geometry's tread and the slicer's layer are the same number.
  // Passing them apart is how you check a set against a different layer height
  // than it was built for -- every 45 degree face is only 45 degrees at the
  // tread it was cut to.
  const layer = layerMm ?? cfg.layerHeightMm
  const maxJut = layer / Math.tan((thresholdDeg * Math.PI) / 180)
  const all: Overhang[] = []
  const seen = new Set<string>()
  for (const spec of pieceList(cfg)) {
    const n = pieceName(spec)
    if (seen.has(n)) continue
    seen.add(n)
    all.push(...scan(`rack_${n}`, (z: number) => crossSectionAt(cfg, spec, z),
      -backReachMm(cfg, spec), d.rackDepthMm, layer, minAreaMm2))
  }
  for (const side of ['left', 'right'] as const) {
    const bands = buildCleat(cfg, side).bands
    const at = (z: number): MultiPolygon =>
      (bands.find(b => z >= b.z0 && z < b.z1) ?? bands[bands.length - 1]!).region
    all.push(...scan(`cleat_wall_${side === 'left' ? 'L' : 'R'}`, at, 0,
      cfg.cleatThicknessMm, layer, minAreaMm2))
  }
  return all.filter(o => o.jutMm > maxJut)
}

/** The shallowest overhang anywhere, in degrees. 90 means nothing overhangs. */
export function shallowestOverhangDeg(cfg: RackConfig, minAreaMm2 = 2): number {
  const worst = unsupportedRegions(cfg, 90, minAreaMm2)
    .reduce((m, o) => Math.max(m, o.jutMm), 0)
  return worst > 0 ? (Math.atan2(cfg.layerHeightMm, worst) * 180) / Math.PI : 90
}

export type { PieceSpec }
