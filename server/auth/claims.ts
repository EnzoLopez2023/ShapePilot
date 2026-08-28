// Claim extraction and validation.
//
// The persisted identity is `(tenant_id, oid)` and nothing else. Email and
// display name are carried for audit and display, never for authorization.
import { ApiError } from '../errors/ApiError.ts'

export const GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface Principal {
  tenantId: string
  oid: string
  displayName: string | null
  email: string | null
  scopes: string[]
  tokenRoles: string[]
  /** How the principal was established; recorded in the audit trail. */
  source: 'entra' | 'development'
}

export interface RawClaims {
  tid?: unknown
  oid?: unknown
  scp?: unknown
  roles?: unknown
  name?: unknown
  preferred_username?: unknown
  upn?: unknown
  email?: unknown
  sub?: unknown
  [key: string]: unknown
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

const asStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  const text = asString(value)
  return text ? text.split(' ').filter(Boolean) : []
}

export interface ClaimRequirements {
  tenantId: string
  requiredScope: string
}

/**
 * Turn verified JWT claims into a Principal, or throw a typed 401/403.
 *
 * The signature, issuer, audience and lifetime have already been checked by
 * `verifyAccessToken`; everything here is about *which* identity the token
 * represents and whether it carries the ShapePilot API scope.
 */
export function principalFromClaims(claims: RawClaims, requirements: ClaimRequirements): Principal {
  const tid = asString(claims.tid)?.toLowerCase()
  if (!tid || !GUID_PATTERN.test(tid)) {
    throw ApiError.unauthorized('The access token has no usable tenant claim.')
  }
  if (tid !== requirements.tenantId.toLowerCase()) {
    throw ApiError.unauthorized('The access token was issued by another tenant.')
  }

  const oid = asString(claims.oid)?.toLowerCase()
  if (!oid || !GUID_PATTERN.test(oid)) {
    // `sub` is pairwise and app-scoped; it is not a stable directory identity.
    throw ApiError.unauthorized('The access token has no GUID-shaped object id.')
  }

  const scopes = asStringArray(claims.scp)
  const tokenRoles = asStringArray(claims.roles)
  const hasScope = scopes.includes(requirements.requiredScope)
  const hasRole = tokenRoles.includes(requirements.requiredScope)
  if (!hasScope && !hasRole) {
    throw ApiError.forbidden('The access token does not carry the ShapePilot API scope.')
  }

  return {
    tenantId: tid,
    oid,
    displayName: asString(claims.name),
    email: asString(claims.preferred_username) ?? asString(claims.upn) ?? asString(claims.email),
    scopes,
    tokenRoles,
    source: 'entra',
  }
}

export const bearerToken = (authorization: string | undefined): string | null => {
  if (!authorization) return null
  const [scheme, ...rest] = authorization.split(' ')
  if (scheme?.toLowerCase() !== 'bearer') return null
  const token = rest.join(' ').trim()
  return token || null
}
