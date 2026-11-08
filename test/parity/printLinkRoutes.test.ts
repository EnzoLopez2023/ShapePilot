// Print links: a signed-in upload becomes a short-lived capability URL that
// Bambu Studio can download without credentials.
import assert from 'node:assert/strict'
import { afterAll, beforeAll, describe, test } from 'vitest'
import { startTestServer, stubVerifier, validClaims } from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'
import { PRINT_LINK_TTL_MS, PrintLinkStore, printLinkFilename } from '../../server/routes/printLinks.ts'

const OWNER = 'owner-token'
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5])

describe('print link routes', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startTestServer({ label: 'print-links', verifier: stubVerifier({ [OWNER]: validClaims() }) })
  })
  afterAll(async () => { await server.close() })

  const upload = (body: Buffer, token = OWNER, name = 'My bin') =>
    fetch(`${server.baseUrl}/api/print-links?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body,
    })

  test('an uploaded 3MF is served to anyone with the link, and nothing else is', async () => {
    const res = await upload(zip)
    assert.equal(res.status, 201)
    const { path } = await res.json() as { path: string }
    assert.match(path, /^\/api\/print-links\/files\/[A-Za-z0-9_-]{43}\/My_bin\.3mf$/)
    const file = await fetch(`${server.baseUrl}${path}`)
    assert.equal(file.status, 200)
    assert.equal(file.headers.get('content-type'), 'model/3mf')
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), zip)
    const guessed = path.replace(/files\/[^/]+/, `files/${'A'.repeat(43)}`)
    assert.equal((await fetch(`${server.baseUrl}${guessed}`)).status, 404)
  })

  test('uploading needs a sign-in and a 3MF', async () => {
    assert.equal((await upload(zip, '')).status, 401)
    assert.equal((await upload(Buffer.from('not a zip'))).status, 400)
    assert.equal((await upload(Buffer.alloc(0))).status, 400)
  })
})

describe('print link store', () => {
  test('links expire and each account keeps only its newest few', () => {
    let now = 0
    const store = new PrintLinkStore(() => now)
    const first = store.put('a', zip, 'x.3mf')
    now = PRINT_LINK_TTL_MS + 1
    assert.equal(store.get(first.token), undefined)
    const tokens = Array.from({ length: 7 }, () => store.put('a', zip, 'x.3mf').token)
    assert.equal(store.size, 5)
    assert.equal(store.get(tokens[0]), undefined)
    assert.ok(store.get(tokens[6]))
  })

  test('filenames are made safe', () => {
    assert.equal(printLinkFilename('../M3 x 8 bin.3mf'), 'M3_x_8_bin.3mf')
    assert.equal(printLinkFilename(undefined), 'model.3mf')
  })
})
