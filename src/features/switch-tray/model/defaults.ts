// What a retention style implies, and what a fresh tray looks like.
import { MX, type SwitchProfile } from './switches.ts'
import type {
  FeetSettings, FillSettings, PlateSettings, Retention, SwitchTrayDesign,
} from './types.ts'

/** Air between a stacked tray's pins and the switch tops it hangs over. */
export const STACK_CLEARANCE_MM = 0.5

/** Thinnest plate worth printing, and the floor for a `shelf` shelf. */
export const MIN_SHELF_MM = 1.2

/**
 * Snap a plate thickness onto a whole number of 0.2 mm layers.
 *
 * A switch's spec plate thickness is an injection-moulding number and is not
 * always printable: MX asks for 1.50 mm, which is seven and a half layers at
 * the default height and comes out with its face landing mid-layer. A tenth
 * either way is well inside what the clips tolerate -- 1.6 mm FR4 plates are
 * the norm in real keyboards -- so the printable thickness is the better
 * default, and it keeps `validate.ts` from warning about every fresh tray.
 * Ties go up, because a plate is the one part where thicker never hurts.
 */
export const snapToLayersMm = (mm: number): number => {
  const layers = Math.max(1, Math.floor(mm / 0.2 + 0.5 + 1e-9))
  return Math.round(layers * 20) / 100
}

export const RETENTION_LABELS: Record<Retention, { label: string; blurb: string }> = {
  shelf: {
    label: 'Drop-in shelf',
    blurb: 'A recess for the top housing over a hole for the body. Drops in, lifts out.',
  },
  clip: {
    label: 'Clip-in plate',
    blurb: 'A keyboard plate — the switch clips in and stays put even upside down.',
  },
  plain: {
    label: 'Plain hole',
    blurb: 'A flat plate; the housing rests on the face. Simplest, but tips out.',
  },
}

export function defaultPlate(retention: Retention, s: SwitchProfile): PlateSettings {
  const common = { retention, holeClearanceMm: 0.2, recessClearanceMm: 0.3, cornerRadiusMm: 0.5 }
  switch (retention) {
    case 'shelf':
      // The shelf still carries the whole tray, so it does not go as thin as a
      // clip plate; the recess is deep enough to stop a switch tipping.
      return { ...common, shelfMm: Math.max(1.6, snapToLayersMm(s.clipPlateMm)), recessMm: 2.0 }
    case 'clip':
      return { ...common, shelfMm: snapToLayersMm(s.clipPlateMm), recessMm: 0 }
    case 'plain':
      return { ...common, shelfMm: 2.0, recessMm: 0, holeClearanceMm: 0.4 }
  }
}

/** The square cut clean through the plate. */
export const cellHoleMm = (plate: PlateSettings, s: SwitchProfile): number =>
  s.bodyMm + plate.holeClearanceMm

/**
 * The square a cell has to own outright -- what the fill algorithm packs and
 * what sets the wall between neighbours. For a `shelf` that is the recess; for
 * the other two the plate only cuts the body hole, and the housings simply
 * overhang the material between them.
 */
export const cellKeepoutMm = (plate: PlateSettings, s: SwitchProfile): number =>
  plate.retention === 'shelf'
    ? s.housingMm + plate.recessClearanceMm
    : cellHoleMm(plate, s)

/** Material left between two neighbouring cells at this pitch. */
export const wallAtPitchMm = (pitchMm: number, plate: PlateSettings, s: SwitchProfile): number =>
  pitchMm - cellKeepoutMm(plate, s)

/**
 * The closest two cells can stand: never below what the manufacturer allows,
 * and never so close the wall between the cuts stops being printable.
 */
export const minPitchMm = (plate: PlateSettings, s: SwitchProfile): number =>
  Math.max(s.minPitchMm, cellKeepoutMm(plate, s) + 1.2)

export function defaultFill(plate: PlateSettings, s: SwitchProfile): FillSettings {
  const pitch = Math.round(minPitchMm(plate, s) * 10) / 10
  return {
    pitchXMm: pitch,
    pitchYMm: pitch,
    marginMm: 3,
    stagger: 'none',
    origin: 'maximised',
    spreadEvenly: true,
  }
}

/**
 * How tall the posts under a stacked tray have to be.
 *
 * The tray above hangs its pins `flangeToTip` below its own shelf, into the
 * air this tray's switches already stand `flangeToTop` up into. Solving that
 * overlap gives a *tier pitch* of exactly one switch envelope plus clearance,
 * whatever the plate does -- the thin plate saves filament, not height.
 */
export const requiredFeetHeightMm = (plate: PlateSettings, s: SwitchProfile): number =>
  Math.max(0,
    s.flangeToTopMm + s.flangeToTipMm + STACK_CLEARANCE_MM - plate.recessMm - plate.shelfMm)

/**
 * The bottom tray only has to lift its own pins off the case floor.
 *
 * The same clearance the stacked case uses, and for the same reason: without
 * it the pin tips land exactly level with the bottom of the posts, which is not
 * "clear of the floor", it is "resting on the floor".
 */
export const bottomTierFeetHeightMm = (plate: PlateSettings, s: SwitchProfile): number =>
  Math.max(0, s.flangeToTipMm + STACK_CLEARANCE_MM - plate.shelfMm)

/**
 * Up to the next tenth of a millimetre, without float noise inventing one.
 *
 * These heights are differences of decimals -- 8.3 + 0.5 - 1.6 lands on
 * 7.200000000000001 -- and a bare `ceil` reads that as "past 7.2" and offers
 * 7.3. The epsilon is far below any dimension that matters and far above the
 * error being discarded.
 */
const roundUp = (mm: number): number => Math.ceil(mm * 10 - 1e-9) / 10

export function defaultFeet(plate: PlateSettings, s: SwitchProfile): FeetSettings {
  return {
    tier: 'stacked',
    heightMm: roundUp(requiredFeetHeightMm(plate, s)),
    sizeMm: 12,
    pattern: 'corners',
    bottomTierHeightMm: roundUp(bottomTierFeetHeightMm(plate, s)),
  }
}

/**
 * The post height this tray is actually built with.
 *
 * One function, used by the mesh, the validator and the stack budget alike, so
 * the tray that is previewed is the tray that is exported is the tray the
 * budget counted. The bottom of a stack rests on the case floor and only has to
 * lift its own pins; every tray above it stands on the one below and has to
 * clear a whole switch.
 */
export const feetHeightMm = (feet: FeetSettings | undefined): number => {
  if (!feet) return 0
  return feet.tier === 'bottom'
    ? feet.bottomTierHeightMm ?? feet.heightMm
    : feet.heightMm
}

export function emptyDesign(name = 'Untitled switch tray'): SwitchTrayDesign {
  const plate = defaultPlate('shelf', MX)
  return {
    id: crypto.randomUUID(),
    name,
    profile: { kind: 'preset', id: 'systainer-s76-plain' },
    switch: { ...MX },
    plate,
    fill: defaultFill(plate, MX),
    feet: defaultFeet(plate, MX),
    revision: 0,
  }
}
