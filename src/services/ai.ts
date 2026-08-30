// The AI design API client.
import { apiRequest } from './http.ts'
import type { ShapeProgram } from '../../lib/contracts/shapeProgram.ts'

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
