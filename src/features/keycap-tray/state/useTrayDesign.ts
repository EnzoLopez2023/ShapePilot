import { useCallback, useMemo, useRef, useState } from 'react'
import type { Pocket, TrayDesign, TrayProfile } from '../model/types.ts'
import type { PocketSizing } from '../geometry/shapes.ts'
import { pocketHeight, pocketWidth } from '../geometry/shapes.ts'
import { emptyDesign } from '../model/presets.ts'

const HISTORY_LIMIT = 50

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
  const [design, setDesignState] = useState<TrayDesign>(() => initial ?? emptyDesign())
  const [selection, setSelectionState] = useState<Set<string>>(new Set())
  const past = useRef<TrayDesign[]>([])
  const future = useRef<TrayDesign[]>([])
  const [, forceHistory] = useState(0)

  // Every mutation goes through here so history and the revision counter stay in
  // step. `revision` is what the mesh useMemo keys on -- deep-comparing an
  // 80-pocket array on every render would cost more than the counter it replaces.
  const replace = useCallback((mutate: (d: TrayDesign) => TrayDesign) => {
    setDesignState(prev => {
      past.current = [...past.current.slice(-HISTORY_LIMIT + 1), prev]
      future.current = []
      const next = mutate(prev)
      return { ...next, revision: prev.revision + 1 }
    })
    forceHistory(n => n + 1)
  }, [])

  const setDesign = useCallback((d: TrayDesign) => {
    past.current = []
    future.current = []
    setSelectionState(new Set())
    setDesignState({ ...d, revision: 0 })
    forceHistory(n => n + 1)
  }, [])

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

  return useMemo(() => ({
    design, selection,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    setDesign, replace, addPocket, movePockets, updatePocket, removePockets,
    setProfile, setSizing, setSelection, toggleSelection, undo, redo,
  }), [design, selection, setDesign, replace, addPocket, movePockets, updatePocket,
       removePockets, setProfile, setSizing, setSelection, toggleSelection, undo, redo])
}

export const pocketExtent = (p: Pocket, s: PocketSizing): { w: number; h: number } => {
  if (p.shape === 'iso-enter') {
    return { w: p.widthMm ?? pocketWidth(1.5, s), h: 2 * (p.heightMm ?? pocketHeight(1, s)) }
  }
  let w = p.widthMm ?? pocketWidth(p.units, s)
  let h = p.heightMm ?? pocketHeight(p.heightUnits ?? 1, s)
  if (p.rotationDeg === 90) [w, h] = [h, w]
  return { w, h }
}
