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
}

/** Snap steps offered in the View section: 0.5 mm through 5 mm in 0.5 mm
 *  increments, plus the 1u key pitch. */
export const SNAP_STEPS_MM = Array.from({ length: 10 }, (_, i) => (i + 1) * 0.5)

/** Buffer guide distances, in mm inside the tray edge. */
export const BUFFER_STEPS_MM = [1, 1.5, 1.8, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10]

/** App-owned key, and one object rather than a key per tray, so the whole
 *  record can be pruned in one write. */
const KEY = 'shapepilot:keycap-tray:view-settings'

/**
 * How many trays are remembered. Well past any real collection, and small
 * enough that the record stays a few kilobytes -- localStorage is a shared,
 * bounded space and an app that grows in it forever is a bad tenant.
 */
const REMEMBERED_TRAYS = 60

interface StoredEntry extends ViewSettings {
  /** Epoch millis, for pruning the least recently opened. */
  at: number
}

type StoredRecord = Record<string, StoredEntry>

const isMode = (value: unknown): value is CanvasMode => value === '2d' || value === '3d'
const isTarget = (value: unknown): value is FabricationTarget =>
  value === 'print' || value === 'cnc'

/** Bounds match the toolbar's own choices; anything else is not ours. */
const number = (value: unknown, min: number, max: number, fallback: number): number =>
  (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max)
    ? value
    : fallback

const boolean = (value: unknown, fallback: boolean): boolean =>
  (typeof value === 'boolean' ? value : fallback)

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
    snapMm: number(stored.snapMm, 0, 100, baseline.snapMm),
    gridMm: number(stored.gridMm, 0, 100, baseline.gridMm),
    showLabels: boolean(stored.showLabels, baseline.showLabels),
    showPlate: boolean(stored.showPlate, baseline.showPlate),
    showBuffer: boolean(stored.showBuffer, baseline.showBuffer),
    bufferMm: number(stored.bufferMm, 0, 100, baseline.bufferMm),
    imperial: boolean(stored.imperial, baseline.imperial),
    target: isTarget(stored.target) ? stored.target : baseline.target,
  }
}

function readRecord(): StoredRecord {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return (typeof raw === 'object' && raw !== null ? raw : {}) as StoredRecord
  } catch {
    // Private mode, a quota refusal, or something else's key. Not remembering
    // is the correct outcome and must never surface as an error.
    return {}
  }
}

/** What was last used on this tray, falling back to `baseline` per field. */
export function loadViewSettings(designId: string, baseline: ViewSettings): ViewSettings {
  return readViewSettings(readRecord()[designId], baseline)
}

export function saveViewSettings(designId: string, settings: ViewSettings): void {
  try {
    const record = readRecord()
    record[designId] = { ...settings, at: Date.now() }

    const ids = Object.keys(record)
    if (ids.length > REMEMBERED_TRAYS) {
      // Least recently opened first. A missing `at` is an entry from before
      // pruning existed, so it goes first.
      const ordered = ids.sort((a, b) => (record[a]?.at ?? 0) - (record[b]?.at ?? 0))
      for (const id of ordered.slice(0, ids.length - REMEMBERED_TRAYS)) delete record[id]
    }

    localStorage.setItem(KEY, JSON.stringify(record))
  } catch { /* private mode, quota; forgetting is an acceptable outcome */ }
}

/** Drop a tray's memory. Called when the tray itself is deleted. */
export function forgetViewSettings(designId: string): void {
  try {
    const record = readRecord()
    if (!(designId in record)) return
    delete record[designId]
    localStorage.setItem(KEY, JSON.stringify(record))
  } catch { /* as above */ }
}
