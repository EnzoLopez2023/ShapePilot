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

/** One question and what came of it, for the document it was asked about. */
interface Exchange {
  documentId: string
  asked: ChatTurn | null
  proposal: Proposal | null
  busy: boolean
  error: string | null
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
  /** The open document. A different one abandons whatever was being asked. */
  documentId: string,
): AiDesigner {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [exchange, setExchange] = useState<Exchange | null>(null)

  // An answer belongs to the design it was asked about, so the exchange is
  // tagged with it and only surfaces while that design is open. Opening another
  // one, or starting fresh, leaves it behind -- otherwise Apply would merge a
  // proposal about one design into a different one.
  const current = exchange?.documentId === documentId ? exchange : null
  const busy = current?.busy ?? false
  const error = current?.error ?? null
  const proposal = current?.proposal ?? null
  const asked = current?.asked ?? null

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

  const send = useCallback(async (prompt: string, program: ShapeProgram | null) => {
    const question: ChatTurn = {
      id: newId(), role: 'user', text: prompt, at: new Date().toISOString(),
    }
    setExchange({ documentId, asked: question, proposal: null, busy: true, error: null })
    // Only the exchange this call started may be updated by it: a newer
    // question, or the design being switched, supersedes the reply.
    const settle = (patch: Partial<Exchange>) => setExchange(previous =>
      previous?.asked === question ? { ...previous, ...patch, busy: false } : previous)
    try {
      const response = await ai.requestShape({
        prompt,
        program,
        context,
        history: saved.map(t => ({ role: t.role, text: t.text })),
      })
      // Validated again here: the server checked it, but the browser is what
      // hands it to the kernel, and this is the last point before that.
      const validated = validateShapeProgram(response.program)
      settle({
        proposal: {
          program: validated, sent: program, notes: response.notes,
          diff: diffPrograms(program, validated),
        },
      })
    } catch (cause) {
      settle({ error: errorMessage(cause), asked: null })
    }
  }, [context, saved, documentId])

  // A discarded answer takes its question with it: the transcript records what
  // shaped the design, and a stray question would be sent as history next turn.
  const discard = useCallback(() => setExchange(null), [])

  const setError = useCallback((message: string | null) => {
    setExchange(previous => {
      if (previous?.documentId === documentId) return { ...previous, error: message }
      return message === null
        ? previous
        : { documentId, asked: null, proposal: null, busy: false, error: message }
    })
  }, [documentId])

  // Returns the turns rather than writing them: an append inside a setState
  // updater runs twice under StrictMode, which once double-posted the
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
    setExchange(null)
    return added
  }, [proposal, asked])

  return { available, busy, error, proposal, turns, send, discard, accept, setError }
}
