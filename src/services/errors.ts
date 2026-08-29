/** Typed client-side view of the server's `{ error: { code, message } }` envelope. */
export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.details = details
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403
  }
}

export const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : 'Something went wrong.'
