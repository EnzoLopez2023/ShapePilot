import { useCallback, useMemo, useState } from 'react'
import { useDesignHistory } from '../../../state/useDesignHistory.ts'
import type { Pocket, TrayDesign, TrayProfile } from '../model/types.ts'
import type { PocketSizing } from '../geometry/shapes.ts'
import { pocketHeight, pocketRing, pocketWidth } from '../geometry/shapes.ts'
import type { BBox } from '../../../geometry/vec.ts'
import { ringBBox } from '../../../geometry/vec.ts'
import { emptyDesign } from '../model/presets.ts'

export interface TrayDesignApi {
  design: TrayDesign
  selection: Set<string>
  canUndo: boolean
  canRedo: boolean
  setDesign: (d: TrayDesign) => void
  replace: (mutate: (d: TrayDesign) => TrayDesign) => void
  addPocket: (units: number, x: number, y: number, extra?: Partial<Pocket>) => string
  movePockets: (ids: Iterable<string>, dx: number, dy: number) => void
  updatePocket: (id: string, patch: Partial<Pocket>) => void
  removePockets: (ids: Iterable<string>) => void
  setProfile: (p: TrayProfile) => void
  setSizing: (s: PocketSizing) => void
  setSelection: (ids: Iterable<string>) => void
  toggleSelection: (id: string, additive: boolean) => void
  undo: () => void
  redo: () => void
}

export function useTrayDesign(initial?: TrayDesign): TrayDesignApi {
  // History, the revision counter and undo/redo are shared with the other
  // designers. `revision` is what the mesh useMemo keys on -- deep-comparing an
  // 80-pocket array on every render would cost more than the counter it replaces.
  const history = useDesignHistory<TrayDesign>(() => initial ?? emptyDesign())
  const { design, canUndo, canRedo, replace, undo, redo } = history
  const [selection, setSelectionState] = useState<Set<string>>(new Set())

  /** Opening a different tray also drops the selection -- those ids are gone. */
  const setDesign = useCallback((d: TrayDesign) => {
    setSelectionState(new Set())
    history.setDesign(d)
  }, [history])

  const addPocket = useCallback((units: number, x: number, y: number, extra: Partial<Pocket> = {}) => {
    const id = crypto.randomUUID()
    replace(d => ({
      ...d,
      pockets: [...d.pockets, { id, units, x, y, label: `${units}u`, ...extra }],
    }))
    setSelectionState(new Set([id]))
    return id
  }, [replace])

  const movePockets = useCallback((ids: Iterable<string>, dx: number, dy: number) => {
    const set = new Set(ids)
    replace(d => ({
      ...d,
      pockets: d.pockets.map(p => (set.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p)),
    }))
  }, [replace])

  const updatePocket = useCallback((id: string, patch: Partial<Pocket>) => {
    replace(d => ({ ...d, pockets: d.pockets.map(p => (p.id === id ? { ...p, ...patch } : p)) }))
  }, [replace])

  const removePockets = useCallback((ids: Iterable<string>) => {
    const set = new Set(ids)
    replace(d => ({ ...d, pockets: d.pockets.filter(p => !set.has(p.id)) }))
    setSelectionState(new Set())
  }, [replace])

  const setProfile = useCallback((profile: TrayProfile) => replace(d => ({ ...d, profile })), [replace])
  const setSizing = useCallback((sizing: PocketSizing) => replace(d => ({ ...d, sizing })), [replace])

  const setSelection = useCallback((ids: Iterable<string>) => setSelectionState(new Set(ids)), [])

  const toggleSelection = useCallback((id: string, additive: boolean) => {
    setSelectionState(prev => {
      if (!additive) return new Set([id])
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return useMemo(() => ({
    design, selection,
    canUndo,
    canRedo,
    setDesign, replace, addPocket, movePockets, updatePocket, removePockets,
    setProfile, setSizing, setSelection, toggleSelection, undo, redo,
  }), [design, selection, canUndo, canRedo, setDesign, replace, addPocket, movePockets,
       updatePocket, removePockets, setProfile, setSizing, setSelection, toggleSelection,
       undo, redo])
}

/**
 * The pocket's UN-rotated footprint -- also its rotation-pivot box. Its centre
 * `(p.x + w/2, p.y + h/2)` is invariant under rotate/mirror/flip, which is what
 * the label anchor, alignment-guide targets, drag snap and drop centring want.
 * For true on-screen bounds of a rotated pocket use `pocketAABB`.
 */
export const pocketExtent = (p: Pocket, s: PocketSizing): { w: number; h: number } => {
  if (p.shape === 'iso-enter') {
    return { w: p.widthMm ?? pocketWidth(1.5, s), h: 2 * (p.heightMm ?? pocketHeight(1, s)) }
  }
  return {
    w: p.widthMm ?? pocketWidth(p.units, s),
    h: p.heightMm ?? pocketHeight(p.heightUnits ?? 1, s),
  }
}

/** Exact axis-aligned bounds of the pocket as drawn (rotation, mirror, radius). */
export const pocketAABB = (p: Pocket, s: PocketSizing): BBox => ringBBox(pocketRing(p, s)[0])
