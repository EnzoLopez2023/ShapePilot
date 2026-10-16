// How the Gridfinity designer is being looked at. One entry for the whole
// designer rather than one per design: inches versus millimetres and layout
// versus 3D are habits of the person, not properties of a bin.
import { booleanOr, createViewSettingsStore } from '../../../state/viewSettingsStore.ts'

export interface ViewSettings {
  /** Baseplate only: the drawer plan, or the tiles in 3D. */
  view: '2d' | '3d'
  imperial: boolean
}

export const DEFAULT_VIEW_SETTINGS: ViewSettings = { view: '2d', imperial: true }

const store = createViewSettingsStore<ViewSettings>({
  key: 'shapepilot:gridfinity:view-settings',
  read: (raw, baseline) => {
    if (typeof raw !== 'object' || raw === null) return baseline
    const e = raw as Record<string, unknown>
    return {
      view: e.view === '2d' || e.view === '3d' ? e.view : baseline.view,
      imperial: booleanOr(e.imperial, baseline.imperial),
    }
  },
})

const KEY = 'designer'
export const loadViewSettings = () => store.load(KEY, DEFAULT_VIEW_SETTINGS)
export const saveViewSettings = (s: ViewSettings) => store.save(KEY, s)
