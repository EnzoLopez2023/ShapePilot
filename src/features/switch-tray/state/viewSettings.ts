// How a switch tray was being looked at, remembered per tray.
//
// The same reasoning as the keycap tray's own store (see
// `keycap-tray/state/viewSettings.ts`): these never leave the browser and
// nothing exported depends on them, but they are properties of *working on* a
// tray, and retyping them on every open is the kind of small tax that makes a
// tool tiring. Local, therefore, and losing them costs two toggles.

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

/** App-owned key, and one object rather than a key per tray, so the whole
 *  record can be pruned in one write. */
const KEY = 'shapepilot:switch-tray:view-settings'

/** Well past any real collection, and small enough to stay a few kilobytes. */
const REMEMBERED_TRAYS = 60

interface StoredEntry extends ViewSettings {
  /** Epoch millis, for pruning the least recently opened. */
  at: number
}

type StoredRecord = Record<string, StoredEntry>

/** Rebuilt field by field: stored JSON is untrusted, and a hand-edited or
 *  older record must degrade to the baseline rather than to `undefined`. */
function readViewSettings(entry: unknown, baseline: ViewSettings): ViewSettings {
  if (typeof entry !== 'object' || entry === null) return baseline
  const e = entry as Partial<StoredEntry>
  return {
    view: e.view === '2d' || e.view === '3d' ? e.view : baseline.view,
    imperial: typeof e.imperial === 'boolean' ? e.imperial : baseline.imperial,
    showHousings:
      typeof e.showHousings === 'boolean' ? e.showHousings : baseline.showHousings,
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

export function loadViewSettings(designId: string, baseline: ViewSettings): ViewSettings {
  return readViewSettings(readRecord()[designId], baseline)
}

export function saveViewSettings(designId: string, settings: ViewSettings): void {
  try {
    const record = readRecord()
    record[designId] = { ...settings, at: Date.now() }
    const ids = Object.keys(record)
    if (ids.length > REMEMBERED_TRAYS) {
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
  } catch { /* same as above */ }
}
