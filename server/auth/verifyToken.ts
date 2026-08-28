// Entra access-token verification.
//
// ShapePilot exposes its own API audience and validates an *access* token, not
// an ID token. That is the deliberate difference from the pinned Hearth
// behaviour, which accepted an app-audienced ID token because it had no API
// scope registered. See docs/SOURCE_LINEAGE.md.
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { JWTVerifyGetKey } from 'jose'
import type { AuthConfig } from '../config.ts'
import { ApiError } from '../errors/ApiError.ts'
import type { RawClaims } from './claims.ts'

export interface TokenVerifier {
  verify(token: string): Promise<RawClaims>
}

const CLOCK_TOLERANCE_SECONDS = 60

export function createTokenVerifier(
  auth: AuthConfig,
  getKey: JWTVerifyGetKey = createRemoteJWKSet(new URL(auth.jwksUri)),
): TokenVerifier {
  return {
    async verify(token: string): Promise<RawClaims> {
      try {
        const { payload } = await jwtVerify(token, getKey, {
          issuer: auth.issuers,
          audience: auth.audience,
          clockTolerance: CLOCK_TOLERANCE_SECONDS,
        })
        return payload as RawClaims
      } catch (error) {
        // Signature failures, expiry, wrong audience and wrong issuer all
        // collapse to one message: the precise reason is not the caller's
        // business and leaking it helps an attacker probe the configuration.
        const code = (error as { code?: string }).code ?? 'verification_failed'
        throw new ApiError(401, 'unauthorized', 'Invalid or expired sign-in.', { reason: code })
      }
    },
  }
}
