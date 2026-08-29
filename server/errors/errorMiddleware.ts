import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ApiError } from './ApiError.ts'
import type { AuditRepository } from '../../lib/db/repositories/contracts.ts'

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(ApiError.notFound(`No API route matches ${req.method} ${req.path}.`))
}

export interface ErrorMiddlewareOptions {
  audit?: AuditRepository
  /** Log the underlying error server-side. Off in tests to keep output clean. */
  logger?: (message: string, error: unknown) => void
}

interface HttpParserError {
  status?: unknown
  statusCode?: unknown
  type?: unknown
}

function parserError(error: unknown): ApiError | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as HttpParserError
  const status = typeof candidate.status === 'number'
    ? candidate.status
    : typeof candidate.statusCode === 'number' ? candidate.statusCode : null

  if (status === 400 && candidate.type === 'entity.parse.failed') {
    return new ApiError(400, 'invalid_json', 'The request body is not valid JSON.')
  }
  if (status === 413 && candidate.type === 'entity.too.large') {
    return new ApiError(413, 'payload_too_large', 'The request body exceeds the 2 MB limit.')
  }
  if (status !== null && status >= 400 && status < 500) {
    return new ApiError(status, 'bad_request', 'The request could not be accepted.')
  }
  return null
}

/**
 * Terminal error handler. Unknown failures collapse to a generic 500 so that no
 * SQL text, token fragment, file path or upstream URL can leak to a caller.
 */
export function createErrorMiddleware(options: ErrorMiddlewareOptions = {}): ErrorRequestHandler {
  const log = options.logger ?? ((message, error) => {
    console.error(message, error instanceof Error ? error.message : error)
  })

  return (error, req, res, _next) => {
    const apiError = error instanceof ApiError
      ? error
      : parserError(error) ?? new ApiError(500, 'internal_error', 'The request could not be completed.')

    if (!(error instanceof ApiError) && !parserError(error)) {
      log(`Unhandled error on ${req.method} ${req.path}:`, error)
    }

    if (req.principal) {
      void options.audit?.record({
        owner: { tenantId: req.principal.tenantId, oid: req.principal.oid },
        category: 'http',
        action: 'request_failed',
        outcome: 'failure',
        httpMethod: req.method,
        httpPath: req.path,
        httpStatus: apiError.status,
        requestId: req.requestId ?? null,
        detail: { code: apiError.code },
      }).catch(() => { /* audit must never break a response */ })
    }

    if (res.headersSent) return
    res.status(apiError.status).json(apiError.toBody())
  }
}
