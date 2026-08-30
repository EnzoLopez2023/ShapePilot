// AI design routes.
//
// The model never edits a document. It returns a typed ShapeProgram, which is
// validated here and again in the browser, previewed, and only then applied as
// one undo step -- the rule docs/ARCHITECTURE.md already states for the design
// copilot.
//
// Buffered JSON, no streaming: the app has no SSE or WebSocket path anywhere
// and src/services/http.ts has no streaming affordance, so introducing one is a
// separate change rather than a side effect of this feature.
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import type { Repositories } from '../../lib/db/repositories/contracts.ts'
import type { ShapeProgram } from '../../lib/contracts/shapeProgram.ts'
import { ShapeProgramError, validateShapeProgram } from '../../lib/contracts/shapeProgram.ts'
import { ApiError } from '../errors/ApiError.ts'
import { ownerOf } from '../auth/requireAuth.ts'
import type { FoundryClient } from '../ai/foundryClient.ts'
import {
  BAMBU_CONTEXT, CREATE_INSTRUCTIONS, EDIT_INSTRUCTIONS, PLAYGROUND_CONTEXT,
  SHAPE_PROGRAM_SCHEMA,
} from '../ai/shapeProgramSchema.ts'

type Handler = (req: Request, res: Response) => Promise<void>

const asyncRoute = (handler: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next)
  }

const LIMITS = {
  promptMaxLength: 4_000,
  /** The serialised program sent as context. Beyond this the model is being
   *  asked to re-emit more than it can reliably keep stable. */
  programMaxBytes: 400_000,
  maxHistoryTurns: 20,
  historyTextMaxLength: 4_000,
}

/**
 * Per-user rate limit. Inference is the one thing here that costs money per
 * call, so a runaway client is a billing problem, not just a load problem.
 * In-memory is the right scope: the deployment profile is one process, one
 * worker, one instance.
 */
const RATE_WINDOW_MS = 60_000
const RATE_MAX_CALLS = 20

interface Bucket { count: number; resetAt: number }

/**
 * State belongs to the router, not the module: a module-level map would be
 * shared by every app built in a process, which is wrong for tests today and
 * would be wrong for any future multi-app host.
 */
function createRateLimiter() {
  const buckets = new Map<string, Bucket>()
  return (key: string, now: number): boolean => {
    // Buckets are tiny, but a long-lived process should not accumulate one per
    // user forever.
    if (buckets.size >= 256) {
      for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k)
    }
    const bucket = buckets.get(key)
    if (!bucket || now >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS })
      return true
    }
    if (bucket.count >= RATE_MAX_CALLS) return false
    bucket.count += 1
    return true
  }
}

const bad = (field: string, message: string): never => {
  throw new ApiError(400, 'bad_request', message, { field })
}

interface ShapeRequest {
  prompt: string
  program: ShapeProgram | null
  context: 'playground' | 'bambu'
  history: { role: 'user' | 'assistant'; text: string }[]
}

function parseRequest(body: unknown): ShapeRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    bad('body', 'body must be an object')
  }
  const raw = body as Record<string, unknown>
  for (const key of Object.keys(raw)) {
    if (!['prompt', 'program', 'context', 'history'].includes(key)) {
      bad('body', `body has an unknown property "${key}"`)
    }
  }

  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : ''
  if (!prompt) bad('prompt', 'prompt is required')
  if (prompt.length > LIMITS.promptMaxLength) {
    bad('prompt', `prompt must be at most ${LIMITS.promptMaxLength} characters`)
  }

  const context = raw.context === 'bambu' ? 'bambu' : 'playground'
  if (raw.context !== undefined && raw.context !== 'bambu' && raw.context !== 'playground') {
    bad('context', 'context must be "playground" or "bambu"')
  }

  let program: ShapeProgram | null = null
  if (raw.program !== undefined && raw.program !== null) {
    const serialised = JSON.stringify(raw.program)
    if (Buffer.byteLength(serialised, 'utf8') > LIMITS.programMaxBytes) {
      bad('program', 'the current design is too large to send to the assistant')
    }
    try {
      program = validateShapeProgram(raw.program)
    } catch (cause) {
      if (cause instanceof ShapeProgramError) {
        throw new ApiError(400, 'bad_request', `program is invalid: ${cause.message}`,
          { field: cause.field })
      }
      throw cause
    }
  }

  const history: ShapeRequest['history'] = []
  if (raw.history !== undefined && raw.history !== null) {
    if (!Array.isArray(raw.history)) bad('history', 'history must be an array')
    // Only the most recent turns are sent: older ones add cost without changing
    // the answer, since the current program already carries the design state.
    for (const turn of (raw.history as unknown[]).slice(-LIMITS.maxHistoryTurns)) {
      if (typeof turn !== 'object' || turn === null) bad('history', 'history entries must be objects')
      const t = turn as Record<string, unknown>
      const role = t.role
      if (role !== 'user' && role !== 'assistant') {
        bad('history', 'history role must be "user" or "assistant"')
      }
      if (typeof t.text !== 'string') bad('history', 'history text must be a string')
      history.push({
        role: role as 'user' | 'assistant',
        text: (t.text as string).slice(0, LIMITS.historyTextMaxLength),
      })
    }
  }

  return { prompt, program, context, history }
}

function buildInput(request: ShapeRequest): string {
  const sections: string[] = []
  if (request.history.length) {
    sections.push('Conversation so far:\n' + request.history
      .map(t => `${t.role === 'user' ? 'User' : 'You'}: ${t.text}`)
      .join('\n'))
  }
  if (request.program) {
    sections.push('Current program:\n' + JSON.stringify(request.program))
  }
  sections.push(`User request:\n${request.prompt}`)
  return sections.join('\n\n')
}

export interface AiRouterOptions {
  repos: Repositories
  /** Null when the Foundry resource is not configured; the routes then report
   *  the feature as unavailable rather than the app failing to start. */
  client: FoundryClient | null
}

export function createAiRouter({ repos, client }: AiRouterOptions): Router {
  const router = Router()
  const { audit } = repos
  const takeToken = createRateLimiter()

  router.get('/status', (_req, res) => {
    res.json({ available: client !== null })
  })

  router.post('/shape', asyncRoute(async (req, res) => {
    if (!client) {
      throw new ApiError(503, 'ai_unavailable', 'the design assistant is not configured')
    }
    const owner = ownerOf(req)
    const now = Date.now()
    if (!takeToken(`${owner.tenantId}:${owner.oid}`, now)) {
      throw new ApiError(429, 'rate_limited',
        `at most ${RATE_MAX_CALLS} design requests per minute`)
    }

    const request = parseRequest(req.body ?? {})
    const contextNote = request.context === 'bambu' ? BAMBU_CONTEXT : PLAYGROUND_CONTEXT
    const instructions =
      `${request.program ? EDIT_INSTRUCTIONS : CREATE_INSTRUCTIONS}\n\n${contextNote}`

    const answer = await client.respondJson({
      instructions,
      input: buildInput(request),
      schemaName: 'shape_program',
      schema: SHAPE_PROGRAM_SCHEMA,
    })

    let parsed: unknown
    try {
      parsed = JSON.parse(answer.text)
    } catch {
      throw new ApiError(502, 'ai_malformed', 'the model returned something that is not JSON')
    }

    const { notes, ...programFields } = parsed as Record<string, unknown>
    let program: ShapeProgram
    try {
      // Structured output guarantees the shape, not that the numbers describe a
      // buildable part, so the same validator the browser uses runs here first.
      program = validateShapeProgram(programFields)
    } catch (cause) {
      if (cause instanceof ShapeProgramError) {
        throw new ApiError(502, 'ai_invalid_program',
          `the model produced an unusable design (${cause.message})`, { field: cause.field })
      }
      throw cause
    }

    // Token usage is audited on every call so cost is attributable per user,
    // which is half the reason the Foundry resource is dedicated to this app.
    void audit.record({
      owner,
      category: 'ai',
      action: 'shape_generated',
      outcome: 'success',
      httpMethod: req.method,
      httpPath: req.path,
      httpStatus: 200,
      requestId: req.requestId ?? null,
      subject: client.deployment,
      detail: JSON.stringify({
        context: request.context,
        edit: request.program !== null,
        parts: program.parts.length,
        usage: answer.usage,
      }),
    }).catch(() => { /* audit must never break a response */ })

    res.json({
      program,
      notes: typeof notes === 'string' ? notes : '',
      usage: answer.usage,
    })
  }))

  return router
}
