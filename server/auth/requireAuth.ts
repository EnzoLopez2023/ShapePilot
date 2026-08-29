import type { RequestHandler } from 'express'
import type { AuthConfig } from '../config.ts'
import { ApiError } from '../errors/ApiError.ts'
import type {
  MembershipRepository,
} from '../../lib/db/repositories/contracts.ts'
import { bearerToken, principalFromClaims } from './claims.ts'
import type { Principal } from './claims.ts'
import type { TokenVerifier } from './verifyToken.ts'

declare module 'express-serve-static-core' {
  interface Request {
    principal?: Principal
    requestId?: string
    role?: 'user' | 'admin'
  }
}

export interface RequireAuthOptions {
  auth: AuthConfig
  verifier: TokenVerifier | null
  memberships: MembershipRepository
}

/**
 * The documented development bypass.
 *
 * Enabled only by SHAPEPILOT_DEV_AUTH outside production — `loadConfig` throws
 * if it is requested with NODE_ENV=production, so a production process cannot
 * reach this path at all. It exists so local development and the automated test
 * suite can exercise the real routes without an Entra tenant.
 */
function developmentPrincipal(auth: AuthConfig, headers: Record<string, unknown>): Principal {
  const header = (name: string): string | null => {
    const value = headers[name]
    return typeof value === 'string' && value.trim() !== '' ? value.trim().toLowerCase() : null
  }
  return {
    tenantId: header('x-shapepilot-dev-tenant') ?? auth.devBypass.tenantId,
    oid: header('x-shapepilot-dev-oid') ?? auth.devBypass.oid,
    displayName: auth.devBypass.name,
    email: auth.devBypass.email,
    scopes: [auth.requiredScope],
    tokenRoles: [],
    source: 'development',
  }
}

export function requireAuth(options: RequireAuthOptions): RequestHandler {
  const { auth, verifier, memberships } = options

  return (req, _res, next) => {
    void (async () => {
      try {
        let principal: Principal

        const token = bearerToken(req.get('authorization'))
        if (token) {
          if (!verifier) throw ApiError.unavailable('Token verification is not configured.')
          principal = principalFromClaims(await verifier.verify(token), {
            tenantId: auth.tenantId,
            requiredScope: auth.requiredScope,
          })
        } else if (auth.devBypass.enabled) {
          principal = developmentPrincipal(auth, req.headers as Record<string, unknown>)
        } else {
          throw ApiError.unauthorized()
        }

        const isBootstrapAdmin = auth.bootstrapAdminOids.includes(principal.oid)
        const devAdmin = principal.source === 'development' && auth.devBypass.role === 'admin'
        const membership = await memberships.ensure({
          owner: { tenantId: principal.tenantId, oid: principal.oid },
          displayName: principal.displayName,
          email: principal.email,
          initialRole: isBootstrapAdmin || devAdmin ? 'admin' : 'user',
        })

        req.principal = principal
        req.role = membership.role
        next()
      } catch (error) {
        next(error)
      }
    })()
  }
}

/** The owner tuple for the current request, or a typed 401. */
export function ownerOf(req: { principal?: Principal }): { tenantId: string; oid: string } {
  if (!req.principal) throw ApiError.unauthorized()
  return { tenantId: req.principal.tenantId, oid: req.principal.oid }
}
