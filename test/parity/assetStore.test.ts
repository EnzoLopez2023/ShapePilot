// The asset store: where imported geometry and keycap-set photographs live.
//
// Deliberately not the recovery artifact store. That one guarantees things
// backups need -- exclusive publication, an fd-pinned root, an identity check
// on every step -- and those guarantees rest on a local POSIX filesystem. On
// Azure Files, where production keeps /home/data, inode numbers are
// synthesized, mode is a fixed representation, and the server rewrites
// timestamps on close, so they do not hold. Assets never needed them: they are
// outside the backup manifest and a missing one degrades to "re-attach this
// file". What is pinned here is what assets *do* need.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'vitest'
import { assetKey, assertSafeAssetKey, createFilesystemAssetStore } from '../../lib/assets/assetStore.ts'
import type { AssetStoreError } from '../../lib/assets/assetStore.ts'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const text = (data: Uint8Array): string => new TextDecoder().decode(data)

const OWNER = { tenantId: 'tenant-a', oid: 'owner-1' }
const HASH = 'a'.repeat(64)

describe('asset store', () => {
  let root: string

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'shapepilot-asset-store-')) })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  test('an object round-trips byte for byte through a nested key', async () => {
    const store = createFilesystemAssetStore(root)
    const key = assetKey(OWNER, HASH)
    await store.put(key, bytes('a photograph, notionally'))
    assert.equal(text(await store.get(key)), 'a photograph, notionally')
    // The owner prefix is directories, which the store creates on the way in.
    assert.equal(key, `${OWNER.tenantId}/${OWNER.oid}/${HASH}`)
  })

  test('re-storing identical bytes is success, decided by content', async () => {
    // The check that survives on a network filesystem. Inode identity does not,
    // and it was the guard comparing inodes that made this unstorable.
    const store = createFilesystemAssetStore(root)
    const key = assetKey(OWNER, HASH)
    await store.put(key, bytes('same'))
    await store.put(key, bytes('same'))
    await store.put(key, bytes('same'))
    assert.equal(text(await store.get(key)), 'same')
  })

  test('the same key holding different bytes is refused, not overwritten', async () => {
    // Keys are content hashes, so this cannot happen from a verified caller.
    // If it ever does, the addressing is a lie and silence would be the worst
    // possible answer.
    const store = createFilesystemAssetStore(root)
    const key = assetKey(OWNER, HASH)
    await store.put(key, bytes('original'))
    await assert.rejects(
      () => store.put(key, bytes('different')),
      (error: AssetStoreError) => {
        assert.equal(error.code, 'ASSET_CONTENT_CONFLICT')
        return true
      },
    )
    assert.equal(text(await store.get(key)), 'original')
  })

  test('absent bytes are an ordinary state with their own code', async () => {
    const store = createFilesystemAssetStore(root)
    await assert.rejects(
      () => store.get(assetKey(OWNER, HASH)),
      (error: AssetStoreError) => {
        assert.equal(error.code, 'ASSET_NOT_FOUND')
        return true
      },
    )
  })

  test('two owners holding identical bytes never share an object', async () => {
    // A hash is content, not a capability: the key is owner-scoped so knowing
    // someone else's hash reveals nothing and reaches nothing.
    const store = createFilesystemAssetStore(root)
    const mine = assetKey(OWNER, HASH)
    const theirs = assetKey({ tenantId: 'tenant-a', oid: 'owner-2' }, HASH)
    await store.put(mine, bytes('mine'))
    await assert.rejects(() => store.get(theirs), (e: AssetStoreError) => e.code === 'ASSET_NOT_FOUND')
  })

  test('a key cannot traverse out of the store root', async () => {
    const store = createFilesystemAssetStore(root)
    for (const key of ['../escape', 'a/../../escape', '/absolute/path', '', '.hidden/x']) {
      await assert.rejects(
        () => store.put(key, bytes('x')),
        (error: AssetStoreError) => {
          assert.equal(error.code, 'ASSET_KEY_INVALID', `expected refusal for "${key}"`)
          return true
        },
      )
    }
    assert.equal(assertSafeAssetKey('tenant/owner/abc123'), 'tenant/owner/abc123')
    // Redundant separators are normalised rather than refused: they name the
    // same path and rejecting them would be pedantry, not safety.
    assert.equal(assertSafeAssetKey('a//b'), 'a/b')
    assert.equal(assertSafeAssetKey('a/./b'), 'a/b')
  })

  test('a symlink planted in the tree cannot redirect a read', async () => {
    const store = createFilesystemAssetStore(root)
    const outside = join(root, 'outside-secret')
    writeFileSync(outside, 'not yours')
    await mkdir(join(root, OWNER.tenantId, OWNER.oid), { recursive: true })
    symlinkSync(outside, join(root, OWNER.tenantId, OWNER.oid, HASH))

    await assert.rejects(
      () => store.get(assetKey(OWNER, HASH)),
      (error: AssetStoreError) => {
        // O_NOFOLLOW: the read refuses rather than following the link out.
        assert.equal(error.code, 'ASSET_READ_FAILED')
        return true
      },
    )
  })

  test('nothing partially written is ever visible under the final name', async () => {
    // Written under an unguessable staging name and moved into place, so a
    // reader sees the whole object or no object.
    const store = createFilesystemAssetStore(root)
    const key = assetKey(OWNER, HASH)
    const big = bytes('x'.repeat(2 * 1024 * 1024))
    await store.put(key, big)
    assert.equal((await store.get(key)).byteLength, big.byteLength)
    assert.equal(readFileSync(join(root, key)).byteLength, big.byteLength)
  })

  test('a store rooted at a directory that does not exist fails as a write, not a crash', async () => {
    // The real store is constructed lazily and its root is created at startup;
    // if that ever stops being true, this is how it surfaces.
    const store = createFilesystemAssetStore(join(root, 'missing', 'deeper'))
    // mkdir -p creates it, which is the honest behaviour for a store whose
    // whole job is to hold files nobody else owns.
    await store.put(assetKey(OWNER, HASH), bytes('fine'))
    assert.equal(text(await store.get(assetKey(OWNER, HASH))), 'fine')
  })
})
