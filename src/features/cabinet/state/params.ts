// The cabinet's parameters, remembered in this browser.
//
// Unlike the trays, a cabinet has no server-side design yet: it is a handful of
// numbers that derive everything else, so the whole thing fits in the same
// per-design localStorage record the designers already use. One entry, keyed
// 'default', until there is a reason for more than one case at a time.
import { booleanOr, createViewSettingsStore, numberIn } from '../../../state/viewSettingsStore.ts'
import { DEFAULT_CABINET } from '../model/cabinet.ts'
import type { CabinetParams } from '../model/cabinet.ts'

export interface CabinetSettings extends CabinetParams {
  /** Show lengths in fractional inches. Stock comes in inches; cuts in mm. */
  imperial: boolean
  /** Names the design and prefixes every exported file. Empty falls back to the tray count. */
  label: string
  /** Flat drawings, or the assembled case in 3D. */
  view: '2d' | '3d'
}

export const DEFAULT_CABINET_SETTINGS: CabinetSettings = {
  ...DEFAULT_CABINET,
  label: '',
  imperial: false,
  view: '2d',
}

/** Rebuilt field by field: anything in storage was written by an older release. */
export function readCabinetSettings(
  raw: unknown, baseline: CabinetSettings,
): CabinetSettings {
  if (typeof raw !== 'object' || raw === null) return baseline
  const s = raw as Record<string, unknown>
  return {
    trayCount: Math.round(numberIn(s.trayCount, 1, 60, baseline.trayCount)),
    trayWidthMm: numberIn(s.trayWidthMm, 10, 1200, baseline.trayWidthMm),
    trayDepthMm: numberIn(s.trayDepthMm, 10, 1200, baseline.trayDepthMm),
    trayThicknessMm: numberIn(s.trayThicknessMm, 0.5, 100, baseline.trayThicknessMm),
    dadoHeightMm: numberIn(s.dadoHeightMm, 1, 100, baseline.dadoHeightMm),
    dadoDepthMm: numberIn(s.dadoDepthMm, 0.5, 50, baseline.dadoDepthMm),
    gapMm: numberIn(s.gapMm, 0, 200, baseline.gapMm),
    stockMm: numberIn(s.stockMm, 3, 60, baseline.stockMm),
    backMm: numberIn(s.backMm, 1, 40, baseline.backMm),
    slideClearanceMm: numberIn(s.slideClearanceMm, 0, 10, baseline.slideClearanceMm),
    frenchCleat: booleanOr(s.frenchCleat, baseline.frenchCleat),
    cleatThicknessMm: numberIn(s.cleatThicknessMm, 3, 60, baseline.cleatThicknessMm),
    cleatHeightMm: numberIn(s.cleatHeightMm, 10, 300, baseline.cleatHeightMm),
    label: typeof s.label === 'string' ? s.label.slice(0, 60) : baseline.label,
    imperial: booleanOr(s.imperial, baseline.imperial),
    view: s.view === '2d' || s.view === '3d' ? s.view : baseline.view,
  }
}

const store = createViewSettingsStore<CabinetSettings>({
  key: 'shapepilot:cabinet:params',
  read: readCabinetSettings,
})

export const loadCabinetSettings = (): CabinetSettings =>
  store.load('default', DEFAULT_CABINET_SETTINGS)

export const saveCabinetSettings = (settings: CabinetSettings): void =>
  store.save('default', settings)
