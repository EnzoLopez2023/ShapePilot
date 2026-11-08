// MFT-style workbench top: a panel of any size with 20 mm dog holes on the
// 96 mm grid Festool's MFT/3 uses and most bench dogs, clamps and stops expect.
//
// Unlike SKADIS nothing here forces the size: a dog only needs the holes to be
// 96 mm apart, not a particular distance from the edge. So the panel is
// whatever the bench needs, and the grid is centred on it -- as many whole
// pitches as fit inside the edge margin, the leftover split evenly so both
// sides of the top look the same. A size that is a whole number of pitches
// (1152 = 12 x 96) puts every edge hole exactly half a pitch in, which is what
// lets two tops butted together continue one grid.
import { circleRing, roundedRectRing } from './primitives.ts'
import type { Ring } from './vec.ts'
import { translateRing } from './vec.ts'

export const MFT = {
  /** Dog hole. 20 mm is the Festool standard every MFT accessory fits. */
  holeDiameterMm: 20,
  /** Hole centre to hole centre, both ways. */
  pitchMm: 96,
  /** The least an edge hole's centre may sit from the panel edge: half a
   *  pitch, so panels butted together keep the grid. */
  edgeMarginMm: 48,
  /** Panel corner. */
  cornerRadiusMm: 3,
} as const

/** The MFT/3 top. */
export const MFT_DEFAULT_WIDTH_MM = 1152
export const MFT_DEFAULT_DEPTH_MM = 772

/**
 * Screw patterns for Shaper's own hardware, read off Shaper's "Shelf Upgrade
 * Kit - Large Shelf Top" cut file, which carries both. Every screw there is a
 * 6.5 mm through-hole (M6 clearance) under a 12.7 mm counterbore pocketed
 * 12 mm deep. Both patterns are centred side to side.
 *
 * - Workstation: 240 mm across x 89 mm front to back, first row 11.5 mm in
 *   from the top edge.
 * - Support leg: 87.9 mm across x 29.2 mm front to back, first row 20 mm in
 *   from the bottom edge.
 */
export const SHAPER_SCREWS = {
  holeDiameterMm: 6.5,
  counterboreDiameterMm: 12.7,
  counterboreDepthMm: 12,
  workstation: { spacingXMm: 240, spacingYMm: 89, insetMm: 11.5, fromTop: true },
  supportLeg: { spacingXMm: 87.9, spacingYMm: 29.2, insetMm: 20, fromTop: false },
} as const

/** Wood left between a counterbore and the nearest dog hole. A dog hole closer
 *  than this is left out rather than cut into the screw's seat. */
const SCREW_CLEARANCE_MM = 5

/** Holes closer than this would leave no web between them to hold a dog. */
const MIN_WEB_MM = 1

export interface MftGrid {
  holeDiameterMm: number
  pitchMm: number
  edgeMarginMm: number
}

export interface MftParams {
  widthMm?: number
  heightMm?: number
  holeDiameterMm?: number
  pitchMm?: number
  edgeMarginMm?: number
  cornerRadiusMm?: number
  /** 1 adds the Shaper Workstation's screw holes, 0 or absent leaves them
   *  off. Numbers rather than booleans because the param bag is all numbers. */
  workstationScrews?: number
  /** 1 adds the Shaper support leg's screw holes. */
  legScrews?: number
  screwDiameterMm?: number
  counterboreDiameterMm?: number
  /** 0 cuts the screw holes without counterbores. */
  counterboreDepthMm?: number
}

/**
 * The grid as it will be built. A stale or hand-typed document can carry a
 * pitch smaller than the hole or a margin that leaves holes hanging off the
 * edge; both are pulled back to the nearest buildable value rather than drawn.
 */
export function resolveMftGrid(p: MftParams): MftGrid {
  const holeDiameterMm = Math.max(0.1, p.holeDiameterMm ?? MFT.holeDiameterMm)
  const pitchMm = Math.max(holeDiameterMm + MIN_WEB_MM, p.pitchMm ?? MFT.pitchMm)
  const edgeMarginMm = Math.max(holeDiameterMm / 2 + MIN_WEB_MM, p.edgeMarginMm ?? MFT.edgeMarginMm)
  return { holeDiameterMm, pitchMm, edgeMarginMm }
}

/** Hole centres along one axis of length `span`, centred, origin at its start. */
function axisCentres(span: number, pitch: number, margin: number): number[] {
  const usable = span - 2 * margin
  if (usable < -1e-6) return []
  // +1e-6 so a span that is an exact number of pitches does not lose its last hole.
  const count = Math.floor(usable / pitch + 1e-6) + 1
  const first = (span - (count - 1) * pitch) / 2
  return Array.from({ length: count }, (_, i) => first + i * pitch)
}

/** Hole centres for a `width x depth` top, origin at its lower-left. */
export function mftHoleCentres(widthMm: number, depthMm: number, grid: MftGrid): [number, number][] {
  const xs = axisCentres(widthMm, grid.pitchMm, grid.edgeMarginMm)
  const ys = axisCentres(depthMm, grid.pitchMm, grid.edgeMarginMm)
  return ys.flatMap(y => xs.map(x => [x, y] as [number, number]))
}

export interface MftScrews {
  holeDiameterMm: number
  /** 0 when there is no counterbore. */
  counterboreDiameterMm: number
  counterboreDepthMm: number
}

export function resolveMftScrews(p: MftParams): MftScrews {
  const holeDiameterMm = Math.max(0.1, p.screwDiameterMm ?? SHAPER_SCREWS.holeDiameterMm)
  const depth = Math.max(0, p.counterboreDepthMm ?? SHAPER_SCREWS.counterboreDepthMm)
  const dia = p.counterboreDiameterMm ?? SHAPER_SCREWS.counterboreDiameterMm
  // A counterbore no wider than its hole would be nothing to pocket.
  const counterbore = depth > 0 && dia > holeDiameterMm
  return {
    holeDiameterMm,
    counterboreDiameterMm: counterbore ? dia : 0,
    counterboreDepthMm: counterbore ? depth : 0,
  }
}

/**
 * Screw centres for every pattern switched on, origin at the lower-left. A
 * screw whose counterbore would not sit wholly on the panel is dropped rather
 * than cut through the edge.
 */
export function mftScrewCentres(widthMm: number, depthMm: number, p: MftParams): [number, number][] {
  const patterns = [
    p.workstationScrews ? SHAPER_SCREWS.workstation : null,
    p.legScrews ? SHAPER_SCREWS.supportLeg : null,
  ].filter(x => x !== null)
  if (!patterns.length) return []
  const screws = resolveMftScrews(p)
  const r = Math.max(screws.holeDiameterMm, screws.counterboreDiameterMm) / 2
  return patterns.flatMap(({ spacingXMm: sx, spacingYMm: sy, insetMm, fromTop }) => {
    const first = fromTop ? depthMm - insetMm : insetMm
    const second = fromTop ? first - sy : first + sy
    return [first, second].flatMap(y =>
      [widthMm / 2 - sx / 2, widthMm / 2 + sx / 2].map(x => [x, y] as [number, number]))
  }).filter(([x, y]) => x >= r && x <= widthMm - r && y >= r && y <= depthMm - r)
}

/** Screws asked for, on or off the panel -- so the inspector can say how many fell off. */
export const mftScrewsWanted = (p: MftParams): number =>
  (p.workstationScrews ? 4 : 0) + (p.legScrews ? 4 : 0)

/**
 * The dog holes actually cut: the grid less any hole that would reach a
 * screw's counterbore. Every count and ring comes from here, so the
 * inspector's number is the number cut.
 */
export function mftDogCentres(widthMm: number, depthMm: number, p: MftParams): [number, number][] {
  const grid = resolveMftGrid(p)
  const screwCentres = mftScrewCentres(widthMm, depthMm, p)
  const all = mftHoleCentres(widthMm, depthMm, grid)
  if (!screwCentres.length) return all
  const screws = resolveMftScrews(p)
  // Clear of the counterbore's footprint, or of the drawing's 12.7 mm seat when
  // there is no counterbore -- the head still needs flat wood to bear on.
  const seat = Math.max(screws.holeDiameterMm, screws.counterboreDiameterMm || SHAPER_SCREWS.counterboreDiameterMm)
  const keepOut = grid.holeDiameterMm / 2 + seat / 2 + SCREW_CLEARANCE_MM
  return all.filter(([x, y]) => screwCentres.every(([sx, sy]) => Math.hypot(x - sx, y - sy) >= keepOut))
}

/** The counterbores, centred like `mftRings`; empty when there are none. They
 *  are pockets, not holes, so they travel apart from the panel's own rings. */
export function mftCounterboreRings(p: MftParams): Ring[] {
  const w = p.widthMm ?? MFT_DEFAULT_WIDTH_MM
  const h = p.heightMm ?? MFT_DEFAULT_DEPTH_MM
  const { counterboreDiameterMm: d } = resolveMftScrews(p)
  if (!d) return []
  const ring = circleRing(d / 2, 48)
  return mftScrewCentres(w, h, p).map(([x, y]) => translateRing(ring, x - w / 2, y - h / 2))
}

/** Columns x rows, for the inspector's summary. */
export function mftGridSize(widthMm: number, depthMm: number, grid: MftGrid): [number, number] {
  return [
    axisCentres(widthMm, grid.pitchMm, grid.edgeMarginMm).length,
    axisCentres(depthMm, grid.pitchMm, grid.edgeMarginMm).length,
  ]
}

/**
 * `[outline, ...holes]`, centred on the origin like every other parametric
 * shape. One polygon with holes, exactly as the SKADIS board is: emitted as
 * separate polygons the holes would become islands and a union fill them in.
 */
export function mftRings(p: MftParams): Ring[] {
  const w = p.widthMm ?? MFT_DEFAULT_WIDTH_MM
  const h = p.heightMm ?? MFT_DEFAULT_DEPTH_MM
  const grid = resolveMftGrid(p)
  const outline = roundedRectRing(-w / 2, -h / 2, w, h, p.cornerRadiusMm ?? MFT.cornerRadiusMm, 16)
  const hole = circleRing(grid.holeDiameterMm / 2)
  const holes = mftDogCentres(w, h, p).map(([x, y]) => translateRing(hole, x - w / 2, y - h / 2))
  const screw = circleRing(resolveMftScrews(p).holeDiameterMm / 2, 32)
  const screws = mftScrewCentres(w, h, p).map(([x, y]) => translateRing(screw, x - w / 2, y - h / 2))
  return [outline, ...holes, ...screws]
}
