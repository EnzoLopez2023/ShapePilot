import type { RequestHandler } from 'express'
import { ApiError } from '../errors/ApiError.ts'
import type { AppRole, MembershipRepository } from '../../lib/db/repositories/contracts.ts'
import { ownerOf } from './requireAuth.ts'

/**
 * Server-side role re-verification.
 *
 * The role is read from the app-local membership table on every call, never
 * from the token and never from anything the client sent. A token role claim
 * only ever influences the *initial* membership row.
 */
export function requireRole(role: AppRole, memberships: MembershipRepository): RequestHandler {
  return (req, _res, next) => {
    void (async () => {
      try {
        const owner = ownerOf(req)
        const membership = await memberships.find(owner)
        if (!membership) throw ApiError.forbidden()
        if (role === 'admin' && membership.role !== 'admin') {
          throw ApiError.forbidden('Administrator access is required.')
        }
        req.role = membership.role
        next()
      } catch (error) {
        next(error)
      }
    })()
  }
}
