// How a tray was being looked at, remembered per tray.
//
// Snap, grid, the buffer guide and the rest are not properties of the design --
// they never leave the browser and nothing exported depends on them. But they
// are properties of *working on* a design: a tray laid out at 1u pitch with the
// buffer showing wants to come back that way, and retyping four dropdowns on
// every open is the kind of small tax that makes a tool tiring.
//
// Local, therefore, rather than server-side: this is how one person at one
// machine was looking at something, not a fact about the tray. Losing it costs
// four dropdowns.
//
// The storage mechanics live in `src/state/viewSettingsStore.ts`, shared with
// the other designers. What stays here is the part that is actually about a
// keycap tray: the fields, and how to read each one back safely.
import { booleanOr, createViewSettingsStore, numberIn } from '../../../state/viewSettingsStore.ts'
import { isMaterialId } from '../model/materials.ts'
import type { MaterialId } from '../model/materials.ts'

export type CanvasMode = '2d' | '3d'
export type FabricationTarget = 'print' | 'cnc'

export interface ViewSettings {
  view: CanvasMode
  snapMm: number
  gridMm: number
  showLabels: boolean
  showPlate: boolean
  showBuffer: boolean
  bufferMm: number
  imperial: boolean
  target: FabricationTarget
  /** Filament the print checks hold the tray to. Not part of the saved design. */
  material: MaterialId
}

/** The toolbar's starting point for a tray nothing is remembered about. */
export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  view: '2d',
  snapMm: 0.5,
  gridMm: 5,
  showLabels: true,
  showPlate: false,
  showBuffer: false,
  /** Matches DEFAULT_FABRICATION.minWallMm, the wall-thickness check's bound. */
  bufferMm: 1.8,
  imperial: false,
  target: 'print',
  material: 'generic',
}

/** Snap steps offered in the View section: 0.5 mm through 5 mm in 0.5 mm
 *  increments, plus the 1u key pitch. */
export const SNAP_STEPS_MM = Array.from({ length: 10 }, (_, i) => (i + 1) * 0.5)

/** Buffer guide distances, in mm inside the tray edge. */
export const BUFFER_STEPS_MM = [1, 1.5, 1.8, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10]

const isMode = (value: unknown): value is CanvasMode => value === '2d' || value === '3d'
const isTarget = (value: unknown): value is FabricationTarget =>
  value === 'print' || value === 'cnc'

/**
 * Rebuilt field by field against a caller-supplied baseline.
 *
 * Anything in storage is untrusted: it was written by an older version of this
 * app, or by hand. A snap of `null` would silently stop the canvas snapping,
 * and a stale key from a future release should not reach React at all.
 */
export function readViewSettings(raw: unknown, baseline: ViewSettings): ViewSettings {
  if (typeof raw !== 'object' || raw === null) return baseline
  const stored = raw as Record<string, unknown>
  return {
    view: isMode(stored.view) ? stored.view : baseline.view,
    snapMm: numberIn(stored.snapMm, 0, 100, baseline.snapMm),
    gridMm: numberIn(stored.gridMm, 0, 100, baseline.gridMm),
    showLabels: booleanOr(stored.showLabels, baseline.showLabels),
    showPlate: booleanOr(stored.showPlate, baseline.showPlate),
    showBuffer: booleanOr(stored.showBuffer, baseline.showBuffer),
    bufferMm: numberIn(stored.bufferMm, 0, 100, baseline.bufferMm),
    imperial: booleanOr(stored.imperial, baseline.imperial),
    target: isTarget(stored.target) ? stored.target : baseline.target,
    material: isMaterialId(stored.material) ? stored.material : baseline.material,
  }
}

const store = createViewSettingsStore<ViewSettings>({
  key: 'shapepilot:keycap-tray:view-settings',
  read: readViewSettings,
})

/** What was last used on this tray, falling back to `baseline` per field. */
export const loadViewSettings = (designId: string, baseline: ViewSettings): ViewSettings =>
  store.load(designId, baseline)

export const saveViewSettings = (designId: string, settings: ViewSettings): void =>
  store.save(designId, settings)

/** Drop a tray's memory. Called when the tray itself is deleted. */
export const forgetViewSettings = (designId: string): void => store.forget(designId)
