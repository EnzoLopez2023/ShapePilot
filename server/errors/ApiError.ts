/**
 * Typed API failure. The wire shape is always
 * `{ error: { code, message, details? } }` and never carries SQL, tokens,
 * secrets, upstream URLs or stack traces.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  static badRequest(message: string, details?: Record<string, unknown>): ApiError {
    return new ApiError(400, 'bad_request', message, details)
  }

  static unauthorized(message = 'Sign-in required.'): ApiError {
    return new ApiError(401, 'unauthorized', message)
  }

  static forbidden(message = 'You do not have access to this resource.'): ApiError {
    return new ApiError(403, 'forbidden', message)
  }

  static notFound(message: string): ApiError {
    return new ApiError(404, 'not_found', message)
  }

  static conflict(message: string, details?: Record<string, unknown>): ApiError {
    return new ApiError(409, 'conflict', message, details)
  }

  static unavailable(message: string): ApiError {
    return new ApiError(503, 'unavailable', message)
  }

  toBody(): { error: { code: string; message: string; details?: Record<string, unknown> } } {
    return {
      error: this.details
        ? { code: this.code, message: this.message, details: this.details }
        : { code: this.code, message: this.message },
    }
  }
}
