// Throwaway database and in-process server helpers.
//
// Every suite gets its own database file under test/.tmp (never the system temp
// directory, and never the developer's real data path) and its own listening
// socket on an ephemeral port.
import { mkdirSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { openDatabase } from '../../lib/db/connection.ts'
import type { AppDatabase } from '../../lib/db/connection.ts'
import { createRepositories } from '../../lib/db/repositories/index.ts'
import type { Repositories } from '../../lib/db/repositories/contracts.ts'
import { buildIdentity } from '../../lib/lineage/buildIdentity.ts'
import { createApp } from '../../server/app.ts'
import { loadConfig } from '../../server/config.ts'
import type { AppConfig } from '../../server/config.ts'
import type { RawClaims } from '../../server/auth/claims.ts'
import type { TokenVerifier } from '../../server/auth/verifyToken.ts'
import { ApiError } from '../../server/errors/ApiError.ts'

export const TEST_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.tmp')

export const TEST_TENANT = '52188f12-db6b-46c6-88ff-08c802f0ed3b'
export const TEST_OID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
export const OTHER_OID = '11112222-3333-4444-5555-666677778888'
export const TEST_AUDIENCE = 'api://shapepilot-test'
export const TEST_SCOPE = 'access_as_user'

export interface TempDatabase {
  database: AppDatabase
  repos: Repositories
  path: string
  cleanup(): void
}

export function createTempDatabase(label = 'db'): TempDatabase {
  mkdirSync(TEST_ROOT, { recursive: true })
  const path = join(TEST_ROOT, `${label}-${randomUUID()}.db`)
  const database = openDatabase({ path, busyTimeoutMs: 2_000, createIfMissing: true })
  return {
    database,
    repos: createRepositories(database),
    path,
    cleanup() {
      try { database.close() } catch { /* already closed */ }
      rmSync(path, { force: true })
      rmSync(`${path}-journal`, { force: true })
    },
  }
}

export function testEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    SHAPEPILOT_ENTRA_TENANT_ID: TEST_TENANT,
    SHAPEPILOT_API_AUDIENCE: TEST_AUDIENCE,
    SHAPEPILOT_API_SCOPE: TEST_SCOPE,
    SHAPEPILOT_DB_PATH: join(TEST_ROOT, 'unused.db'),
    ...overrides,
  }
}

export const testConfig = (overrides: NodeJS.ProcessEnv = {}): AppConfig =>
  loadConfig(testEnv(overrides))

/**
 * A verifier that returns pre-seeded claims for a token string. An unknown
 * token fails exactly the way the real JWKS verifier does: a typed 401 whose
 * message says nothing about why.
 */
export function stubVerifier(tokens: Record<string, RawClaims | Error>): TokenVerifier {
  return {
    async verify(token: string) {
      const claims = tokens[token]
      if (!claims) throw new ApiError(401, 'unauthorized', 'Invalid or expired sign-in.')
      if (claims instanceof Error) throw claims
      return claims
    },
  }
}

export const validClaims = (overrides: Partial<RawClaims> = {}): RawClaims => ({
  tid: TEST_TENANT,
  oid: TEST_OID,
  scp: TEST_SCOPE,
  name: 'Test Operator',
  preferred_username: 'test@example.invalid',
  ...overrides,
})

export interface TestServer {
  baseUrl: string
  repos: Repositories
  database: AppDatabase
  fetchJson<T>(path: string, init?: RequestInit & { token?: string }): Promise<{
    status: number
    body: T
  }>
  close(): Promise<void>
}

export interface StartServerOptions {
  env?: NodeJS.ProcessEnv
  verifier?: TokenVerifier | null
  label?: string
}

/**
 * Boot the real Express app against a throwaway database on an ephemeral port.
 * Nothing is mocked except the token verifier.
 */
export async function startTestServer(options: StartServerOptions = {}): Promise<TestServer> {
  const temp = createTempDatabase(options.label ?? 'server')
  const config = loadConfig(testEnv({
    ...options.env,
    SHAPEPILOT_DB_PATH: temp.path,
  }))

  const app = createApp({
    config,
    identity: buildIdentity(),
    repos: temp.repos,
    database: () => temp.database,
    lifecycle: () => 'ready',
    verifier: options.verifier ?? null,
    logger: () => { /* suppressed in tests */ },
  })

  const server: Server = await new Promise((resolvePromise, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolvePromise(listening))
    listening.once('error', reject)
  })
  const { port } = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${port}`

  return {
    baseUrl,
    repos: temp.repos,
    database: temp.database,
    async fetchJson<T>(path: string, init: RequestInit & { token?: string } = {}) {
      const headers = new Headers(init.headers)
      if (init.token) headers.set('authorization', `Bearer ${init.token}`)
      if (init.body) headers.set('content-type', 'application/json')
      const response = await fetch(`${baseUrl}${path}`, { ...init, headers })
      const text = await response.text()
      return {
        status: response.status,
        body: (text ? JSON.parse(text) : null) as T,
      }
    },
    async close() {
      await new Promise<void>((done) => server.close(() => done()))
      temp.cleanup()
    },
  }
}
