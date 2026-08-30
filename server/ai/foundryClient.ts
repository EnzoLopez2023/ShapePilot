// The Azure AI Foundry client.
//
// Keyless by default: a managed-identity token for the `https://ai.azure.com`
// audience, which matches .env.example's stated posture ("the app uses no
// client secret and relies on managed identity in production"). The dedicated
// resource exists so this app's inference cost is attributable on its own.
//
// The OpenAI SDK is pointed at the resource's /openai/v1/ route, which uses
// implicit versioning, and the deployment name is passed as `model`.
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity'
import OpenAI from 'openai'
import type { AiConfig } from '../config.ts'
import { ApiError } from '../errors/ApiError.ts'

/** Tokens are issued for this audience regardless of the model behind it. */
const FOUNDRY_SCOPE = 'https://ai.azure.com/.default'

/** A design turn should not hang a request; the client aborts well inside the
 *  browser's own 20 s timeout budget in src/services/http.ts. */
const REQUEST_TIMEOUT_MS = 90_000

export interface FoundryClient {
  readonly deployment: string
  /** Ask for a JSON object matching `schema`, and return the raw text. */
  respondJson(input: FoundryRequest): Promise<FoundryResponse>
}

export interface FoundryRequest {
  instructions: string
  input: string
  schemaName: string
  schema: Record<string, unknown>
  maxOutputTokens?: number
  signal?: AbortSignal
}

export interface FoundryResponse {
  text: string
  usage: { inputTokens: number; outputTokens: number; totalTokens: number }
}

export function createFoundryClient(config: AiConfig): FoundryClient | null {
  if (!config.enabled || !config.endpoint || !config.deployment) return null

  // An API key is a development convenience only; production has none and uses
  // the managed identity the Web App already carries.
  const auth = config.apiKey
    ? { apiKey: config.apiKey }
    : { apiKey: getBearerTokenProvider(new DefaultAzureCredential(), FOUNDRY_SCOPE) }

  const client = new OpenAI({
    baseURL: config.endpoint,
    timeout: REQUEST_TIMEOUT_MS,
    // The SDK's own retry would multiply a slow design turn; the route surfaces
    // failures instead so the user can decide to try again.
    maxRetries: 0,
    ...auth,
  })

  const deployment = config.deployment

  return {
    deployment,

    async respondJson(request: FoundryRequest): Promise<FoundryResponse> {
      let response
      try {
        response = await client.responses.create({
          model: deployment,
          instructions: request.instructions,
          input: request.input,
          max_output_tokens: request.maxOutputTokens ?? 16_000,
          text: {
            format: {
              type: 'json_schema',
              name: request.schemaName,
              strict: false,
              schema: request.schema,
            },
          },
        }, { signal: request.signal })
      } catch (cause) {
        throw translate(cause)
      }

      if (response.status !== 'completed') {
        // `incomplete` almost always means the token budget ran out mid-object,
        // which would otherwise surface as an unhelpful JSON parse error.
        const reason = response.incomplete_details?.reason ?? response.status
        throw new ApiError(502, 'ai_incomplete',
          `the model did not finish its answer (${reason})`)
      }

      const text = response.output_text?.trim()
      if (!text) throw new ApiError(502, 'ai_empty', 'the model returned no content')

      return {
        text,
        usage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
      }
    },
  }
}

/** Upstream failures become typed errors with a stable code, never a raw 500
 *  carrying provider internals. */
function translate(cause: unknown): ApiError {
  const status = (cause as { status?: number }).status
  if (status === 429) {
    return new ApiError(429, 'ai_rate_limited', 'the model is busy; try again in a moment')
  }
  if (status === 400) {
    return new ApiError(422, 'ai_rejected', 'the model could not act on that request')
  }
  if (status === 401 || status === 403) {
    // Almost always a missing role assignment on the Foundry resource rather
    // than anything the caller did.
    return new ApiError(502, 'ai_unauthorized', 'the design assistant is not configured correctly')
  }
  if ((cause as { name?: string }).name === 'AbortError') {
    return new ApiError(504, 'ai_timeout', 'the model took too long to answer')
  }
  return new ApiError(502, 'ai_unavailable', 'the design assistant is unavailable')
}
