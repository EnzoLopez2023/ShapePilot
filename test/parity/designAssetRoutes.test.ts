// Design-asset routes: the bytes behind an imported scene object.
//
// The two properties worth pinning are the ones the design leans on: a content
// hash is not a capability, and a missing asset reads as absent rather than
// breaking anything.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, test } from 'vitest'
import {
  OTHER_OID, startTestServer, stubVerifier, validClaims,
} from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'
import { AssetStoreError, createFilesystemAssetStore } from '../../lib/assets/assetStore.ts'
import type { AssetStore } from '../../lib/assets/assetStore.ts'

const OWNER_TOKEN = 'owner-token'
const OTHER_TOKEN = 'other-token'
const BASE = '/api/design-assets'

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

const CONTENT = Buffer.from('solid not-really-an-stl\nendsolid\n')
const HASH = sha256(CONTENT)

describe('design asset routes', () => {
  let server: TestServer
  let root: string

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'shapepilot-assets-'))
    server = await startTestServer({
      label: 'assets',
      verifier: stubVerifier({
        [OWNER_TOKEN]: validClaims(),
        [OTHER_TOKEN]: validClaims({ oid: OTHER_OID }),
      }),
      assetStore: createFilesystemAssetStore(root),
    })
  })

  afterAll(async () => {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  })

  const put = (hash: string, body: Buffer, token = OWNER_TOKEN, query = 'filename=part.stl&format=stl') =>
    fetch(`${server.baseUrl}${BASE}/${hash}?${query}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      body: new Uint8Array(body),
    })

  const get = (hash: string, token = OWNER_TOKEN) =>
    fetch(`${server.baseUrl}${BASE}/${hash}`, { headers: { authorization: `Bearer ${token}` } })

  test('a store that will not take a write is a typed 503, not a bare 500', async () => {
    // A directory that is not there, a full disk, a mount gone away: an
    // operational state the caller can act on, which must read as neither
    // "the request was wrong" nor an unexplained failure.
    const refuse = (): never => {
      throw new AssetStoreError(
        'ASSET_WRITE_FAILED',
        "could not store the asset: EACCES: permission denied, mkdir '/home/data/assets/t'",
      )
    }
    const brokenStore = {
      description: 'a store that refuses everything',
      put: refuse,
      get: refuse,
    } as unknown as AssetStore

    const broken = await startTestServer({
      label: 'assets-broken-store',
      verifier: stubVerifier({ [OWNER_TOKEN]: validClaims() }),
      assetStore: brokenStore,
    })
    try {
      const bytes = Buffer.from('anything at all')
      const res = await fetch(
        `${broken.baseUrl}${BASE}/${sha256(bytes)}?filename=a.jpg&format=jpeg`, {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${OWNER_TOKEN}`,
            'content-type': 'application/octet-stream',
          },
          body: new Uint8Array(bytes),
        })
      assert.equal(res.status, 503)
      const raw = await res.text()
      const body = JSON.parse(raw) as {
        error: { code: string; message: string; details?: { reason?: string } }
      }
      assert.equal(body.error.code, 'asset_store_unavailable')
      assert.equal(body.error.details?.reason, 'ASSET_WRITE_FAILED')
      // The design is not implicated: assets are deliberately not authoritative.
      assert.match(body.error.message, /the design itself is unaffected/)
      // The store's own message names a directory. A filesystem layout is not
      // the caller's to see; it is logged for an operator instead.
      assert.ok(!raw.includes('/home/data'), 'a filesystem path must not reach the caller')
      assert.ok(!raw.includes('EACCES'), 'the fs error must not reach the caller')
    } finally { await broken.close() }
  })

  test('a photograph is an asset like any other', async () => {
    // Reference photos -- a picture of a keycap set -- share this route with
    // imported geometry: same content addressing, same owner scoping, same
    // deliberate absence from the backup manifest.
    for (const format of ['png', 'jpeg', 'webp']) {
      const bytes = Buffer.from(`pretend ${format} bytes`)
      const hash = sha256(bytes)
      const stored = await put(hash, bytes, OWNER_TOKEN, `filename=set.${format}&format=${format}`)
      assert.equal(stored.status, 201, format)

      const read = await get(hash)
      assert.equal(read.status, 200)
      assert.deepEqual(Buffer.from(await read.arrayBuffer()), bytes)
    }
  })

  test('a format the store does not accept is a typed 400', async () => {
    const bytes = Buffer.from('a movie, probably')
    const res = await put(sha256(bytes), bytes, OWNER_TOKEN, 'filename=a.mp4&format=mp4')
    assert.equal(res.status, 400)
  })

  test('a file round-trips byte for byte', async () => {
    const stored = await put(HASH, CONTENT)
    assert.equal(stored.status, 201)
    const record = await stored.json() as { hash: string; byteLength: number; format: string }
    assert.equal(record.hash, HASH)
    assert.equal(record.byteLength, CONTENT.byteLength)
    assert.equal(record.format, 'stl')

    const fetched = await get(HASH)
    assert.equal(fetched.status, 200)
    assert.equal(fetched.headers.get('content-type'), 'application/octet-stream')
    const bytes = Buffer.from(await fetched.arrayBuffer())
    assert.ok(bytes.equals(CONTENT))
    // Content-addressed, so the bytes behind a hash can never change.
    assert.match(fetched.headers.get('cache-control') ?? '', /immutable/)
  })

  test('re-uploading identical content is idempotent, not a conflict', async () => {
    assert.equal((await put(HASH, CONTENT)).status, 201)
    assert.equal((await put(HASH, CONTENT)).status, 201)
    const list = await (await fetch(`${server.baseUrl}${BASE}`, {
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
    })).json() as { hash: string }[]
    assert.equal(list.filter(a => a.hash === HASH).length, 1)
  })

  test('the body must actually hash to the name it is stored under', async () => {
    // Otherwise the store's addressing would be a lie and the client's cache
    // would serve the wrong file forever.
    const wrong = await put(HASH, Buffer.from('different bytes entirely'))
    assert.equal(wrong.status, 400)
    const body = await wrong.json() as { error: { details?: { field?: string } } }
    assert.equal(body.error.details?.field, 'hash')
  })

  test('a hash is not a capability: another owner cannot read it', async () => {
    await put(HASH, CONTENT)
    // Same hash, same bytes, different account. Knowing the digest reveals
    // nothing, because every lookup is scoped by (tenant_id, oid).
    assert.equal((await get(HASH, OTHER_TOKEN)).status, 404)
    assert.equal((await get(HASH, OWNER_TOKEN)).status, 200)
  })

  test('an owner only lists their own assets', async () => {
    await put(HASH, CONTENT)
    const theirs = await (await fetch(`${server.baseUrl}${BASE}`, {
      headers: { authorization: `Bearer ${OTHER_TOKEN}` },
    })).json() as unknown[]
    assert.deepEqual(theirs, [])
  })

  test('an unknown or malformed hash is a 404, not a crash', async () => {
    assert.equal((await get('0'.repeat(64))).status, 404)
    assert.equal((await get('not-a-hash')).status, 404)
    // Percent-encoded so the traversal actually reaches the route: a literal
    // `../` is collapsed by URL normalisation and never gets here. The route's
    // own hex-digest guard is what refuses it.
    assert.equal((await get('%2e%2e%2f%2e%2e%2fetc%2fpasswd')).status, 404)
  })

  test('metadata without bytes reads as absent', async () => {
    // The real state this models: assets are outside the backup manifest, so a
    // restored database can reference bytes the store no longer holds. The
    // client must see "gone", not a 500.
    const orphan = Buffer.from('will be removed from the store')
    const orphanHash = sha256(orphan)
    assert.equal((await put(orphanHash, orphan)).status, 201)
    rmSync(root, { recursive: true, force: true })
    assert.equal((await get(orphanHash)).status, 404)
  })

  test('a malformed request is a typed 400 naming the field', async () => {
    const cases: [string, string, string][] = [
      ['0'.repeat(63), 'filename=a.stl&format=stl', 'hash'],
      [HASH, 'format=stl', 'filename'],
      [HASH, 'filename=a.stl&format=exe', 'format'],
      [HASH, 'filename=../a.stl&format=stl', 'filename'],
    ]
    for (const [hash, query, field] of cases) {
      const response = await put(hash, CONTENT, OWNER_TOKEN, query)
      assert.equal(response.status, 400, `${query} should be rejected`)
      const body = await response.json() as { error: { details?: { field?: string } } }
      assert.equal(body.error.details?.field, field, query)
    }
  })

  test('an empty body is refused', async () => {
    const empty = Buffer.alloc(0)
    assert.equal((await put(sha256(empty), empty)).status, 400)
  })

  test('every route requires authentication', async () => {
    assert.equal((await fetch(`${server.baseUrl}${BASE}`)).status, 401)
    assert.equal((await fetch(`${server.baseUrl}${BASE}/${HASH}`)).status, 401)
    assert.equal((await fetch(`${server.baseUrl}${BASE}/${HASH}`, {
      method: 'PUT', body: new Uint8Array(CONTENT),
    })).status, 401)
  })
})
