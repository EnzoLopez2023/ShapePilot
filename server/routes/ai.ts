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
import type { Repositories, SetItemInput } from '../../lib/db/repositories/contracts.ts'
import { isImageAssetFormat } from '../../lib/db/repositories/contracts.ts'
import type { ShapeProgram } from '../../lib/contracts/shapeProgram.ts'
import { ShapeProgramError, validateShapeProgram } from '../../lib/contracts/shapeProgram.ts'
import type { AssetStore } from '../../lib/assets/assetStore.ts'
import { AssetStoreError, assetKey } from '../../lib/assets/assetStore.ts'
import { ApiError } from '../errors/ApiError.ts'
import { ownerOf } from '../auth/requireAuth.ts'
import type { FoundryClient, FoundryContent } from '../ai/foundryClient.ts'
import {
  BAMBU_CONTEXT, CREATE_INSTRUCTIONS, EDIT_INSTRUCTIONS, PLAYGROUND_CONTEXT,
  SHAPE_PROGRAM_SCHEMA,
} from '../ai/shapeProgramSchema.ts'
import { KEYCAP_SET_INSTRUCTIONS, KEYCAP_SET_SCHEMA } from '../ai/keycapSetSchema.ts'
import { validateSetItems } from '../validation/keycapProject.ts'

type Handler = (req: Request, res: Response) => Promise<void>

const asyncRoute = (handler: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next)
  }

const LIMITS = {
  promptMaxLength: 4_000,
  /** Enough for a full set photographed from a few angles, not a photo album. */
  maxPhotos: 6,
  hintMaxLength: 500,
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
/**
 * Its own, much smaller budget. A turn carrying six photographs costs several
 * times a text turn, and the work it does -- reading a set the user then edits
 * by hand -- is not something anyone needs to repeat twenty times a minute.
 */
const RATE_MAX_VISION_CALLS = 6

interface Bucket { count: number; resetAt: number }

/**
 * State belongs to the router, not the module: a module-level map would be
 * shared by every app built in a process, which is wrong for tests today and
 * would be wrong for any future multi-app host.
 *
 * The budget is a parameter because the two routes are not the same expense: a
 * text turn and a turn carrying six photographs differ by more than the window
 * can express.
 */
function createRateLimiter(maxCalls: number) {
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
    if (bucket.count >= maxCalls) return false
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

interface KeycapSetRequest {
  hashes: string[]
  hint: string
}

/** A content hash names bytes in the asset store; anything else is not one. */
const HEX64 = /^[0-9a-f]{64}$/

function parseKeycapSetRequest(body: unknown): KeycapSetRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    bad('body', 'body must be an object')
  }
  const raw = body as Record<string, unknown>
  for (const key of Object.keys(raw)) {
    if (!['hashes', 'hint'].includes(key)) {
      bad('body', `body has an unknown property "${key}"`)
    }
  }

  if (!Array.isArray(raw.hashes) || raw.hashes.length === 0) {
    bad('hashes', 'at least one photo is required')
  }
  const requested = raw.hashes as unknown[]
  if (requested.length > LIMITS.maxPhotos) {
    bad('hashes', `at most ${LIMITS.maxPhotos} photos can be read at once`)
  }
  const hashes: string[] = []
  for (const hash of requested) {
    if (typeof hash !== 'string' || !HEX64.test(hash)) {
      bad('hashes', 'each photo must be named by its content hash')
    }
    // The same photo twice is the same photo: it would double the cost of the
    // turn and invite the model to count the caps on it twice.
    if (!hashes.includes(hash as string)) hashes.push(hash as string)
  }

  const hint = typeof raw.hint === 'string' ? raw.hint.trim() : ''
  if (hint.length > LIMITS.hintMaxLength) {
    bad('hint', `hint must be at most ${LIMITS.hintMaxLength} characters`)
  }

  return { hashes, hint }
}

export interface AiRouterOptions {
  repos: Repositories
  /** Null when the Foundry resource is not configured; the routes then report
   *  the feature as unavailable rather than the app failing to start. */
  client: FoundryClient | null
  /** Resolved on first use, exactly as the design-asset route resolves it. */
  store: () => AssetStore
}

export function createAiRouter({ repos, client, store }: AiRouterOptions): Router {
  const router = Router()
  const { audit, designAssets } = repos
  const takeToken = createRateLimiter(RATE_MAX_CALLS)
  const takeVisionToken = createRateLimiter(RATE_MAX_VISION_CALLS)

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

  /**
   * Read a keycap set out of photographs the caller has already uploaded.
   *
   * The photos are named by content hash rather than posted here: the bytes go
   * up through PUT /api/design-assets/:hash like any other asset, so this body
   * stays small and the 2 MB express.json limit is never in play. The route
   * then reads them back out of the store server-side.
   *
   * Like every other AI route, the answer is a proposal. Nothing is written to
   * a project; the browser shows the rows and the person applies them.
   */
  router.post('/keycap-set', asyncRoute(async (req, res) => {
    if (!client) {
      throw new ApiError(503, 'ai_unavailable', 'the design assistant is not configured')
    }
    const owner = ownerOf(req)
    if (!takeVisionToken(`${owner.tenantId}:${owner.oid}`, Date.now())) {
      throw new ApiError(429, 'rate_limited',
        `at most ${RATE_MAX_VISION_CALLS} photo readings per minute`)
    }

    const request = parseKeycapSetRequest(req.body ?? {})

    const content: FoundryContent[] = [{
      type: 'input_text',
      text: request.hint
        ? `Read these photographs of a keycap set.\n\nFrom the owner: ${request.hint}`
        : 'Read these photographs of a keycap set.',
    }]
    for (const hash of request.hashes) {
      // Owner-scoped, so a hash belonging to someone else is simply not found.
      const asset = await designAssets.find(owner, hash)
      if (!asset) throw ApiError.notFound('photo not found')
      if (!isImageAssetFormat(asset.format)) {
        throw ApiError.badRequest('that asset is not an image', { field: 'hashes' })
      }
      let bytes: Uint8Array
      try {
        bytes = await store().get(assetKey(owner, hash))
      } catch (cause) {
        // Metadata without bytes is a real state, since assets sit outside the
        // backup manifest. It reads as absent, so the client re-uploads.
        if (cause instanceof AssetStoreError) throw ApiError.notFound('photo not found')
        throw cause
      }
      content.push({
        type: 'input_image',
        image_url: `data:image/${asset.format};base64,${Buffer.from(bytes).toString('base64')}`,
        detail: 'auto',
      })
    }

    const answer = await client.respondJson({
      instructions: KEYCAP_SET_INSTRUCTIONS,
      input: [{ role: 'user', content }],
      schemaName: 'keycap_set',
      schema: KEYCAP_SET_SCHEMA,
    })

    let parsed: unknown
    try {
      parsed = JSON.parse(answer.text)
    } catch {
      throw new ApiError(502, 'ai_malformed', 'the model returned something that is not JSON')
    }

    const fields = parsed as Record<string, unknown>
    let items: SetItemInput[]
    try {
      // The same validator the PUT route runs. Structured output guarantees the
      // shape of the answer, not that a 6.25u Escape key is a real keycap.
      items = validateSetItems(fields.items ?? [])
    } catch (cause) {
      if (cause instanceof ApiError) {
        throw new ApiError(502, 'ai_invalid_set',
          `the model produced an unusable inventory (${cause.message})`, cause.details)
      }
      throw cause
    }

    const text = (field: unknown): string | undefined =>
      (typeof field === 'string' && field.trim() !== '' ? field.trim() : undefined)

    void audit.record({
      owner,
      category: 'ai',
      action: 'keycap_set_extracted',
      outcome: 'success',
      httpMethod: req.method,
      httpPath: req.path,
      httpStatus: 200,
      requestId: req.requestId ?? null,
      subject: client.deployment,
      detail: JSON.stringify({
        photos: request.hashes.length,
        items: items.length,
        usage: answer.usage,
      }),
    }).catch(() => { /* audit must never break a response */ })

    res.json({
      set: {
        setName: text(fields.setName),
        manufacturer: text(fields.manufacturer),
        capProfile: text(fields.capProfile),
        colorway: text(fields.colorway),
        // Marked as read from a photo so the review table can show which rows
        // the person has since edited by hand.
        items: items.map(item => ({ ...item, source: 'photo' as const })),
      },
      notes: text(fields.notes) ?? '',
      usage: answer.usage,
    })
  }))

  return router
}
