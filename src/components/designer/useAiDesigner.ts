// The AI design turn.
//
// docs/ARCHITECTURE.md sets the rule this hook exists to enforce: the assistant
// proposes, it never mutates. A turn produces a pending proposal; applying it is
// a separate, explicit act that lands as exactly one undo step.
//
// The transcript is the document's, not this hook's. It is passed in and the
// turns an Apply adds are handed back for the page to write in that same undo
// step -- so opening a design restores its conversation, undo takes a turn back
// with the geometry it made, and there is no second copy to drift. Only the
// question still waiting on its answer lives here.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ShapeProgram } from '../../../lib/contracts/shapeProgram.ts'
import { validateShapeProgram, walkProgram } from '../../../lib/contracts/shapeProgram.ts'
import type { ChatTurn } from '../../model/document.ts'
import { newId } from '../../model/scene.ts'
import * as ai from '../../services/ai.ts'
import { errorMessage } from '../../services/errors.ts'

export interface Proposal {
  program: ShapeProgram
  /** The program the question was asked about; what the proposal merges into. */
  sent: ShapeProgram | null
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
  /** The saved transcript, plus the question awaiting an answer. */
  turns: readonly ChatTurn[]
  send: (prompt: string, current: ShapeProgram | null) => Promise<void>
  discard: () => void
  /** Clears the proposal and returns the turns to append to the document. */
  accept: () => ChatTurn[]
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
      // An import cannot be written back by the model, so its absence from the
      // answer is not a removal; mergeProposal keeps it.
      if (!seen.has(node.id) && node.op !== 'mesh') removed.push(node.name)
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

/** The server refuses a document with more turns than this. */
const MAX_CHAT_TURNS = 500

/** Appends to a document's transcript, dropping the oldest turns past the cap. */
export const appendChat = (
  chat: readonly ChatTurn[] | undefined, added: readonly ChatTurn[],
): ChatTurn[] => [...(chat ?? []), ...added].slice(-MAX_CHAT_TURNS)

export function useAiDesigner(
  context: 'playground' | 'bambu',
  transcript: readonly ChatTurn[] | undefined,
): AiDesigner {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [asked, setAsked] = useState<ChatTurn | null>(null)
  const saved = useMemo(() => transcript ?? [], [transcript])
  const turns = useMemo(() => (asked ? [...saved, asked] : saved), [saved, asked])

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
    setAsked({ id: newId(), role: 'user', text: prompt, at: new Date().toISOString() })
    try {
      const response = await ai.requestShape({
        prompt,
        program: current,
        context,
        history: saved.map(t => ({ role: t.role, text: t.text })),
      })
      // Validated again here: the server checked it, but the browser is what
      // hands it to the kernel, and this is the last point before that.
      const program = validateShapeProgram(response.program)
      setProposal({
        program, sent: current, notes: response.notes, diff: diffPrograms(current, program),
      })
    } catch (cause) {
      setError(errorMessage(cause))
      setAsked(null)
    } finally {
      setBusy(false)
    }
  }, [context, saved])

  // A discarded answer takes its question with it: the transcript records what
  // shaped the design, and a stray question would be sent as history next turn.
  const discard = useCallback(() => {
    setProposal(null)
    setAsked(null)
  }, [])

  // Pure over state, with no updater doing the work: an append inside a
  // setState updater runs twice under StrictMode, which once double-posted the
  // assistant's reply.
  const accept = useCallback((): ChatTurn[] => {
    if (!proposal) return []
    const added: ChatTurn[] = [
      ...(asked ? [asked] : []),
      {
        id: newId(),
        role: 'assistant',
        text: proposal.notes,
        at: new Date().toISOString(),
        summary: summarise(proposal.diff),
      },
    ]
    setProposal(null)
    setAsked(null)
    return added
  }, [proposal, asked])

  return { available, busy, error, proposal, turns, send, discard, accept, setError }
}
