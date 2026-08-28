import { apiRequest } from '../services/http.ts'

export interface ClientAuditEvent {
  category: 'navigation' | 'session' | 'client'
  action: string
  subject?: string
  detail?: Record<string, unknown>
  outcome?: 'success' | 'failure'
}

/**
 * Client-side audit is advisory: the server records the verified actor and
 * ignores anything the client claims about identity. A failed post is dropped
 * rather than surfaced — audit must never interrupt the operator.
 */
export const recordAuditEvent = (event: ClientAuditEvent): void => {
  void apiRequest('/audit/events', { method: 'POST', body: event }).catch(() => {})
}
