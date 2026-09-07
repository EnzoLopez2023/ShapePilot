import { useCallback, useRef, useState } from 'react'
import { emptyDesign } from '../model/defaults.ts'
import type {
  FeetSettings, FillSettings, Nameplate, PlateSettings, SwitchProfile, SwitchTrayDesign,
  TrayProfile,
} from '../model/types.ts'
import { cellKey } from '../geometry/fill.ts'

const HISTORY_LIMIT = 50

export interface SwitchTrayDesignApi {
  design: SwitchTrayDesign
  canUndo: boolean
  canRedo: boolean
  setDesign: (d: SwitchTrayDesign) => void
  replace: (mutate: (d: SwitchTrayDesign) => SwitchTrayDesign) => void
  setProfile: (p: TrayProfile) => void
  setSwitch: (patch: Partial<SwitchProfile>) => void
  setPlate: (patch: Partial<PlateSettings>) => void
  setFill: (patch: Partial<FillSettings>) => void
  setFeet: (feet: FeetSettings | undefined) => void
  setNameplate: (nameplate: Nameplate | undefined) => void
  toggleCell: (col: number, row: number) => void
  clearSkipped: () => void
  undo: () => void
  redo: () => void
}

export function useSwitchTrayDesign(initial?: SwitchTrayDesign): SwitchTrayDesignApi {
  const [design, setDesignState] = useState<SwitchTrayDesign>(() => initial ?? emptyDesign())
  const past = useRef<SwitchTrayDesign[]>([])
  const future = useRef<SwitchTrayDesign[]>([])
  const [, forceHistory] = useState(0)

  // Every mutation goes through here so history and the revision counter stay
  // in step. `revision` is what the fill and mesh useMemos key on.
  const replace = useCallback((mutate: (d: SwitchTrayDesign) => SwitchTrayDesign) => {
    setDesignState(prev => {
      past.current = [...past.current.slice(-HISTORY_LIMIT + 1), prev]
      future.current = []
      return { ...mutate(prev), revision: prev.revision + 1 }
    })
    forceHistory(n => n + 1)
  }, [])

  /** Opening a different tray is not an edit -- it starts a new history. */
  const setDesign = useCallback((d: SwitchTrayDesign) => {
    past.current = []
    future.current = []
    setDesignState({ ...d, revision: 0 })
    forceHistory(n => n + 1)
  }, [])

  const setProfile = useCallback((profile: TrayProfile) => {
    // The outline decides which cells exist, so the old skips no longer name
    // anything the user chose. Dropping them beats silently moving them.
    replace(d => ({ ...d, profile, skippedCells: undefined }))
  }, [replace])

  const setSwitch = useCallback((patch: Partial<SwitchProfile>) => {
    replace(d => ({ ...d, switch: { ...d.switch, ...patch } }))
  }, [replace])

  const setPlate = useCallback((patch: Partial<PlateSettings>) => {
    replace(d => ({ ...d, plate: { ...d.plate, ...patch } }))
  }, [replace])

  const setFill = useCallback((patch: Partial<FillSettings>) => {
    // A different lattice renumbers the cells, so a skip made against the old
    // one would land somewhere the user never clicked.
    const relayout = ['pitchXMm', 'pitchYMm', 'marginMm', 'stagger', 'origin', 'spreadEvenly']
      .some(key => key in patch)
    replace(d => ({
      ...d,
      fill: { ...d.fill, ...patch },
      ...(relayout ? { skippedCells: undefined } : {}),
    }))
  }, [replace])

  const setFeet = useCallback((feet: FeetSettings | undefined) => {
    replace(d => ({ ...d, feet }))
  }, [replace])

  const setNameplate = useCallback((nameplate: Nameplate | undefined) => {
    replace(d => ({ ...d, nameplate }))
  }, [replace])

  const toggleCell = useCallback((col: number, row: number) => {
    const key = cellKey(col, row)
    replace(d => {
      const current = d.skippedCells ?? []
      const next = current.includes(key)
        ? current.filter(k => k !== key)
        : [...current, key]
      return { ...d, skippedCells: next.length ? next : undefined }
    })
  }, [replace])

  const clearSkipped = useCallback(() => {
    replace(d => ({ ...d, skippedCells: undefined }))
  }, [replace])

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    setDesignState(current => {
      future.current = [...future.current, current]
      return prev
    })
    forceHistory(n => n + 1)
  }, [])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    setDesignState(current => {
      past.current = [...past.current, current]
      return next
    })
    forceHistory(n => n + 1)
  }, [])

  return {
    design,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    setDesign,
    replace,
    setProfile,
    setSwitch,
    setPlate,
    setFill,
    setFeet,
    setNameplate,
    toggleCell,
    clearSkipped,
    undo,
    redo,
  }
}
