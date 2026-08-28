import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SqliteDatabase } from './connection.ts'

const extension = process.platform === 'win32'
  ? 'dll'
  : process.platform === 'darwin'
    ? 'dylib'
    : 'so'
const extensionPath = resolve(
  import.meta.dirname,
  '../../native/build',
  `sqlite-file-identity.${extension}`,
)

export interface ExpectedNativeFileIdentity {
  dev: bigint
  ino: bigint
  size: bigint
}

export class NativeIdentityError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'NativeIdentityError'
    this.code = code
  }
}

export const serializeNativeFileIdentity = (identity: ExpectedNativeFileIdentity): string =>
  `${BigInt.asUintN(64, identity.dev)}:`
  + `${BigInt.asUintN(64, identity.ino)}:`
  + `${BigInt.asUintN(64, identity.size)}`

/**
 * Verify the exact descriptor SQLite opened. The extension performs file-control
 * and fstat from its initializer, so no prepared statement or database read can
 * recover a rollback journal before a mismatched handle is refused.
 */
export function verifyNativeFileIdentity(
  handle: SqliteDatabase,
  expected: ExpectedNativeFileIdentity,
): void {
  if (!existsSync(extensionPath)) {
    throw new NativeIdentityError(
      'NATIVE_IDENTITY_GUARD_MISSING',
      `SQLite file-identity guard is missing at ${extensionPath}; run npm run build:native`,
    )
  }
  const identityKey = 'SHAPEPILOT_EXPECTED_SQLITE_FILE_IDENTITY'
  const pathKey = 'SHAPEPILOT_SQLITE_DATABASE_PATH'
  const previousIdentity = process.env[identityKey]
  const previousPath = process.env[pathKey]
  process.env[identityKey] = serializeNativeFileIdentity(expected)
  process.env[pathKey] = handle.name
  try {
    handle.loadExtension(extensionPath)
  } catch (cause) {
    throw new NativeIdentityError(
      'NATIVE_IDENTITY_MISMATCH',
      `SQLite did not open the preflighted database file: ${
        cause instanceof Error ? cause.message : 'native identity check failed'
      }`,
    )
  } finally {
    if (previousIdentity === undefined) delete process.env[identityKey]
    else process.env[identityKey] = previousIdentity
    if (previousPath === undefined) delete process.env[pathKey]
    else process.env[pathKey] = previousPath
  }
}
