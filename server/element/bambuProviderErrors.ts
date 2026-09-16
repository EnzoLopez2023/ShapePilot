const messages = {
  provider_error: 'The Bambu cloud provider could not complete the request.',
  invalid_configuration: 'A valid server-side Bambu access token and cloud region are required.',
  invalid_identifier: 'The Bambu account, printer, or task identifier is invalid.',
  invalid_request: 'The Bambu history request is invalid.',
  provider_closed: 'The Bambu cloud provider has been closed.',
  request_aborted: 'The Bambu cloud request was cancelled.',
  credential_expired: 'The Bambu access token has expired. Replace the server-side credential.',
  credential_rejected: 'Bambu rejected the access token or its permissions. Replace or verify the server-side credential.',
  account_mismatch: 'The selected account does not match the authenticated Bambu account.',
  printer_not_bound: 'The selected printer is not bound to the authenticated Bambu account.',
  queue_full: 'The Bambu cloud request queue is full. Try again later.',
  http_timeout: 'The Bambu cloud request exceeded its time budget.',
  network_unavailable: 'The Bambu cloud connection could not be established securely.',
  redirect_rejected: 'Bambu returned a redirect. Credentials were not forwarded.',
  response_too_large: 'The Bambu cloud response exceeded the supported size.',
  invalid_response: 'Bambu returned an unsupported or malformed response.',
  rate_limited: 'Bambu is rate limiting requests. Synchronization will retry later.',
  cloud_unavailable: 'Bambu cloud is temporarily unavailable.',
  cloud_rejected: 'Bambu cloud rejected the read-only request.',
  history_wrong_device: 'Bambu returned history for a different printer. The page was not imported.',
  history_duplicate: 'Bambu returned duplicate task identifiers. The page was not imported.',
  history_cursor_loop: 'Bambu replayed a history cursor. The page was not imported.',
  mqtt_connect_timeout: 'The Bambu status subscription exceeded its connection time budget.',
  mqtt_subscribe_failed: 'Bambu did not grant the read-only printer status subscription.',
  mqtt_unavailable: 'The Bambu printer status connection is unavailable.',
  mqtt_invalid_payload: 'Bambu sent an unsupported or malformed printer status report.',
  mqtt_payload_too_large: 'The Bambu printer status report exceeded the supported size.',
  mqtt_stale_report: 'An outdated or invalidly dated printer status report was ignored.',
  subscription_limit: 'The Bambu provider has reached its status subscription limit.',
} as const

export type BambuProviderErrorCode = keyof typeof messages

export class BambuProviderError extends Error {
  override readonly name = 'BambuProviderError'
  readonly code: BambuProviderErrorCode
  readonly retryAfterMs: number | null
  readonly status?: number

  // Accept controller messages without allowing arbitrary text into public errors.
  constructor(code: string, safeMessage: string, retryAfterMs?: number | null, status?: number)
  constructor(code: string, retryAfterMs?: number | null, status?: number)
  constructor(
    code: string,
    messageOrRetryAfter: string | number | null = null,
    retryAfterOrStatus: number | null = null,
    messageStatus?: number,
  ) {
    const safeCode = Object.hasOwn(messages, code) ? code as BambuProviderErrorCode : 'provider_error'
    super(messages[safeCode])
    const retryAfterMs = typeof messageOrRetryAfter === 'string' ? retryAfterOrStatus : messageOrRetryAfter
    const status = (typeof messageOrRetryAfter === 'string' ? messageStatus : retryAfterOrStatus) ?? undefined
    this.code = safeCode
    this.retryAfterMs = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs)
      ? Math.min(86_400_000, Math.max(0, Math.ceil(retryAfterMs)))
      : null
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) this.status = status
  }
}
