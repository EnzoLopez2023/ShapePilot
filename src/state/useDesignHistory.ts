// Undo/redo and the revision counter, for any designer whose design is one
// immutable object.
//
// Both tray designers grew their own copy of this and the copies had already
// drifted -- the keycap hook bumped `revision` on undo/redo, the switch hook
// handed back the old revision. Unified here on **bump**, because `revision` is
// documented as the key every geometry `useMemo` reads and as what
// `hasUnsavedChanges` compares against the last saved value. A monotonic
// counter can over-report unsaved changes after an undo-then-redo; a
// non-monotonic one can *under*-report, which is the failure that loses work.
//
// What stays in each feature is everything domain-shaped: the typed setters, the
// selection, and the semantic invalidations (a switch tray drops its skipped
// cells when the lattice renumbers). Those compose on top of `replace`.
import { useCallback, useRef, useState } from 'react'

/** The one thing a design has to have for history to work on it. */
export interface Revisioned { revision: number }

export interface DesignHistory<T extends Revisioned> {
  design: T
  canUndo: boolean
  canRedo: boolean
  /**
   * The single funnel every mutation goes through, so history and the revision
   * counter stay in step. Deliberately the only way to change a design.
   */
  replace: (mutate: (d: T) => T) => void
  /** Opening a different design is not an edit -- it starts a new history. */
  setDesign: (d: T) => void
  undo: () => void
  redo: () => void
}

/**
 * How many steps back you can go. Deep enough that nobody hits it in a session
 * of real work, shallow enough that fifty copies of a design with a traced
 * outline in it is not a memory problem.
 */
const HISTORY_LIMIT = 50

export function useDesignHistory<T extends Revisioned>(makeInitial: () => T): DesignHistory<T> {
  const [design, setDesignState] = useState<T>(makeInitial)
  const past = useRef<T[]>([])
  const future = useRef<T[]>([])
  // History lives in refs so a mutation does not re-render twice, which means
  // canUndo/canRedo need a nudge of their own to reach React.
  const [, forceHistory] = useState(0)

  const replace = useCallback((mutate: (d: T) => T) => {
    setDesignState(prev => {
      past.current = [...past.current.slice(-HISTORY_LIMIT + 1), prev]
      future.current = []
      return { ...mutate(prev), revision: prev.revision + 1 }
    })
    forceHistory(n => n + 1)
  }, [])

  const setDesign = useCallback((d: T) => {
    past.current = []
    future.current = []
    setDesignState({ ...d, revision: 0 })
    forceHistory(n => n + 1)
  }, [])

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    setDesignState(cur => {
      future.current = [...future.current, cur]
      return { ...prev, revision: cur.revision + 1 }
    })
    forceHistory(n => n + 1)
  }, [])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    setDesignState(cur => {
      past.current = [...past.current, cur]
      return { ...next, revision: cur.revision + 1 }
    })
    forceHistory(n => n + 1)
  }, [])

  return {
    design,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    replace,
    setDesign,
    undo,
    redo,
  }
}
