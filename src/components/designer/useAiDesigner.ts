// The AI design turn.
//
// docs/ARCHITECTURE.md sets the rule this hook exists to enforce: the assistant
// proposes, it never mutates. A turn produces a pending proposal; applying it is
// a separate, explicit act that lands as exactly one undo step.
import { useCallback, useEffect, useState } from 'react'
import type { ShapeProgram } from '../../../lib/contracts/shapeProgram.ts'
import { validateShapeProgram, walkProgram } from '../../../lib/contracts/shapeProgram.ts'
import type { ChatTurn } from '../../model/document.ts'
import { newId } from '../../model/scene.ts'
import * as ai from '../../services/ai.ts'
import { errorMessage } from '../../services/errors.ts'

export interface Proposal {
  program: ShapeProgram
  notes: string
  /** What changed against the program that was sent, for review before applying. */
  diff: ProgramDiff
}

export interface ProgramDiff {
  added: string[]
  removed: string[]
  modified: string[]
}

export interface AiDesigner {
  available: boolean | null
  busy: boolean
  error: string | null
  proposal: Proposal | null
  turns: ChatTurn[]
  send: (prompt: string, current: ShapeProgram | null) => Promise<void>
  discard: () => void
  /** Records the applied turn in the transcript and clears the proposal. */
  accept: () => void
  setTurns: (turns: ChatTurn[]) => void
  setError: (message: string | null) => void
}

/** Compared by id and by serialised body, so "modified" means the geometry
 *  actually changed rather than the model having re-emitted it. */
export function diffPrograms(before: ShapeProgram | null, after: ShapeProgram): ProgramDiff {
  const previous = new Map<string, string>()
  if (before) {
    for (const node of walkProgram(before.parts)) previous.set(node.id, JSON.stringify(node))
  }
  const added: string[] = []
  const modified: string[] = []
  const seen = new Set<string>()

  for (const node of walkProgram(after.parts)) {
    seen.add(node.id)
    const was = previous.get(node.id)
    if (was === undefined) added.push(node.name)
    else if (was !== JSON.stringify(node)) modified.push(node.name)
  }

  const removed: string[] = []
  if (before) {
    for (const node of walkProgram(before.parts)) {
      if (!seen.has(node.id)) removed.push(node.name)
    }
  }
  return { added, removed, modified }
}

export function summarise(diff: ProgramDiff): string {
  const parts: string[] = []
  if (diff.added.length) parts.push(`added ${diff.added.join(', ')}`)
  if (diff.modified.length) parts.push(`changed ${diff.modified.join(', ')}`)
  if (diff.removed.length) parts.push(`removed ${diff.removed.join(', ')}`)
  return parts.length ? parts.join('; ') : 'no change'
}

export function useAiDesigner(context: 'playground' | 'bambu'): AiDesigner {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [turns, setTurns] = useState<ChatTurn[]>([])

  useEffect(() => {
    let cancelled = false
    void ai.aiStatus()
      .then(s => { if (!cancelled) setAvailable(s.available) })
      // A status probe that fails means the assistant is not usable, which is
      // the same outcome as it being switched off.
      .catch(() => { if (!cancelled) setAvailable(false) })
    return () => { cancelled = true }
  }, [])

  const send = useCallback(async (prompt: string, current: ShapeProgram | null) => {
    setBusy(true)
    setError(null)
    const asked: ChatTurn = {
      id: newId(), role: 'user', text: prompt, at: new Date().toISOString(),
    }
    setTurns(prev => [...prev, asked])
    try {
      const response = await ai.requestShape({
        prompt,
        program: current,
        context,
        history: turns.map(t => ({ role: t.role, text: t.text })),
      })
      // Validated again here: the server checked it, but the browser is what
      // hands it to the kernel, and this is the last point before that.
      const program = validateShapeProgram(response.program)
      setProposal({ program, notes: response.notes, diff: diffPrograms(current, program) })
    } catch (cause) {
      setError(errorMessage(cause))
      setTurns(prev => prev.filter(t => t.id !== asked.id))
    } finally {
      setBusy(false)
    }
  }, [context, turns])

  const discard = useCallback(() => setProposal(null), [])

  // Note the shape: the transcript is appended and the proposal cleared as two
  // ordinary calls. Doing the append inside a setProposal updater would run it
  // twice under StrictMode, which double-posted the assistant's reply.
  const accept = useCallback(() => {
    if (!proposal) return
    setTurns(prev => [...prev, {
      id: newId(),
      role: 'assistant',
      text: proposal.notes,
      at: new Date().toISOString(),
      summary: summarise(proposal.diff),
    }])
    setProposal(null)
  }, [proposal])

  return { available, busy, error, proposal, turns, send, discard, accept, setTurns, setError }
}
