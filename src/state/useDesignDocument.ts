// Document state for the designer sub-apps. Generalised from
// src/features/keycap-tray/state/useTrayDesign.ts, whose history model is the
// one this app has already shipped; the conventions below are load-bearing and
// deliberately unchanged.
import { useCallback, useMemo, useRef, useState } from 'react'
import type {
  DesignDocument, DocumentKind, MachineProfile, SceneObject,
} from '../model/document.ts'
import {
  cloneObject, emptyDocument, findObject, groupObjects as groupInTree,
  removeObjects as removeInTree, translateObjects, ungroupObject as ungroupInTree,
  updateObjects,
} from '../model/scene.ts'

const HISTORY_LIMIT = 50

export interface DesignDocumentApi {
  doc: DesignDocument
  selection: Set<string>
  canUndo: boolean
  canRedo: boolean
  /** Load: clears history and selection, resets `revision` to 0. */
  setDoc: (d: DesignDocument) => void
  /** The only mutation choke point. Everything below is a wrapper over it. */
  replace: (mutate: (d: DesignDocument) => DesignDocument) => void
  addObject: (object: SceneObject) => string
  addObjects: (objects: SceneObject[]) => string[]
  updateObject: (id: string, patch: Partial<SceneObject>) => void
  moveObjects: (ids: Iterable<string>, dx: number, dy: number, dz?: number) => void
  removeObjects: (ids: Iterable<string>) => void
  duplicateObjects: (ids: Iterable<string>) => string[]
  groupObjects: (ids: Iterable<string>) => void
  ungroupObject: (id: string) => void
  setMachine: (machine: MachineProfile) => void
  rename: (name: string) => void
  setSelection: (ids: Iterable<string>) => void
  toggleSelection: (id: string, additive: boolean) => void
  clearSelection: () => void
  undo: () => void
  redo: () => void
}

export function useDesignDocument(kind: DocumentKind, initial?: DesignDocument): DesignDocumentApi {
  const [doc, setDocState] = useState<DesignDocument>(() => initial ?? emptyDocument(kind))
  const [selection, setSelectionState] = useState<Set<string>>(new Set())
  const past = useRef<DesignDocument[]>([])
  const future = useRef<DesignDocument[]>([])
  const [, forceHistory] = useState(0)

  // Every mutation goes through here so history and the revision counter stay
  // in step. `revision` is what geometry useMemos key on -- deep-comparing the
  // object tree on every render would cost more than the counter it replaces.
  const replace = useCallback((mutate: (d: DesignDocument) => DesignDocument) => {
    setDocState(prev => {
      past.current = [...past.current.slice(-HISTORY_LIMIT + 1), prev]
      future.current = []
      const next = mutate(prev)
      return { ...next, revision: prev.revision + 1 }
    })
    forceHistory(n => n + 1)
  }, [])

  const setDoc = useCallback((d: DesignDocument) => {
    past.current = []
    future.current = []
    setSelectionState(new Set())
    setDocState({ ...d, revision: 0 })
    forceHistory(n => n + 1)
  }, [])

  const addObjects = useCallback((objects: SceneObject[]) => {
    if (!objects.length) return []
    replace(d => ({ ...d, objects: [...d.objects, ...objects] }))
    const ids = objects.map(o => o.id)
    setSelectionState(new Set(ids))
    return ids
  }, [replace])

  const addObject = useCallback((object: SceneObject) => addObjects([object])[0], [addObjects])

  const updateObject = useCallback((id: string, patch: Partial<SceneObject>) => {
    const ids = new Set([id])
    // The cast is the price of patching a discriminated union by id; `patch`
    // never carries `type`, so the variant cannot change underneath us.
    replace(d => ({
      ...d,
      objects: updateObjects(d.objects, ids, o => ({ ...o, ...patch } as SceneObject)),
    }))
  }, [replace])

  const moveObjects = useCallback((ids: Iterable<string>, dx: number, dy: number, dz = 0) => {
    const set = new Set(ids)
    if (!set.size || (dx === 0 && dy === 0 && dz === 0)) return
    replace(d => ({ ...d, objects: translateObjects(d.objects, set, dx, dy, dz) }))
  }, [replace])

  const removeObjects = useCallback((ids: Iterable<string>) => {
    const set = new Set(ids)
    if (!set.size) return
    replace(d => ({ ...d, objects: removeInTree(d.objects, set) }))
    setSelectionState(new Set())
  }, [replace])

  const duplicateObjects = useCallback((ids: Iterable<string>) => {
    const set = new Set(ids)
    if (!set.size) return []
    const copies: SceneObject[] = []
    replace(d => {
      for (const id of set) {
        const found = findObject(d.objects, id)
        // Offset by a nudge so the copy is visibly not the original.
        if (found) copies.push(cloneObject(found, 5))
      }
      return { ...d, objects: [...d.objects, ...copies] }
    })
    const newIds = copies.map(o => o.id)
    setSelectionState(new Set(newIds))
    return newIds
  }, [replace])

  const groupObjects = useCallback((ids: Iterable<string>) => {
    const set = new Set(ids)
    if (set.size < 2) return
    let groupId: string | null = null
    replace(d => {
      const result = groupInTree(d.objects, set)
      groupId = result.groupId
      return { ...d, objects: result.objects }
    })
    setSelectionState(groupId ? new Set([groupId]) : new Set())
  }, [replace])

  const ungroupObject = useCallback((id: string) => {
    let childIds: string[] = []
    replace(d => {
      const result = ungroupInTree(d.objects, id)
      childIds = result.childIds
      return { ...d, objects: result.objects }
    })
    setSelectionState(new Set(childIds))
  }, [replace])

  const setMachine = useCallback(
    (machine: MachineProfile) => replace(d => ({ ...d, machine })), [replace])

  const rename = useCallback((name: string) => replace(d => ({ ...d, name })), [replace])

  const setSelection = useCallback((ids: Iterable<string>) => setSelectionState(new Set(ids)), [])
  const clearSelection = useCallback(() => setSelectionState(new Set()), [])

  const toggleSelection = useCallback((id: string, additive: boolean) => {
    setSelectionState(prev => {
      if (!additive) return new Set([id])
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Undo and redo *increment* revision rather than restoring the old value, so
  // the memo key stays monotonic and an undone edit still reads as unsaved.
  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    setDocState(cur => {
      future.current = [...future.current, cur]
      return { ...prev, revision: cur.revision + 1 }
    })
    forceHistory(n => n + 1)
  }, [])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    setDocState(cur => {
      past.current = [...past.current, cur]
      return { ...next, revision: cur.revision + 1 }
    })
    forceHistory(n => n + 1)
  }, [])

  return useMemo(() => ({
    doc, selection,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    setDoc, replace, addObject, addObjects, updateObject, moveObjects, removeObjects,
    duplicateObjects, groupObjects, ungroupObject, setMachine, rename,
    setSelection, toggleSelection, clearSelection, undo, redo,
  }), [doc, selection, setDoc, replace, addObject, addObjects, updateObject, moveObjects,
       removeObjects, duplicateObjects, groupObjects, ungroupObject, setMachine, rename,
       setSelection, toggleSelection, clearSelection, undo, redo])
}
