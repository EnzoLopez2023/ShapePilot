// The tool tray's design state: history from the shared hook, plus the pocket
// operations that are actually about a tool tray.
//
// Closer to the keycap tray than the switch tray, because pockets are PLACED
// rather than generated -- so there is a selection, and moving something is a
// real edit rather than a parameter change.
import { useCallback, useMemo, useState } from 'react'
import { useDesignHistory } from '../../../state/useDesignHistory.ts'
import type { TrayProfile } from '../../../model/trayProfile.ts'
import { emptyDesign } from '../model/defaults.ts'
import { freeSpotFor } from '../geometry/place.ts'
import type { TracedFootprint } from '../geometry/trace.ts'
import { DEFAULT_FINGER_ACCESS, fingerAccessFrom } from '../model/fingerAccess.ts'
import type { PartPreset } from '../model/partPresets.ts'
import type {
  FingerAccess, PocketStep, ToolPocket, ToolTrayDesign, TrayFeet, UndersideReliefMode,
} from '../model/types.ts'
import { deepestStepMm } from '../geometry/shapes.ts'

export interface ToolTrayDesignApi {
  design: ToolTrayDesign
  selection: Set<string>
  canUndo: boolean
  canRedo: boolean
  setDesign: (d: ToolTrayDesign) => void
  replace: (mutate: (d: ToolTrayDesign) => ToolTrayDesign) => void
  /**
   * Drop a preset into the first free spot, copying its steps. Returns the id.
   *
   * The spot is chosen INSIDE the mutator, against the design as it is when the
   * update applies -- so several drops in one React batch do not all land on
   * the same place.
   */
  addFromPreset: (preset: PartPreset) => string
  /**
   * Drop a traced outline in as a pocket of its own, at one depth.
   *
   * Placed by the same search as a preset: a trace is a box with steps as far
   * as the packer is concerned, and it gets the same finger access a bay of
   * that size would, because a pocket cut to a part's own outline is the one
   * that most needs a way back out.
   */
  addTraced: (traced: TracedFootprint, name: string, depthMm: number) => string
  addPocket: (pocket: Omit<ToolPocket, 'id'>) => string
  movePockets: (ids: Iterable<string>, dx: number, dy: number) => void
  updatePocket: (id: string, patch: Partial<ToolPocket>) => void
  removePockets: (ids: Iterable<string>) => void
  /**
   * Edit one step of a pocket. The tiers are what make a hotend bay one pocket
   * rather than three, and a lead-in or a cradle is the same thing: a wider,
   * shallower step over a narrower, deeper one.
   */
  updateStep: (pocketId: string, index: number, patch: Partial<PocketStep>) => void
  /** A new step inset from the pocket box, shallower than the deepest. */
  addStep: (pocketId: string) => void
  removeStep: (pocketId: string, index: number) => void
  setFingerAccess: (pocketId: string, access: FingerAccess | undefined) => void
  setProfile: (p: TrayProfile) => void
  setHeight: (mm: number) => void
  setLayerHeight: (mm: number) => void
  setMinFloor: (mm: number) => void
  setFeet: (feet: TrayFeet | undefined) => void
  setUndersideReliefs: (mode: UndersideReliefMode) => void
  setCaseClearHeight: (mm: number | undefined) => void
  setSelection: (ids: Iterable<string>) => void
  toggleSelection: (id: string, additive: boolean) => void
  undo: () => void
  redo: () => void
}

const newId = (): string => crypto.randomUUID()

export function useToolTrayDesign(initial?: ToolTrayDesign): ToolTrayDesignApi {
  const history = useDesignHistory<ToolTrayDesign>(() => initial ?? emptyDesign())
  const { design, canUndo, canRedo, replace, undo, redo } = history
  const [selection, setSelectionState] = useState<Set<string>>(new Set())

  /** Opening a different tray also drops the selection -- those ids are gone. */
  const setDesign = useCallback((d: ToolTrayDesign) => {
    setSelectionState(new Set())
    history.setDesign(d)
  }, [history])

  const addTraced = useCallback((
    traced: TracedFootprint, name: string, depthMm: number,
  ) => {
    const id = newId()
    replace(d => {
      const steps: PocketStep[] = [{
        shape: { kind: 'outline', rings: traced.rings, sourceName: name },
        depthMm,
      }]
      const side = traced.widthMm >= traced.heightMm ? 'bottom' : 'left'
      const along = side === 'bottom' ? traced.widthMm : traced.heightMm
      // The library scoop, unless the part is too small to take one -- in which
      // case the widest that fits the side it sits on.
      const scoop = fingerAccessFrom(DEFAULT_FINGER_ACCESS, side)
      const fingerAccess = along >= scoop.widthMm
        ? scoop
        : { ...scoop, widthMm: Math.max(4, along * 0.6) }
      const shape = { widthMm: traced.widthMm, heightMm: traced.heightMm, steps, fingerAccess }
      const { x, y } = freeSpotFor(d, shape)
      return {
        ...d,
        pockets: [...d.pockets, {
          id,
          kind: 'outline' as const,
          label: name,
          x, y,
          widthMm: traced.widthMm,
          heightMm: traced.heightMm,
          steps,
          fingerAccess,
        }],
      }
    })
    setSelectionState(new Set([id]))
    return id
  }, [replace])

  const addPocket = useCallback((pocket: Omit<ToolPocket, 'id'>) => {
    const id = newId()
    replace(d => ({ ...d, pockets: [...d.pockets, { ...pocket, id }] }))
    setSelectionState(new Set([id]))
    return id
  }, [replace])

  const addFromPreset = useCallback((preset: PartPreset) => {
    const id = newId()
    replace(d => {
      const { x, y } = freeSpotFor(d, preset)
      return {
        ...d,
        pockets: [...d.pockets, {
          id,
          kind: preset.kind,
          label: preset.label,
          presetId: preset.id,
          x, y,
          widthMm: preset.widthMm,
          heightMm: preset.heightMm,
          // COPIED, not referenced: a tray keeps printing the same after a
          // catalogue edit, and `presetId` rides along as provenance only.
          steps: preset.steps.map(s => ({ ...s })),
          ...(preset.fingerAccess ? { fingerAccess: { ...preset.fingerAccess } } : {}),
        }],
      }
    })
    setSelectionState(new Set([id]))
    return id
  }, [replace])

  const movePockets = useCallback((ids: Iterable<string>, dx: number, dy: number) => {
    const moving = new Set(ids)
    if (!moving.size || (!dx && !dy)) return
    replace(d => ({
      ...d,
      pockets: d.pockets.map(p => (moving.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p)),
    }))
  }, [replace])

  const updatePocket = useCallback((id: string, patch: Partial<ToolPocket>) => {
    replace(d => ({
      ...d,
      pockets: d.pockets.map(p => (p.id === id ? { ...p, ...patch } : p)),
    }))
  }, [replace])

  const updateStep = useCallback((
    pocketId: string, index: number, patch: Partial<PocketStep>,
  ) => {
    replace(d => ({
      ...d,
      pockets: d.pockets.map(p => (p.id === pocketId
        ? { ...p, steps: p.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) }
        : p)),
    }))
  }, [replace])

  const addStep = useCallback((pocketId: string) => {
    replace(d => ({
      ...d,
      pockets: d.pockets.map(p => {
        if (p.id !== pocketId) return p
        // Seeded as a lead-in: the pocket's own box inset a little, at half the
        // depth of its deepest step. That is the shape people actually want
        // next -- a mouth a part drops into -- and it is immediately editable.
        const deepest = deepestStepMm(p) ?? d.heightMm
        const inset = Math.min(3, p.widthMm / 4, p.heightMm / 4)
        const step: PocketStep = {
          shape: {
            kind: 'rect',
            widthMm: Math.max(0.1, p.widthMm - inset * 2),
            heightMm: Math.max(0.1, p.heightMm - inset * 2),
            cornerRadiusMm: 1,
          },
          offset: [inset, inset],
          depthMm: Math.max(d.layerHeightMm, Math.round((deepest / 2) / d.layerHeightMm)
            * d.layerHeightMm),
        }
        return { ...p, steps: [...p.steps, step] }
      }),
    }))
  }, [replace])

  const removeStep = useCallback((pocketId: string, index: number) => {
    replace(d => ({
      ...d,
      pockets: d.pockets.map(p => {
        if (p.id !== pocketId) return p
        // A pocket with no steps removes nothing and cannot be selected back
        // out of the canvas, so the last one stays.
        if (p.steps.length <= 1) return p
        return { ...p, steps: p.steps.filter((_, i) => i !== index) }
      }),
    }))
  }, [replace])

  const setFingerAccess = useCallback((pocketId: string, access: FingerAccess | undefined) => {
    replace(d => ({
      ...d,
      pockets: d.pockets.map(p => (p.id === pocketId ? { ...p, fingerAccess: access } : p)),
    }))
  }, [replace])

  const removePockets = useCallback((ids: Iterable<string>) => {
    const going = new Set(ids)
    if (!going.size) return
    replace(d => ({ ...d, pockets: d.pockets.filter(p => !going.has(p.id)) }))
    setSelectionState(prev => new Set([...prev].filter(id => !going.has(id))))
  }, [replace])

  const setProfile = useCallback((profile: TrayProfile) => {
    // Unlike the switch tray, a new outline does NOT invalidate the pockets --
    // they are placed, not generated, so they stay where the user put them. The
    // validator says which ones no longer fit rather than silently moving them.
    replace(d => ({ ...d, profile }))
  }, [replace])

  const setHeight = useCallback((heightMm: number) => {
    replace(d => ({ ...d, heightMm }))
  }, [replace])

  const setLayerHeight = useCallback((layerHeightMm: number) => {
    replace(d => ({ ...d, layerHeightMm }))
  }, [replace])

  const setMinFloor = useCallback((minFloorMm: number) => {
    replace(d => ({ ...d, minFloorMm }))
  }, [replace])

  const setFeet = useCallback((feet: TrayFeet | undefined) => {
    replace(d => ({ ...d, feet }))
  }, [replace])

  const setUndersideReliefs = useCallback((undersideReliefs: UndersideReliefMode) => {
    replace(d => ({ ...d, undersideReliefs }))
  }, [replace])

  const setCaseClearHeight = useCallback((caseClearHeightMm: number | undefined) => {
    replace(d => ({ ...d, caseClearHeightMm }))
  }, [replace])

  const setSelection = useCallback((ids: Iterable<string>) => {
    setSelectionState(new Set(ids))
  }, [])

  const toggleSelection = useCallback((id: string, additive: boolean) => {
    setSelectionState(prev => {
      if (!additive) return prev.has(id) && prev.size === 1 ? new Set() : new Set([id])
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return useMemo(() => ({
    design, selection, canUndo, canRedo,
    setDesign, replace, addFromPreset, addTraced, addPocket, movePockets, updatePocket,
    removePockets,
    updateStep, addStep, removeStep, setFingerAccess,
    setProfile, setHeight, setLayerHeight, setMinFloor, setFeet, setUndersideReliefs,
    setCaseClearHeight, setSelection, toggleSelection, undo, redo,
  }), [design, selection, canUndo, canRedo, setDesign, replace, addFromPreset, addTraced,
    addPocket,
    movePockets, updatePocket, removePockets, updateStep, addStep, removeStep, setFingerAccess,
    setProfile, setHeight, setLayerHeight,
    setMinFloor, setFeet, setUndersideReliefs, setCaseClearHeight, setSelection,
    toggleSelection, undo, redo])
}
