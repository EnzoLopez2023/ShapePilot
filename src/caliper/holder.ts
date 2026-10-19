// A Skadis holder for the Woodpeckers Big Cal.
//
// The caliper hangs beam-down: the steel beam drops through a slot and the
// body's flat lower edge rests on the top of the block. The block is the part's
// TOP face, and that is the print decision everything else follows from -- the
// part is printed standing on that face, so the shelf is the first layer
// rather than an overhang, the slot is a vertical hole, and the prongs start
// on the bed exactly like the swatch bar's (src/swatch/holderGeometry.ts).
//
// Frame while modelling: z is the board normal (z = 0 is the block's back, the
// board's face), y is up, x is across, centred on the beam. `buildCaliperHolder`
// rotates the result into the print frame, so the exported file is already
// standing on its top face.
import type { Band } from '../geometry/bands.ts'
import { buildBands } from '../geometry/bands.ts'
import { difference } from '../geometry/boolean.ts'
import type { Mesh } from '../geometry/mesh.ts'
import { roundedRectRing } from '../geometry/primitives.ts'
import type { MultiPolygon, Ring } from '../geometry/vec.ts'
import { SKADIS } from '../geometry/skadis.ts'
import { HOLDER } from '../swatch/holder.ts'

export interface CaliperHolderConfig {
  /** The steel beam's width. A 1" rule; read off the calibration photo as ~25.5. */
  beamWidthMm: number
  /**
   * NOT measured. The beam is sandwiched between the two aluminium plates, so
   * it is assumed to sit mid-thickness -- which is why the slot is centred in
   * the block. The slot is deliberately roomy about this one.
   */
  beamThicknessMm: number
  /** NOT measured either: the body's thickness through the screws. */
  bodyThicknessMm: number
  /** Total clearance across the beam's width (both sides together). */
  beamClearanceMm: number
  /** Total clearance across the beam's thickness. */
  beamThicknessClearanceMm: number
  /** Width of the body's flat lower edge, measured off the photo (~44). */
  bodyFlatMm: number
  /** The block carries the body on its top, so it is wider than that flat. */
  blockWidthMm: number
  blockHeightMm: number
  /** Front to back. The body sits centred over the slot, so this bounds how thick a body it can carry. */
  blockDepthMm: number
  blockCornerRadiusMm: number
}

export const CALIPER_HOLDER: CaliperHolderConfig = {
  beamWidthMm: 25.4,
  beamThicknessMm: 2,
  bodyThicknessMm: 13,
  beamClearanceMm: 1.8,
  beamThicknessClearanceMm: 3,
  bodyFlatMm: 44,
  blockWidthMm: 52,
  blockHeightMm: 40,
  blockDepthMm: 20,
  blockCornerRadiusMm: 2,
}

const ARC_SEGS = 16
const rect = (x: number, y: number, w: number, h: number, r: number): Ring =>
  roundedRectRing(x, y, w, h, r, ARC_SEGS)
const multi = (rings: Ring[]): MultiPolygon => rings.map(r => [r])

export interface CaliperDerived {
  slotWidthMm: number
  slotDepthMm: number
  /** Slot centre, from the board. */
  slotCentreZMm: number
  /** Two columns apart, so both prongs land on a real slot. */
  prongCentresMm: [number, number]
  prongWidthMm: number
  /** Back of the catch to the board's face. */
  backReachMm: number
}

export function derive(cfg: CaliperHolderConfig): CaliperDerived {
  return {
    slotWidthMm: cfg.beamWidthMm + cfg.beamClearanceMm,
    slotDepthMm: cfg.beamThicknessMm + cfg.beamThicknessClearanceMm,
    slotCentreZMm: cfg.blockDepthMm / 2,
    prongCentresMm: [-SKADIS.columnPitchMm / 2, SKADIS.columnPitchMm / 2],
    prongWidthMm: SKADIS.slotWidthMm - 2 * HOLDER.fitMm,
    backReachMm: HOLDER.boardThicknessMm + HOLDER.prongCatchThicknessMm,
  }
}

export function checkConfig(cfg: CaliperHolderConfig): string[] {
  const d = derive(cfg)
  const issues: string[] = []
  if (cfg.bodyThicknessMm > cfg.blockDepthMm - 2) {
    issues.push(`a ${cfg.bodyThicknessMm} mm body centred on the slot overhangs a `
      + `${cfg.blockDepthMm} mm block, so little of its lower edge would bear`)
  }
  if (cfg.blockWidthMm < cfg.bodyFlatMm + 4) {
    issues.push(`a ${cfg.blockWidthMm} mm block is not wider than the ${cfg.bodyFlatMm} mm flat it carries`)
  }
  const wall = (cfg.blockWidthMm - d.slotWidthMm) / 2
  const prongOuter = SKADIS.columnPitchMm / 2 + d.prongWidthMm / 2
  if (prongOuter > cfg.blockWidthMm / 2) {
    issues.push('the prongs stand outside the block')
  }
  if (SKADIS.columnPitchMm / 2 - d.prongWidthMm / 2 < d.slotWidthMm / 2) {
    issues.push(`the slot's ${d.slotWidthMm} mm opening runs into the prongs' ${wall.toFixed(1)} mm wall`)
  }
  if (cfg.blockHeightMm < HOLDER.prongHeightMm + HOLDER.prongCatchDropMm + 6) {
    issues.push('there is no material below the prongs to bear on the board')
  }
  return issues
}

export function bandsFor(cfg: CaliperHolderConfig): Band[] {
  const d = derive(cfg)
  const w = cfg.blockWidthMm
  const h = cfg.blockHeightMm
  const half = d.prongWidthMm / 2
  const block = multi([rect(-w / 2, 0, w, h, cfg.blockCornerRadiusMm)])
  // The slot is open top and bottom: the beam is longer than the block is tall.
  const slotted = difference(block, multi([rect(-d.slotWidthMm / 2, -1, d.slotWidthMm, h + 2, 0)]))

  const shank = multi(d.prongCentresMm.map(cx => rect(
    cx - half, h - HOLDER.prongHeightMm, d.prongWidthMm, HOLDER.prongHeightMm, half)))
  const catchTotal = HOLDER.prongHeightMm + HOLDER.prongCatchDropMm
  const catchRegion = multi(d.prongCentresMm.map(cx => rect(
    cx - half, h - catchTotal, d.prongWidthMm, catchTotal, half)))

  const z0 = d.slotCentreZMm - d.slotDepthMm / 2
  const z1 = d.slotCentreZMm + d.slotDepthMm / 2
  const board = HOLDER.boardThicknessMm
  return [
    { z0: -(board + HOLDER.prongCatchThicknessMm), z1: -board, region: catchRegion },
    { z0: -board, z1: 0, region: shank },
    { z0: 0, z1: z0, region: block },
    { z0, z1, region: slotted },
    { z0: z1, z1: cfg.blockDepthMm, region: block },
  ]
}

/**
 * Modelling frame -> print frame: (x, y, z) -> (x, z, -y), a proper rotation
 * that stands the part on its top face, then lifted so the bed is z = 0 and
 * the back of the catch is y = 0.
 */
export function toPrintFrame(mesh: Mesh, heightMm: number, backReachMm: number): Mesh {
  const src = mesh.positions
  const positions = new Float32Array(src.length)
  const bbox: Mesh['bbox'] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (let i = 0; i < src.length; i += 3) {
    const p = [src[i]!, src[i + 2]! + backReachMm, heightMm - src[i + 1]!]
    for (let k = 0; k < 3; k++) {
      positions[i + k] = p[k]!
      bbox[k] = Math.min(bbox[k]!, p[k]!)
      bbox[k + 3] = Math.max(bbox[k + 3]!, p[k]!)
    }
  }
  return { ...mesh, positions, bbox }
}

export function buildCaliperHolder(cfg: CaliperHolderConfig = CALIPER_HOLDER): Mesh {
  const d = derive(cfg)
  const { mesh } = buildBands(bandsFor(cfg))
  return toPrintFrame(mesh, cfg.blockHeightMm, d.backReachMm)
}
