// Authentication and authorization negative cases.
//
// ShapePilot validates an access token audienced to its own API, so the checks
// below are the ones the pinned Hearth ID-token gate could not make: tenant,
// issuer, audience, expiry, GUID-shaped oid, and the API scope. Roles are
// re-read from the app-local membership table on every admin call.
import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import type { JWTVerifyGetKey, KeyObject } from 'jose'
import { createLocalJWKSet } from 'jose'
import {
  OTHER_OID, TEST_AUDIENCE, TEST_OID, TEST_SCOPE, TEST_TENANT,
  startTestServer, stubVerifier, testConfig, validClaims,
} from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'
import { ApiError } from '../../server/errors/ApiError.ts'
import { bearerToken, principalFromClaims } from '../../server/auth/claims.ts'
import { createTokenVerifier } from '../../server/auth/verifyToken.ts'
import { ConfigError, loadConfig } from '../../server/config.ts'

const requirements = { tenantId: TEST_TENANT, requiredScope: TEST_SCOPE }

describe('claim validation', () => {
  test('a well-formed access token yields a principal keyed by (tenant, oid)', () => {
    const principal = principalFromClaims(validClaims(), requirements)
    assert.equal(principal.tenantId, TEST_TENANT)
    assert.equal(principal.oid, TEST_OID)
    assert.equal(principal.source, 'entra')
    assert.deepEqual(principal.scopes, [TEST_SCOPE])
  })

  test('a token from another tenant is rejected', () => {
    assert.throws(
      () => principalFromClaims(
        validClaims({ tid: '99999999-9999-9999-9999-999999999999' }), requirements),
      (error: unknown) => error instanceof ApiError && error.status === 401)
  })

  test('a missing tenant claim is rejected', () => {
    assert.throws(() => principalFromClaims(validClaims({ tid: undefined }), requirements),
      (error: unknown) => error instanceof ApiError && error.status === 401)
  })

  test('a non-GUID oid is rejected', () => {
    for (const oid of ['not-a-guid', '', 'aaaa', 12345]) {
      assert.throws(() => principalFromClaims(validClaims({ oid }), requirements),
        (error: unknown) => error instanceof ApiError && error.status === 401,
        `oid ${String(oid)} must be rejected`)
    }
  })

  test('`sub` is never accepted as a substitute for `oid`', () => {
    const claims = validClaims({ oid: undefined, sub: TEST_OID })
    assert.throws(() => principalFromClaims(claims, requirements),
      (error: unknown) => error instanceof ApiError && error.status === 401)
  })

  test('a token without the API scope is a 403', () => {
    assert.throws(() => principalFromClaims(validClaims({ scp: 'User.Read' }), requirements),
      (error: unknown) => error instanceof ApiError && error.status === 403)
  })

  test('an app role matching the scope name is accepted for daemon callers', () => {
    const principal = principalFromClaims(
      validClaims({ scp: undefined, roles: [TEST_SCOPE] }), requirements)
    assert.deepEqual(principal.tokenRoles, [TEST_SCOPE])
  })

  test('display fields are carried but never used as keys', () => {
    const principal = principalFromClaims(validClaims(), requirements)
    assert.equal(principal.displayName, 'Test Operator')
    assert.equal(principal.email, 'test@example.invalid')
  })

  test('bearerToken only accepts a Bearer scheme', () => {
    assert.equal(bearerToken('Bearer abc'), 'abc')
    assert.equal(bearerToken('bearer abc'), 'abc')
    assert.equal(bearerToken('Basic abc'), null)
    assert.equal(bearerToken(undefined), null)
    assert.equal(bearerToken('Bearer   '), null)
  })
})

describe('signature, issuer, audience and lifetime', () => {
  test('a real signed token is accepted, and tampering with any of them is not', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const jwk = await exportJWK(publicKey as KeyObject)
    jwk.kid = 'test-key'
    jwk.alg = 'RS256'
    const jwks: JWTVerifyGetKey = createLocalJWKSet({ keys: [jwk] })

    const auth = testConfig().auth
    const verifier = createTokenVerifier(auth, jwks)
    const issuer = `https://login.microsoftonline.com/${TEST_TENANT}/v2.0`

    const sign = (overrides: {
      issuer?: string; audience?: string; expiresIn?: string; notBefore?: string
    } = {}) => new SignJWT({ tid: TEST_TENANT, oid: TEST_OID, scp: TEST_SCOPE })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuedAt()
      .setIssuer(overrides.issuer ?? issuer)
      .setAudience(overrides.audience ?? TEST_AUDIENCE)
      .setExpirationTime(overrides.expiresIn ?? '5m')
      .sign(privateKey)

    const claims = await verifier.verify(await sign())
    assert.equal(claims.oid, TEST_OID)

    const rejects = async (token: string, label: string) => {
      await assert.rejects(
        () => verifier.verify(token),
        (error: unknown) => error instanceof ApiError && error.status === 401,
        label)
    }

    await rejects(await sign({ audience: 'api://someone-else' }), 'wrong audience')
    await rejects(await sign({ issuer: 'https://login.microsoftonline.com/other/v2.0' }), 'wrong issuer')
    // Well past the 60-second clock tolerance the verifier allows.
    await rejects(await sign({ expiresIn: '-10m' }), 'expired')

    // A token signed by a different key must fail the signature check.
    const other = await generateKeyPair('RS256')
    const forged = await new SignJWT({ tid: TEST_TENANT, oid: TEST_OID, scp: TEST_SCOPE })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuedAt().setIssuer(issuer).setAudience(TEST_AUDIENCE).setExpirationTime('5m')
      .sign(other.privateKey)
    await rejects(forged, 'forged signature')

    // The v1 issuer form is accepted, matching how MSAL has moved between them.
    const v1 = await sign({ issuer: `https://sts.windows.net/${TEST_TENANT}/` })
    assert.equal((await verifier.verify(v1)).oid, TEST_OID)
  })

  test('the verifier never leaks the failure reason into the message', async () => {
    const { privateKey } = await generateKeyPair('RS256')
    const other = await generateKeyPair('RS256')
    const jwk = await exportJWK(other.publicKey as KeyObject)
    jwk.kid = 'k'
    jwk.alg = 'RS256'
    const verifier = createTokenVerifier(testConfig().auth, createLocalJWKSet({ keys: [jwk] }))
    const token = await new SignJWT({ tid: TEST_TENANT, oid: TEST_OID, scp: TEST_SCOPE })
      .setProtectedHeader({ alg: 'RS256', kid: 'k' })
      .setIssuedAt()
      .setIssuer(`https://login.microsoftonline.com/${TEST_TENANT}/v2.0`)
      .setAudience(TEST_AUDIENCE).setExpirationTime('5m').sign(privateKey)

    await assert.rejects(() => verifier.verify(token), (error: unknown) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.message, 'Invalid or expired sign-in.')
      assert.ok(!/signature|jwks|key/i.test(error.message))
      return true
    })
  })
})

describe('HTTP gate', () => {
  let servers: TestServer[] = []
  const track = async (server: Promise<TestServer>) => {
    const started = await server
    servers.push(started)
    return started
  }

  afterEach(async () => {
    await Promise.all(servers.map(s => s.close()))
    servers = []
  })

  test('an unauthenticated request to a feature route is 401', async () => {
    const server = await track(startTestServer({ label: 'auth-401', verifier: stubVerifier({}) }))
    const response = await server.fetchJson('/api/keycap-trays')
    assert.equal(response.status, 401)
    assert.equal((response.body as { error: { code: string } }).error.code, 'unauthorized')
  })

  test('an unknown token is 401 and does not create a membership', async () => {
    const server = await track(startTestServer({ label: 'auth-bad', verifier: stubVerifier({}) }))
    const response = await server.fetchJson('/api/keycap-trays', { token: 'nope' })
    assert.equal(response.status, 401)
    assert.equal((await server.repos.memberships.list()).length, 0)
  })

  test('anonymous authentication failures do not write attacker-controlled audit rows', async () => {
    const server = await track(startTestServer({ label: 'auth-audit', verifier: stubVerifier({}) }))
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await server.fetchJson('/api/keycap-trays', {
        token: 'secret-token-value',
      })
      assert.equal(response.status, 401)
    }
    assert.equal((await server.repos.audit.list()).length, 0)
  })

  test('malformed and oversized JSON retain typed client-error statuses', async () => {
    const server = await track(startTestServer({
      label: 'body-errors',
      verifier: stubVerifier({ good: validClaims() }),
    }))
    const malformed = await server.fetchJson('/api/keycap-trays', {
      method: 'POST', token: 'good', body: '{',
    })
    assert.equal(malformed.status, 400)
    assert.equal(
      (malformed.body as { error: { code: string } }).error.code,
      'invalid_json')

    const oversized = await server.fetchJson('/api/keycap-trays', {
      method: 'POST',
      token: 'good',
      body: JSON.stringify({ payload: 'x'.repeat(2 * 1024 * 1024) }),
    })
    assert.equal(oversized.status, 413)
    assert.equal(
      (oversized.body as { error: { code: string } }).error.code,
      'payload_too_large')
  })

  test('repeated admin audit query values are a typed 400', async () => {
    const server = await track(startTestServer({
      label: 'audit-query',
      env: { SHAPEPILOT_ADMIN_OIDS: TEST_OID },
      verifier: stubVerifier({ admin: validClaims() }),
    }))
    const response = await server.fetchJson(
      '/api/admin/audit?category=auth&category=http',
      { token: 'admin' },
    )
    assert.equal(response.status, 400)
    assert.equal(
      (response.body as { error: { code: string } }).error.code,
      'bad_request')
  })

  test('health and version are reachable without a token', async () => {
    const server = await track(startTestServer({ label: 'auth-open', verifier: stubVerifier({}) }))
    for (const path of ['/api/live', '/api/ready', '/api/version', '/version.json']) {
      const response = await server.fetchJson(path)
      assert.ok(response.status === 200 || response.status === 503, `${path} answered ${response.status}`)
    }
  })

  test('admin routes require the admin role, re-read from the database', async () => {
    const server = await track(startTestServer({
      label: 'auth-admin',
      verifier: stubVerifier({
        user: validClaims({ oid: OTHER_OID }),
        admin: validClaims(),
      }),
    }))

    // Both principals start as plain users.
    const denied = await server.fetchJson('/api/admin/health', { token: 'user' })
    assert.equal(denied.status, 403)
    assert.equal((denied.body as { error: { code: string } }).error.code, 'forbidden')

    // Granting the role in the app-local table is what changes the answer.
    await server.repos.memberships.ensure({ owner: { tenantId: TEST_TENANT, oid: TEST_OID } })
    await server.repos.memberships.setRole({ tenantId: TEST_TENANT, oid: TEST_OID }, 'admin')
    const allowed = await server.fetchJson('/api/admin/health', { token: 'admin' })
    assert.equal(allowed.status, 200)

    // Revoking it takes effect immediately, without a new token.
    await server.repos.memberships.setRole({ tenantId: TEST_TENANT, oid: TEST_OID }, 'user')
    const revoked = await server.fetchJson('/api/admin/health', { token: 'admin' })
    assert.equal(revoked.status, 403)
  })

  test('a token role claim cannot grant admin on its own', async () => {
    const server = await track(startTestServer({
      label: 'auth-role-claim',
      verifier: stubVerifier({
        sneaky: validClaims({ roles: [TEST_SCOPE, 'admin', 'Admin', 'GlobalAdministrator'] }),
      }),
    }))
    const response = await server.fetchJson('/api/admin/audit', { token: 'sneaky' })
    assert.equal(response.status, 403)
  })

  test('a bootstrap admin oid is granted admin on first sign-in only', async () => {
    const server = await track(startTestServer({
      label: 'auth-bootstrap',
      env: { SHAPEPILOT_ADMIN_OIDS: TEST_OID },
      verifier: stubVerifier({ admin: validClaims() }),
    }))
    const first = await server.fetchJson('/api/admin/health', { token: 'admin' })
    assert.equal(first.status, 200)

    // Demotion sticks: a later sign-in must not silently re-grant the role.
    await server.repos.memberships.setRole({ tenantId: TEST_TENANT, oid: TEST_OID }, 'user')
    const second = await server.fetchJson('/api/admin/health', { token: 'admin' })
    assert.equal(second.status, 403)
  })

  test('an admin cannot demote themselves out of the app', async () => {
    const server = await track(startTestServer({
      label: 'auth-self-demote',
      env: { SHAPEPILOT_ADMIN_OIDS: TEST_OID },
      verifier: stubVerifier({ admin: validClaims() }),
    }))
    const response = await server.fetchJson(
      `/api/admin/members/${TEST_TENANT}/${TEST_OID}/role`, {
        method: 'PUT', token: 'admin', body: JSON.stringify({ role: 'user' }),
      })
    assert.equal(response.status, 409)
  })

  test('an unmatched API path is a typed 404 rather than the SPA shell', async () => {
    const server = await track(startTestServer({ label: 'auth-404', verifier: stubVerifier({}) }))
    const response = await server.fetchJson('/api/does-not-exist')
    assert.equal(response.status, 404)
    assert.equal((response.body as { error: { code: string } }).error.code, 'not_found')
  })
})

describe('development bypass', () => {
  test('it is refused outright when NODE_ENV=production', () => {
    assert.throws(
      () => loadConfig({
        NODE_ENV: 'production',
        SHAPEPILOT_DEV_AUTH: '1',
        SHAPEPILOT_ENTRA_TENANT_ID: TEST_TENANT,
        SHAPEPILOT_API_AUDIENCE: TEST_AUDIENCE,
      }),
      (error: unknown) => error instanceof ConfigError
        && error.code === 'DEV_AUTH_FORBIDDEN_IN_PRODUCTION')
  })

  test('it is off unless explicitly enabled', () => {
    assert.equal(loadConfig({
      NODE_ENV: 'development',
      SHAPEPILOT_ENTRA_TENANT_ID: TEST_TENANT,
      SHAPEPILOT_API_AUDIENCE: TEST_AUDIENCE,
    }).auth.devBypass.enabled, false)
  })

  test('when enabled it authenticates a fixed local principal', async () => {
    const server = await startTestServer({
      label: 'dev-auth',
      env: { NODE_ENV: 'development', SHAPEPILOT_DEV_AUTH: '1' },
      verifier: stubVerifier({}),
    })
    try {
      const response = await server.fetchJson<{ profile: { authSource: string; role: string } }>(
        '/api/settings')
      assert.equal(response.status, 200)
      assert.equal(response.body.profile.authSource, 'development')
      assert.equal(response.body.profile.role, 'admin')
    } finally {
      await server.close()
    }
  })

  test('a presented bearer token is still verified even with the bypass on', async () => {
    const server = await startTestServer({
      label: 'dev-auth-token',
      env: { NODE_ENV: 'development', SHAPEPILOT_DEV_AUTH: '1' },
      verifier: stubVerifier({}),
    })
    try {
      const response = await server.fetchJson('/api/keycap-trays', { token: 'garbage' })
      assert.equal(response.status, 401)
    } finally {
      await server.close()
    }
  })
})
