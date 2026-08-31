// Where imported design assets and keycap-set photographs actually live.
//
// This is deliberately NOT the artifact store in lib/recovery. That one exists
// for backup bundles, and its guarantees follow from what recovery needs: an
// fd-pinned root, exclusive publication through renameat2(RENAME_NOREPLACE),
// and an identity check on every step that a file is still the file that was
// written. Those hold on a local disk and do not hold on SMB, where inode
// numbers are synthesized, mode is a fixed representation, and the server
// rewrites timestamps on close -- which is exactly how a keycap photograph
// came to be unstorable on App Service while backups to the same share were
// fine.
//
// Assets never needed any of it. PRODUCT.md and docs/ARCHITECTURE.md both say
// so plainly: they are not authoritative, they sit outside the backup
// manifest, and a missing one degrades to "re-attach this file" rather than
// breaking the document that references it. Giving recovery-grade integrity to
// bytes that are allowed to vanish bought nothing and cost the feature.
//
// So: ordinary path writes, the way workshop.nintek.com and Prism already
// store user files on this same /home mount. Two properties are kept, because
// both earn their place --
//
//   * keys stay content-addressed and owner-scoped, so a hash names bytes and
//     never acts as a bearer token;
//   * idempotence is decided by CONTENT, not by inode identity. Re-uploading a
//     file is an ordinary thing to do, and comparing the stored bytes is the
//     check that survives on a network filesystem.
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'

export class AssetStoreError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'AssetStoreError'
    this.code = code
  }
}

export interface AssetStore {
  readonly description: string
  /** Idempotent by content: identical bytes already present is success. */
  put(key: string, data: Uint8Array): Promise<void>
  /** Throws ASSET_NOT_FOUND when the bytes are not there, which is ordinary. */
  get(key: string): Promise<Uint8Array>
}

const KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** No traversal, no absolute paths, no hidden or staging names. */
export function assertSafeAssetKey(key: string): string {
  if (!key || isAbsolute(key)) {
    throw new AssetStoreError('ASSET_KEY_INVALID', 'asset keys must be relative')
  }
  const segments = normalize(key).split(/[\\/]/)
  for (const segment of segments) {
    if (!KEY_SEGMENT.test(segment)) {
      throw new AssetStoreError('ASSET_KEY_INVALID', `invalid asset key segment "${segment}"`)
    }
  }
  return segments.join('/')
}

const sha256Of = (data: Uint8Array): string =>
  createHash('sha256').update(data).digest('hex')

const isMissing = (cause: unknown): boolean =>
  typeof cause === 'object' && cause !== null && (cause as { code?: string }).code === 'ENOENT'

/**
 * `O_NOFOLLOW` on reads, so a symlink dropped into the tree cannot redirect a
 * read out of it. Creation is already safe: `wx` fails outright on an existing
 * name, symlink included.
 */
async function readIfPresent(path: string): Promise<Uint8Array | null> {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (cause) {
    if (isMissing(cause)) return null
    throw cause
  }
  try {
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

export function createFilesystemAssetStore(root: string): AssetStore {
  const base = resolve(root)

  const pathFor = (key: string): string => {
    const safe = assertSafeAssetKey(key)
    const target = resolve(base, safe)
    // Belt and braces over assertSafeAssetKey: a resolved path that escapes the
    // root is refused even if the key check ever loosens.
    if (target !== base && !target.startsWith(`${base}/`)) {
      throw new AssetStoreError('ASSET_KEY_INVALID', 'asset key escapes the store root')
    }
    return target
  }

  return {
    description: `asset-filesystem:${base}`,

    async put(key, data) {
      const target = pathFor(key)
      try {
        await mkdir(dirname(target), { recursive: true })

        const existing = await readIfPresent(target)
        if (existing) {
          // Content, not inode identity. Re-uploading the same file is
          // ordinary; the same key holding different bytes is not, and says
          // the addressing has been broken rather than that the caller erred.
          if (sha256Of(existing) === sha256Of(data)) return
          throw new AssetStoreError(
            'ASSET_CONTENT_CONFLICT',
            'a different object is already stored under that key',
          )
        }

        // Written under a name nothing else can guess, then moved into place,
        // so a reader never observes a half-written object. A concurrent put of
        // the same key is benign: both are writing identical bytes.
        const staging = `${target}.staging-${randomUUID()}`
        try {
          await writeFile(staging, data, { flag: 'wx', mode: 0o600 })
          await rename(staging, target)
        } finally {
          await rm(staging, { force: true })
        }
      } catch (cause) {
        if (cause instanceof AssetStoreError) throw cause
        throw new AssetStoreError(
          'ASSET_WRITE_FAILED',
          `could not store the asset: ${cause instanceof Error ? cause.message : 'write failed'}`,
        )
      }
    },

    async get(key) {
      const target = pathFor(key)
      const bytes = await readIfPresent(target).catch((cause: unknown) => {
        throw new AssetStoreError(
          'ASSET_READ_FAILED',
          `could not read the asset: ${cause instanceof Error ? cause.message : 'read failed'}`,
        )
      })
      // Absent bytes are an ordinary state: assets are outside the backup
      // manifest and may legitimately be gone.
      if (!bytes) throw new AssetStoreError('ASSET_NOT_FOUND', 'the asset is not stored here')
      return bytes
    },
  }
}

/** The object key for one owner's copy of one content hash. */
export const assetKey = (
  owner: { tenantId: string; oid: string }, hash: string,
): string => join(owner.tenantId, owner.oid, hash)
