// The photo-to-vector turn.
//
// The same contract as useAiDesigner: the assistant proposes, it never mutates.
// A trace produces a pending proposal; applying it (in PlaygroundPage) is a
// separate, explicit act that lands as one undo step.
import { useCallback, useEffect, useState } from 'react'
import type { VectorDrawing } from '../../../lib/contracts/vectorDrawing.ts'
import { validateVectorDrawing } from '../../../lib/contracts/vectorDrawing.ts'
import * as ai from '../../services/ai.ts'
import { errorMessage } from '../../services/errors.ts'

export interface VectorProposal {
  drawing: VectorDrawing
  notes: string
}

export interface VectorTrace {
  available: boolean | null
  busy: boolean
  error: string | null
  proposal: VectorProposal | null
  trace: (hashes: string[], hint?: string) => Promise<void>
  discard: () => void
  setError: (message: string | null) => void
}

export function useVectorTrace(): VectorTrace {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<VectorProposal | null>(null)

  useEffect(() => {
    let cancelled = false
    void ai.aiStatus()
      .then(s => { if (!cancelled) setAvailable(s.available) })
      .catch(() => { if (!cancelled) setAvailable(false) })
    return () => { cancelled = true }
  }, [])

  const trace = useCallback(async (hashes: string[], hint?: string) => {
    if (!hashes.length) return
    setBusy(true)
    setError(null)
    try {
      const response = await ai.traceVector(hashes, hint)
      // Validated again here: the server checked it, but the browser is what
      // turns it into scene objects, and this is the last point before that.
      const drawing = validateVectorDrawing(response.drawing)
      setProposal({ drawing, notes: response.notes })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }, [])

  const discard = useCallback(() => setProposal(null), [])

  return { available, busy, error, proposal, trace, discard, setError }
}
