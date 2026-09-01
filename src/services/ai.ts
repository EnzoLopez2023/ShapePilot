// The AI design API client.
import { apiRequest } from './http.ts'
import type { ShapeProgram } from '../../lib/contracts/shapeProgram.ts'
import type { VectorDrawing } from '../../lib/contracts/vectorDrawing.ts'

export interface ShapeUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface ShapeResponse {
  program: ShapeProgram
  /** One or two sentences describing what the model built or changed. */
  notes: string
  usage: ShapeUsage
}

export interface ShapeRequest {
  prompt: string
  /** Absent on the first turn; present makes it an edit. */
  program?: ShapeProgram | null
  context: 'playground' | 'bambu'
  history?: { role: 'user' | 'assistant'; text: string }[]
}

export const aiStatus = () => apiRequest<{ available: boolean }>('/ai/status')

export const requestShape = (body: ShapeRequest) =>
  apiRequest<ShapeResponse>('/ai/shape', {
    method: 'POST',
    body,
    // A design turn is a model call, not a database read; the default 20 s
    // budget in http.ts is too tight for one.
    timeoutMs: 120_000,
  })

/** A row of the inventory as the model read it off a photograph. */
export interface ReadSetItem {
  legend?: string
  units: number
  heightUnits?: number
  shape?: 'rect' | 'iso-enter'
  count?: number
  group?: string
  color?: string
  source: 'photo'
}

export interface KeycapSetResponse {
  set: {
    setName?: string
    manufacturer?: string
    capProfile?: string
    colorway?: string
    items: ReadSetItem[]
  }
  /** What the model found hard to read, in its own words. Worth showing. */
  notes: string
  usage: ShapeUsage
}

/**
 * Read a keycap set out of photographs already uploaded to the asset store.
 *
 * Only hashes cross the wire: the bytes went up through the asset route, and
 * the server reads them back itself. The answer is a proposal -- nothing is
 * saved until the person applies it.
 */
export const readKeycapSet = (hashes: string[], hint?: string) =>
  apiRequest<KeycapSetResponse>('/ai/keycap-set', {
    method: 'POST',
    body: { hashes, hint },
    // Several photographs through a vision model is the slowest call the app
    // makes; the design turn's own budget is the floor, not the ceiling.
    timeoutMs: 150_000,
  })

export interface VectorDrawingResponse {
  drawing: VectorDrawing
  /** One or two sentences describing what the model traced and the size it chose. */
  notes: string
  usage: ShapeUsage
}

/**
 * Trace artwork out of a photograph already uploaded to the asset store. Only
 * hashes cross the wire; the server reads the bytes back itself. The answer is
 * a proposal -- nothing is saved until the person applies it.
 */
export const traceVector = (hashes: string[], hint?: string) =>
  apiRequest<VectorDrawingResponse>('/ai/vector', {
    method: 'POST',
    body: { hashes, hint },
    // A vision turn, same class of latency as reading a keycap set.
    timeoutMs: 150_000,
  })
