// Machine profiles. Everything here is advisory: PRODUCT.md is explicit that
// manufacturability is checked per machine and reported, never silently
// corrected, so these numbers drive warnings and the workplane, nothing else.
import type { CncProfile, MachineProfile, PrinterProfile } from './document.ts'

/**
 * Bambu Lab X2D (announced April 2026), the dual-nozzle successor to the X1
 * Carbon. The main nozzle reaches the full bed; engaging the auxiliary Bowden
 * nozzle costs 20.5 mm in X and 4 mm in Z, so both envelopes are carried and
 * the viewport draws them as separate boundaries.
 */
export const BAMBU_X2D: PrinterProfile = {
  kind: 'printer',
  id: 'bambu-x2d',
  label: 'Bambu Lab X2D',
  buildMm: [256, 256, 260],
  dualNozzleBuildMm: [235.5, 256, 256],
  nozzleDiameterMm: 0.4,
  maxNozzleC: 300,
  maxBedC: 120,
  chamberC: 65,
}

export const BAMBU_X1C: PrinterProfile = {
  kind: 'printer',
  id: 'bambu-x1c',
  label: 'Bambu Lab X1 Carbon',
  buildMm: [256, 256, 256],
  nozzleDiameterMm: 0.4,
  maxNozzleC: 300,
  maxBedC: 110,
  chamberC: 60,
}

export const BAMBU_H2D: PrinterProfile = {
  kind: 'printer',
  id: 'bambu-h2d',
  label: 'Bambu Lab H2D',
  buildMm: [325, 320, 325],
  dualNozzleBuildMm: [300, 320, 325],
  nozzleDiameterMm: 0.4,
  maxNozzleC: 350,
  maxBedC: 120,
  chamberC: 65,
}

export const PRINTER_PROFILES: readonly PrinterProfile[] = [BAMBU_X2D, BAMBU_X1C, BAMBU_H2D]

/**
 * Shaper Origin. The default tool is the 1/8" (3.175 mm) upcut that ships with
 * the machine -- the same diameter DEFAULT_FABRICATION already uses for the
 * keycap tray, so the two sub-apps warn consistently.
 */
export const SHAPER_ORIGIN: CncProfile = {
  kind: 'cnc',
  id: 'shaper-origin',
  label: 'Shaper Origin',
  toolDiameterMm: 3.175,
  stockThicknessMm: 13,
  maxDepthPerPassMm: 1.5,
}

export const CNC_PROFILES: readonly CncProfile[] = [SHAPER_ORIGIN]

export const defaultMachineFor = (kind: 'shaper' | 'bambu' | 'playground'): MachineProfile =>
  kind === 'shaper' ? SHAPER_ORIGIN : BAMBU_X2D

export const findMachine = (id: string): MachineProfile | undefined =>
  [...PRINTER_PROFILES, ...CNC_PROFILES].find(m => m.id === id)
