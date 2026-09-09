// Per-design view settings in localStorage, for any designer that wants them.
//
// This is the *storage* half of what the keycap and switch trays each had their
// own copy of: one app-owned key holding every design's entry, an LRU prune so
// the record stays a few kilobytes, and a try/catch around every access because
// private mode and a quota refusal must never surface as an error.
//
// The *field* half deliberately stays in each feature. What a keycap tray
// remembers (ten fields, including a filament) has nothing in common with what a
// switch tray remembers (three), and a shared shape would either be a union of
// everything or a `Record<string, unknown>`. So each feature keeps its own
// `ViewSettings` type and its own field-by-field reader, and hands both to the
// factory here.
//
// Whatever comes back out of storage is untrusted -- written by an older release
// of this app, or by hand -- which is why `read` rebuilds against a baseline
// rather than casting. A snap of `null` would silently stop a canvas snapping.

export interface ViewSettingsStore<T> {
  /** What was last used on this design, falling back to `baseline` per field. */
  load(designId: string, baseline: T): T
  save(designId: string, settings: T): void
  /** Drop a design's memory. Called when the design itself is deleted. */
  forget(designId: string): void
}

export interface ViewSettingsStoreOptions<T> {
  /** App-owned localStorage key. One object per designer, not one per design,
   *  so the whole record can be pruned in a single write. */
  key: string
  /** Rebuild one entry field by field against `baseline`. Never trust `raw`. */
  read: (raw: unknown, baseline: T) => T
  /**
   * How many designs are remembered. The default is well past any real
   * collection and small enough that the record stays a few kilobytes --
   * localStorage is a shared, bounded space and an app that grows in it
   * forever is a bad tenant.
   */
  remembered?: number
}

const REMEMBERED_DEFAULT = 60

/** Epoch millis, for pruning the least recently opened. */
interface Stamped { at?: number }

export function createViewSettingsStore<T>(
  options: ViewSettingsStoreOptions<T>,
): ViewSettingsStore<T> {
  const { key, read } = options
  const remembered = options.remembered ?? REMEMBERED_DEFAULT

  type Record_ = Record<string, T & Stamped>

  const readRecord = (): Record_ => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(key) ?? '{}')
      return (typeof raw === 'object' && raw !== null ? raw : {}) as Record_
    } catch {
      // Private mode, a quota refusal, or something else's key. Not
      // remembering is the correct outcome and must never surface as an error.
      return {}
    }
  }

  return {
    load: (designId, baseline) => read(readRecord()[designId], baseline),

    save: (designId, settings) => {
      try {
        const record = readRecord()
        record[designId] = { ...settings, at: Date.now() }

        const ids = Object.keys(record)
        if (ids.length > remembered) {
          // Least recently opened first. A missing `at` is an entry from before
          // pruning existed, so it goes first.
          const ordered = ids.sort((a, b) => (record[a]?.at ?? 0) - (record[b]?.at ?? 0))
          for (const id of ordered.slice(0, ids.length - remembered)) delete record[id]
        }

        localStorage.setItem(key, JSON.stringify(record))
      } catch { /* private mode, quota; forgetting is an acceptable outcome */ }
    },

    forget: designId => {
      try {
        const record = readRecord()
        if (!(designId in record)) return
        delete record[designId]
        localStorage.setItem(key, JSON.stringify(record))
      } catch { /* as above */ }
    },
  }
}

// Field coercers, so each feature's `read` is a list of fields rather than a
// list of fields plus its own copy of these two.

/** Bounds should match the control's own choices; anything else is not ours. */
export const numberIn = (
  value: unknown, min: number, max: number, fallback: number,
): number =>
  (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max)
    ? value
    : fallback

export const booleanOr = (value: unknown, fallback: boolean): boolean =>
  (typeof value === 'boolean' ? value : fallback)
