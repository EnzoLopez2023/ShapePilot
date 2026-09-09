// How a tool tray was being looked at, remembered per tray.
//
// Same reasoning as the sibling designers': local, never exported, and losing
// it costs a couple of toggles. Storage mechanics are shared, in
// `src/state/viewSettingsStore.ts`.
import { booleanOr, createViewSettingsStore, numberIn } from '../../../state/viewSettingsStore.ts'
import { isMaterialId } from '../../keycap-tray/model/materials.ts'
import type { MaterialId } from '../../keycap-tray/model/materials.ts'

export type CanvasMode = '2d' | '3d'

export interface ViewSettings {
  view: CanvasMode
  imperial: boolean
  snapMm: number
  /** Outline the lift-recess keep-outs, so you can see what to avoid. */
  showKeepOuts: boolean
  /** Shade each pocket by depth, so the tiers read at a glance. */
  showDepths: boolean
  /** Filament the floor checks hold the tray to. Not part of the design. */
  material: MaterialId
}

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  view: '2d',
  imperial: false,
  snapMm: 0.5,
  showKeepOuts: true,
  showDepths: true,
  material: 'generic',
}

/** Snap steps offered in the toolbar: 0.5 mm through 5 mm. */
export const SNAP_STEPS_MM = Array.from({ length: 10 }, (_, i) => (i + 1) * 0.5)

export function readViewSettings(raw: unknown, baseline: ViewSettings): ViewSettings {
  if (typeof raw !== 'object' || raw === null) return baseline
  const s = raw as Record<string, unknown>
  return {
    view: s.view === '2d' || s.view === '3d' ? s.view : baseline.view,
    imperial: booleanOr(s.imperial, baseline.imperial),
    snapMm: numberIn(s.snapMm, 0, 100, baseline.snapMm),
    showKeepOuts: booleanOr(s.showKeepOuts, baseline.showKeepOuts),
    showDepths: booleanOr(s.showDepths, baseline.showDepths),
    material: isMaterialId(s.material) ? s.material : baseline.material,
  }
}

const store = createViewSettingsStore<ViewSettings>({
  key: 'shapepilot:tool-tray:view-settings',
  read: readViewSettings,
})

export const loadViewSettings = (designId: string, baseline: ViewSettings): ViewSettings =>
  store.load(designId, baseline)

export const saveViewSettings = (designId: string, settings: ViewSettings): void =>
  store.save(designId, settings)

/** Drop a tray's memory. Called when the tray itself is deleted. */
export const forgetViewSettings = (designId: string): void => store.forget(designId)
