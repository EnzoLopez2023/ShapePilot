// How a switch tray was being looked at, remembered per tray.
//
// The same reasoning as the keycap tray's own store (see
// `keycap-tray/state/viewSettings.ts`): these never leave the browser and
// nothing exported depends on them, but they are properties of *working on* a
// tray, and retyping them on every open is the kind of small tax that makes a
// tool tiring. Local, therefore, and losing them costs two toggles.
//
// Storage mechanics are shared, in `src/state/viewSettingsStore.ts`.
import { booleanOr, createViewSettingsStore } from '../../../state/viewSettingsStore.ts'

export type CanvasMode = '2d' | '3d'

export interface ViewSettings {
  view: CanvasMode
  imperial: boolean
  /** Outline the top housings, so you can see how close they really sit. */
  showHousings: boolean
}

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  view: '2d',
  imperial: false,
  showHousings: true,
}

/** Rebuilt field by field: stored JSON is untrusted, and a hand-edited or
 *  older record must degrade to the baseline rather than to `undefined`. */
export function readViewSettings(entry: unknown, baseline: ViewSettings): ViewSettings {
  if (typeof entry !== 'object' || entry === null) return baseline
  const e = entry as Record<string, unknown>
  return {
    view: e.view === '2d' || e.view === '3d' ? e.view : baseline.view,
    imperial: booleanOr(e.imperial, baseline.imperial),
    showHousings: booleanOr(e.showHousings, baseline.showHousings),
  }
}

const store = createViewSettingsStore<ViewSettings>({
  key: 'shapepilot:switch-tray:view-settings',
  read: readViewSettings,
})

export const loadViewSettings = (designId: string, baseline: ViewSettings): ViewSettings =>
  store.load(designId, baseline)

export const saveViewSettings = (designId: string, settings: ViewSettings): void =>
  store.save(designId, settings)

/** Drop a tray's memory. Called when the tray itself is deleted. */
export const forgetViewSettings = (designId: string): void => store.forget(designId)
