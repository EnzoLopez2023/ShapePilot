// Save, load, clone and delete for a design document, plus dirty tracking.
//
// Lifted from KeycapTrayPage, whose handling of the two races here is already
// correct and worth keeping identical: a superseded load must not overwrite a
// newer one, and a save must report honestly when edits landed while it was in
// flight.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { DesignDocument, DocumentKind } from '../../model/document.ts'
import { emptyDocument } from '../../model/scene.ts'
import type { DocumentSummary } from '../../services/designDocuments.ts'
import * as api from '../../services/designDocuments.ts'
import { errorMessage } from '../../services/errors.ts'

export interface DocumentLifecycle {
  documents: DocumentSummary[]
  listLoading: boolean
  busy: boolean
  savedId: string | null
  hasUnsavedChanges: boolean
  toast: string | null
  error: string | null
  setToast: (message: string | null) => void
  setError: (message: string | null) => void
  refresh: () => Promise<void>
  create: () => void
  open: (id: string) => Promise<void>
  save: () => Promise<void>
  saveAs: (name: string) => Promise<void>
  remove: (id: string) => Promise<void>
  /** Copy under another kind and return the new id, for the designer handoff. */
  handOff: (kind: DocumentKind, name?: string) => Promise<string | null>
}

export interface LifecycleOptions {
  kind: DocumentKind
  doc: DesignDocument
  setDoc: (doc: DesignDocument) => void
}

export function useDocumentLifecycle(options: LifecycleOptions): DocumentLifecycle {
  const { kind, doc, setDoc } = options

  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [savedRevision, setSavedRevision] = useState<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Guards a load being overtaken by a newer one.
  const loadGeneration = useRef(0)
  // Lets a completed save compare against what the document is *now*.
  const revisionRef = useRef(doc.revision)
  revisionRef.current = doc.revision

  const hasUnsavedChanges = savedId !== null && savedRevision !== doc.revision

  // A handoff from another designer arrives as ?open=<id>. The parameter is
  // cleared as soon as it is consumed so a refresh or a Back does not reopen
  // the document over whatever the user has since done.
  const [params, setParams] = useSearchParams()
  const handledOpenParam = useRef(false)

  const refresh = useCallback(async () => {
    setListLoading(true)
    try {
      setDocuments(await api.listDocuments())
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])


  const create = useCallback(() => {
    loadGeneration.current += 1
    setDoc(emptyDocument(kind))
    setSavedId(null)
    setSavedRevision(null)
  }, [kind, setDoc])

  const openDocument = useCallback(async (id: string) => {
    const generation = ++loadGeneration.current
    setBusy(true)
    try {
      const loaded = await api.getDocument(id)
      // A slower earlier load must not clobber a newer one.
      if (generation !== loadGeneration.current) return
      setDoc(loaded)
      setSavedId(id)
      setSavedRevision(0)
      setToast(`Opened ${loaded.name}`)
    } catch (cause) {
      if (generation === loadGeneration.current) setError(errorMessage(cause))
    } finally {
      if (generation === loadGeneration.current) setBusy(false)
    }
  }, [setDoc])

  useEffect(() => {
    const requested = params.get('open')
    if (!requested || handledOpenParam.current) return
    handledOpenParam.current = true
    setParams(next => {
      next.delete('open')
      return next
    }, { replace: true })
    void openDocument(requested)
  }, [params, setParams, openDocument])

  const save = useCallback(async () => {
    setBusy(true)
    const submitted = doc.revision
    try {
      if (savedId) {
        await api.updateDocument(savedId, doc)
      } else {
        const created = await api.createDocument(doc)
        setSavedId(created.id)
      }
      setSavedRevision(submitted)
      // Edits made while the request was in flight are genuinely still unsaved,
      // and saying so is better than a "Saved" that is quietly untrue.
      setToast(revisionRef.current === submitted
        ? 'Saved'
        : 'Saved earlier changes — newer edits are still unsaved')
      await refresh()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }, [doc, savedId, refresh])

  const saveAs = useCallback(async (name: string) => {
    setBusy(true)
    const submitted = doc.revision
    try {
      const created = await api.createDocument({ ...doc, name })
      setSavedId(created.id)
      setSavedRevision(submitted)
      setDoc({ ...doc, name, revision: submitted })
      setToast(`Saved as ${name}`)
      await refresh()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }, [doc, setDoc, refresh])

  const remove = useCallback(async (id: string) => {
    setBusy(true)
    try {
      await api.deleteDocument(id)
      if (id === savedId) {
        setSavedId(null)
        setSavedRevision(null)
      }
      setToast('Deleted')
      await refresh()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }, [savedId, refresh])

  const handOff = useCallback(async (target: DocumentKind, name?: string) => {
    setBusy(true)
    try {
      // Only a saved document can be cloned server-side, so an unsaved one is
      // written first rather than silently losing the current edits.
      let id = savedId
      if (!id || hasUnsavedChanges) {
        if (id) await api.updateDocument(id, doc)
        else id = (await api.createDocument(doc)).id
        setSavedId(id)
        setSavedRevision(doc.revision)
      }
      const created = await api.cloneDocument(id, name ?? `${doc.name} (${target})`, target)
      await refresh()
      return created.id
    } catch (cause) {
      setError(errorMessage(cause))
      return null
    } finally {
      setBusy(false)
    }
  }, [savedId, hasUnsavedChanges, doc, refresh])

  return {
    documents, listLoading, busy, savedId, hasUnsavedChanges, toast, error,
    setToast, setError, refresh, create, open: openDocument, save, saveAs, remove, handOff,
  }
}
