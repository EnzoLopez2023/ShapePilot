// Shaper BenchPilot reach, from support.shapertools.com/benchpilot-faq. The
// range is approximate, so it is drawn as a guide and never enforced.
export type BenchPilotMount = 'workstation' | 'bench'

export interface BenchPilotReach { widthMm: number; heightMm: number; label: string }

export const BENCHPILOT_REACH: Record<BenchPilotMount, BenchPilotReach> = {
  workstation: { widthMm: 460, heightMm: 280, label: 'BenchPilot · on Workstation (~460 × 280 mm)' },
  bench: { widthMm: 460, heightMm: 445, label: 'BenchPilot · on bench (~460 × 445 mm)' },
}

/** Whether a part fits the reach, either way round -- the stock can be turned. */
export const fitsReach = (reach: BenchPilotReach, wMm: number, hMm: number): boolean =>
  (wMm <= reach.widthMm && hMm <= reach.heightMm)
  || (hMm <= reach.widthMm && wMm <= reach.heightMm)
