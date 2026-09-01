// AI route behaviour with a stubbed Foundry client.
//
// The real deployment is not called from the test suite: it costs money per
// run and its answers are not deterministic. What is asserted here is
// everything around the model -- auth, validation, the rate limit, and that a
// bad answer from the model becomes a typed error rather than reaching the
// browser.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, test } from 'vitest'
import { startTestServer, stubVerifier, validClaims } from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'
import { createFilesystemAssetStore } from '../../lib/assets/assetStore.ts'
import type { FoundryClient, FoundryRequest } from '../../server/ai/foundryClient.ts'

const TOKEN = 'owner-token'
const BASE = '/api/ai'

const transform = { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] }

const validProgram = {
  version: 1, units: 'mm',
  parts: [{
    id: 'body', name: 'Body', op: 'box',
    params: { widthMm: 20, depthMm: 20, heightMm: 20 }, transform,
  }],
}

interface Recorded { request: FoundryRequest }

/** Answers with whatever text it is given, so a test can hand back a malformed
 *  or unusable program and check how the route reacts. */
function stubClient(text: string, recorded: Recorded[] = []): FoundryClient {
  return {
    deployment: 'stub-deployment',
    async respondJson(request) {
      recorded.push({ request })
      return { text, usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } }
    },
  }
}

const answer = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ ...validProgram, notes: 'made a box', ...over })

/** `input` is a plain string for /shape and structured content for /keycap-set;
 *  the assertions below only care about the text that reached the model. */
const textOf = (request: FoundryRequest): string =>
  typeof request.input === 'string'
    ? request.input
    : request.input
      .flatMap(m => m.content)
      .map(c => (c.type === 'input_text' ? c.text : `[image ${c.image_url.slice(0, 30)}]`))
      .join('\n')

describe('ai routes', () => {
  let server: TestServer
  const recorded: Recorded[] = []

  beforeAll(async () => {
    server = await startTestServer({
      label: 'ai',
      verifier: stubVerifier({ [TOKEN]: validClaims() }),
      aiClient: stubClient(answer(), recorded),
    })
  })

  afterAll(async () => { await server.close() })

  const post = (body: unknown) =>
    server.fetchJson<Record<string, unknown>>(`${BASE}/shape`, {
      method: 'POST', token: TOKEN, body: JSON.stringify(body),
    })

  test('status reports availability without authenticating a model call', async () => {
    const res = await server.fetchJson<{ available: boolean }>(`${BASE}/status`, { token: TOKEN })
    assert.equal(res.status, 200)
    assert.equal(res.body.available, true)
  })

  test('a prompt returns a validated program, notes and usage', async () => {
    recorded.length = 0
    const res = await post({ prompt: 'a small box', context: 'playground' })
    assert.equal(res.status, 200)
    assert.deepEqual(
      (res.body.program as { parts: { id: string }[] }).parts.map(p => p.id), ['body'])
    assert.equal(res.body.notes, 'made a box')
    assert.deepEqual(res.body.usage, { inputTokens: 10, outputTokens: 20, totalTokens: 30 })
  })

  test('a first turn uses the create prompt and a later turn the edit prompt', async () => {
    recorded.length = 0
    await post({ prompt: 'a box' })
    assert.match(recorded[0].request.instructions, /This is a new design/)

    recorded.length = 0
    await post({ prompt: 'add a hole', program: validProgram })
    assert.match(recorded[0].request.instructions, /MODIFYING an existing program/)
    // The current program must reach the model, or an edit cannot be targeted.
    assert.match(textOf(recorded[0].request), /Current program/)
    assert.match(textOf(recorded[0].request), /"id":"body"/)
  })

  test('the bambu context names the machine it is designing for', async () => {
    recorded.length = 0
    await post({ prompt: 'a bracket', context: 'bambu' })
    assert.match(recorded[0].request.instructions, /Bambu Lab X2D/)
    assert.match(recorded[0].request.instructions, /256 x 256 x 260/)
  })

  test('conversation history is passed but bounded', async () => {
    recorded.length = 0
    const history = Array.from({ length: 40 }, (_, i) => ({ role: 'user', text: `turn ${i}` }))
    await post({ prompt: 'continue', history })
    const input = textOf(recorded[0].request)
    assert.match(input, /turn 39/)
    // Only the last 20 turns are sent; the design state itself rides in the
    // program, not the transcript.
    assert.ok(!input.includes('turn 5\n'), 'older turns should be dropped')
  })

  test('the route requires authentication', async () => {
    // Deliberately not via `post`, which always attaches a token.
    const res = await server.fetchJson(`${BASE}/shape`, {
      method: 'POST', body: JSON.stringify({ prompt: 'a box' }),
    })
    assert.equal(res.status, 401)
  })

  test('a malformed request is a typed 400 naming the field', async () => {
    const cases: [unknown, string][] = [
      [{}, 'prompt'],
      [{ prompt: '   ' }, 'prompt'],
      [{ prompt: 'x'.repeat(5_000) }, 'prompt'],
      [{ prompt: 'a', context: 'nope' }, 'context'],
      [{ prompt: 'a', history: 'no' }, 'history'],
      [{ prompt: 'a', rogue: 1 }, 'body'],
    ]
    for (const [body, field] of cases) {
      const res = await post(body)
      assert.equal(res.status, 400, `expected 400 for ${field}`)
      assert.equal(
        (res.body.error as { details?: { field?: string } }).details?.field, field)
    }
  })

  test('an invalid incoming program is refused before the model is called', async () => {
    recorded.length = 0
    const res = await post({
      prompt: 'edit it',
      program: { version: 1, units: 'mm', parts: [{ id: 'a', name: 'A', op: 'box', params: {} }] },
    })
    assert.equal(res.status, 400)
    assert.equal(recorded.length, 0, 'the model must not be billed for an invalid request')
  })

  test('the per-user rate limit is enforced', async () => {
    // 20 per minute; the earlier tests in this file have already spent some, so
    // this only has to prove the cap exists and returns the typed code.
    let limited = false
    for (let i = 0; i < 40; i++) {
      const res = await post({ prompt: `box ${i}` })
      if (res.status === 429) {
        assert.equal((res.body.error as { code: string }).code, 'rate_limited')
        limited = true
        break
      }
    }
    assert.ok(limited, 'expected a 429 within 40 calls')
  })
})

describe('ai routes when the model misbehaves', () => {
  const start = (text: string) => startTestServer({
    label: `ai-bad-${Math.random().toString(36).slice(2, 8)}`,
    verifier: stubVerifier({ [TOKEN]: validClaims() }),
    aiClient: stubClient(text),
  })

  test('non-JSON from the model is a typed 502, not a crash', async () => {
    const server = await start('this is not json')
    try {
      const res = await server.fetchJson<{ error: { code: string } }>(`${BASE}/shape`, {
        method: 'POST', token: TOKEN, body: JSON.stringify({ prompt: 'a box' }),
      })
      assert.equal(res.status, 502)
      assert.equal(res.body.error.code, 'ai_malformed')
    } finally { await server.close() }
  })

  test('a well-formed but unbuildable program is refused, not passed on', async () => {
    // A torus whose tube is larger than its radius self-intersects; the shared
    // validator catches it here so the browser never tries to mesh it.
    const server = await start(JSON.stringify({
      version: 1, units: 'mm', notes: 'bad torus',
      parts: [{
        id: 't', name: 'T', op: 'torus',
        params: { radiusMm: 5, tubeMm: 9 }, transform,
      }],
    }))
    try {
      const res = await server.fetchJson<{ error: { code: string; details?: { field?: string } } }>(
        `${BASE}/shape`, {
          method: 'POST', token: TOKEN, body: JSON.stringify({ prompt: 'a torus' }),
        })
      assert.equal(res.status, 502)
      assert.equal(res.body.error.code, 'ai_invalid_program')
      assert.equal(res.body.error.details?.field, 'program.parts[0].params.tubeMm')
    } finally { await server.close() }
  })
})

describe('ai routes when Foundry is not configured', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startTestServer({
      label: 'ai-off',
      verifier: stubVerifier({ [TOKEN]: validClaims() }),
      aiClient: null,
    })
  })
  afterAll(async () => { await server.close() })

  test('status says unavailable and the app still runs', async () => {
    const res = await server.fetchJson<{ available: boolean }>(`${BASE}/status`, { token: TOKEN })
    assert.equal(res.body.available, false)
  })

  test('a shape request is a typed 503', async () => {
    const res = await server.fetchJson<{ error: { code: string } }>(`${BASE}/shape`, {
      method: 'POST', token: TOKEN, body: JSON.stringify({ prompt: 'a box' }),
    })
    assert.equal(res.status, 503)
    assert.equal(res.body.error.code, 'ai_unavailable')
  })
})


describe('reading a keycap set out of photographs', () => {
  const KEYCAP = `${BASE}/keycap-set`
  const PHOTO = Buffer.from('pretend this is a jpeg; the route never decodes it')
  const PHOTO_HASH = createHash('sha256').update(PHOTO).digest('hex')
  const STL = Buffer.from('solid x\nendsolid\n')
  const STL_HASH = createHash('sha256').update(STL).digest('hex')

  const validSet = {
    setName: 'Olivia', manufacturer: 'GMK', capProfile: 'Cherry', colorway: 'grey and tan',
    notes: 'The bottom row was partly out of frame.',
    items: [
      { legend: 'Esc', units: 1, count: 1, group: 'Modifiers' },
      { units: 1, count: 34, group: 'Alphas' },
      { legend: 'Space', units: 6.25, count: 1 },
    ],
  }

  let server: TestServer
  let root: string
  const seen: Recorded[] = []

  const startWith = async (text: string) => {
    root = mkdtempSync(join(tmpdir(), 'shapepilot-ai-photos-'))
    server = await startTestServer({
      label: `ai-photos-${Math.random().toString(36).slice(2, 8)}`,
      verifier: stubVerifier({ [TOKEN]: validClaims() }),
      aiClient: stubClient(text, seen),
      assetStore: createFilesystemAssetStore(root),
    })
  }

  const stop = async () => {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }

  const upload = (bytes: Buffer, hash: string, format: string, name: string) =>
    fetch(`${server.baseUrl}/api/design-assets/${hash}?filename=${name}&format=${format}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/octet-stream' },
      body: new Uint8Array(bytes),
    })

  const read = (body: unknown) =>
    server.fetchJson<Record<string, unknown>>(KEYCAP, {
      method: 'POST', token: TOKEN, body: JSON.stringify(body),
    })

  test('photos reach the model as images and come back as a proposal', async () => {
    await startWith(JSON.stringify(validSet))
    try {
      seen.length = 0
      await upload(PHOTO, PHOTO_HASH, 'jpeg', 'set.jpg')

      const res = await read({ hashes: [PHOTO_HASH], hint: 'base kit only' })
      assert.equal(res.status, 200)

      const set = res.body.set as { setName: string; items: { source: string }[] }
      assert.equal(set.setName, 'Olivia')
      assert.equal(set.items.length, 3)
      // Marked as read from a photo, so the editor can show which rows are the
      // model's and which the person has since touched.
      assert.ok(set.items.every(i => i.source === 'photo'))
      assert.equal(res.body.notes, 'The bottom row was partly out of frame.')
      assert.deepEqual(res.body.usage, { inputTokens: 10, outputTokens: 20, totalTokens: 30 })

      // The bytes went as an image, not as text, and the hint travelled with them.
      const input = seen[0].request.input
      assert.ok(Array.isArray(input), 'a photo turn must use structured content')
      const parts = input.flatMap(m => m.content)
      assert.equal(parts.filter(p => p.type === 'input_image').length, 1)
      const image = parts.find(p => p.type === 'input_image')
      assert.match(image!.image_url, /^data:image\/jpeg;base64,/)
      assert.match(textOf(seen[0].request), /base kit only/)
    } finally { await stop() }
  })

  test('a photo is only readable by the account that uploaded it', async () => {
    await startWith(JSON.stringify(validSet))
    try {
      // Never uploaded at all: metadata is owner-scoped, so an unknown hash and
      // someone else's hash are the same answer.
      const res = await read({ hashes: ['a'.repeat(64)] })
      assert.equal(res.status, 404)
    } finally { await stop() }
  })

  test('geometry is not a photograph', async () => {
    await startWith(JSON.stringify(validSet))
    try {
      await upload(STL, STL_HASH, 'stl', 'part.stl')
      const res = await read({ hashes: [STL_HASH] })
      assert.equal(res.status, 400)
      assert.match((res.body.error as { message: string }).message, /not an image/)
    } finally { await stop() }
  })

  test('a malformed request is a typed 400 naming the field', async () => {
    await startWith(JSON.stringify(validSet))
    try {
      const cases: [unknown, string][] = [
        [{}, 'hashes'],
        [{ hashes: [] }, 'hashes'],
        [{ hashes: ['nope'] }, 'hashes'],
        [{ hashes: Array.from({ length: 7 }, (_, i) => String(i).repeat(64).slice(0, 64)) },
          'hashes'],
        [{ hashes: ['a'.repeat(64)], hint: 'x'.repeat(600) }, 'hint'],
        [{ hashes: ['a'.repeat(64)], rogue: 1 }, 'body'],
      ]
      for (const [body, field] of cases) {
        const res = await read(body)
        assert.equal(res.status, 400, `expected 400 for ${field}`)
        assert.equal((res.body.error as { details?: { field?: string } }).details?.field, field)
      }
    } finally { await stop() }
  })

  test('the same photo twice is sent once', async () => {
    await startWith(JSON.stringify(validSet))
    try {
      seen.length = 0
      await upload(PHOTO, PHOTO_HASH, 'jpeg', 'set.jpg')
      await read({ hashes: [PHOTO_HASH, PHOTO_HASH] })
      const input = seen[0].request.input
      assert.ok(Array.isArray(input))
      assert.equal(input.flatMap(m => m.content).filter(p => p.type === 'input_image').length, 1)
    } finally { await stop() }
  })

  test('photo reading has its own, much smaller rate limit', async () => {
    await startWith(JSON.stringify(validSet))
    try {
      await upload(PHOTO, PHOTO_HASH, 'jpeg', 'set.jpg')
      const statuses: number[] = []
      for (let i = 0; i < 12; i++) {
        statuses.push((await read({ hashes: [PHOTO_HASH] })).status)
      }
      const limited = statuses.indexOf(429)
      // Six per minute, well inside the twenty a text turn is allowed.
      assert.equal(limited, 6)
    } finally { await stop() }
  })

  test('non-JSON from the model is a typed 502, not a crash', async () => {
    await startWith('this is not json')
    try {
      await upload(PHOTO, PHOTO_HASH, 'jpeg', 'set.jpg')
      const res = await read({ hashes: [PHOTO_HASH] })
      assert.equal(res.status, 502)
      assert.equal((res.body.error as { code: string }).code, 'ai_malformed')
    } finally { await stop() }
  })

  test('a well-formed but impossible inventory is refused, not passed on', async () => {
    // A 6.25u Escape key is valid JSON and valid against the schema. The same
    // validator the PUT route runs is what catches it.
    await startWith(JSON.stringify({
      notes: '', items: [{ legend: 'Esc', units: 1.3, count: 1 }],
    }))
    try {
      await upload(PHOTO, PHOTO_HASH, 'jpeg', 'set.jpg')
      const res = await read({ hashes: [PHOTO_HASH] })
      assert.equal(res.status, 502)
      assert.equal((res.body.error as { code: string }).code, 'ai_invalid_set')
    } finally { await stop() }
  })

  test('the route requires authentication', async () => {
    await startWith(JSON.stringify(validSet))
    try {
      const res = await server.fetchJson(KEYCAP, {
        method: 'POST', body: JSON.stringify({ hashes: ['a'.repeat(64)] }),
      })
      assert.equal(res.status, 401)
    } finally { await stop() }
  })
})

describe('tracing a photo to vector paths', () => {
  const VECTOR = `${BASE}/vector`
  const PHOTO = Buffer.from('pretend this is a jpeg of a logo; the route never decodes it')
  const PHOTO_HASH = createHash('sha256').update(PHOTO).digest('hex')
  const STL = Buffer.from('solid y\nendsolid\n')
  const STL_HASH = createHash('sha256').update(STL).digest('hex')

  const validDrawing = {
    version: 1, units: 'mm', widthMm: 40, heightMm: 30,
    notes: 'Traced the monogram; the caption was too small to keep.',
    paths: [{
      id: 'monogram', name: 'Monogram', fill: '#101010',
      commands: [
        { cmd: 'M', to: [0, 0] },
        { cmd: 'L', to: [20, 0] },
        { cmd: 'C', c1: [24, 4], c2: [24, 10], to: [20, 14] },
        { cmd: 'L', to: [0, 14] },
        { cmd: 'Z' },
      ],
    }],
  }

  let server: TestServer
  let root: string
  const seen: Recorded[] = []

  const startWith = async (text: string) => {
    root = mkdtempSync(join(tmpdir(), 'shapepilot-ai-trace-'))
    server = await startTestServer({
      label: `ai-trace-${Math.random().toString(36).slice(2, 8)}`,
      verifier: stubVerifier({ [TOKEN]: validClaims() }),
      aiClient: stubClient(text, seen),
      assetStore: createFilesystemAssetStore(root),
    })
  }

  const stop = async () => {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }

  const upload = (bytes: Buffer, hash: string, format: string, name: string) =>
    fetch(`${server.baseUrl}/api/design-assets/${hash}?filename=${name}&format=${format}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/octet-stream' },
      body: new Uint8Array(bytes),
    })

  const post = (body: unknown) =>
    server.fetchJson<Record<string, unknown>>(VECTOR, {
      method: 'POST', token: TOKEN, body: JSON.stringify(body),
    })

  test('a photo reaches the model as an image and comes back as a validated drawing', async () => {
    await startWith(JSON.stringify(validDrawing))
    try {
      seen.length = 0
      await upload(PHOTO, PHOTO_HASH, 'jpeg', 'logo.jpg')

      const res = await post({ hashes: [PHOTO_HASH], hint: 'just the monogram' })
      assert.equal(res.status, 200)

      const drawing = res.body.drawing as { paths: { id: string }[]; widthMm: number }
      assert.equal(drawing.paths.length, 1)
      assert.equal(drawing.paths[0].id, 'monogram')
      assert.equal(drawing.widthMm, 40)
      assert.equal(res.body.notes, 'Traced the monogram; the caption was too small to keep.')
      assert.deepEqual(res.body.usage, { inputTokens: 10, outputTokens: 20, totalTokens: 30 })

      const input = seen[0].request.input
      assert.ok(Array.isArray(input), 'a photo turn must use structured content')
      const parts = input.flatMap(m => m.content)
      assert.equal(parts.filter(p => p.type === 'input_image').length, 1)
      assert.match(parts.find(p => p.type === 'input_image')!.image_url, /^data:image\/jpeg;base64,/)
      assert.match(textOf(seen[0].request), /just the monogram/)
    } finally { await stop() }
  })

  test('an unknown hash is a 404, not a leak of another account', async () => {
    await startWith(JSON.stringify(validDrawing))
    try {
      const res = await post({ hashes: ['b'.repeat(64)] })
      assert.equal(res.status, 404)
    } finally { await stop() }
  })

  test('geometry is not a photograph', async () => {
    await startWith(JSON.stringify(validDrawing))
    try {
      await upload(STL, STL_HASH, 'stl', 'part.stl')
      const res = await post({ hashes: [STL_HASH] })
      assert.equal(res.status, 400)
      assert.equal((res.body.error as { details?: { field?: string } }).details?.field, 'hashes')
    } finally { await stop() }
  })

  test('non-JSON from the model is a typed 502, not a crash', async () => {
    await startWith('definitely not json')
    try {
      await upload(PHOTO, PHOTO_HASH, 'jpeg', 'logo.jpg')
      const res = await post({ hashes: [PHOTO_HASH] })
      assert.equal(res.status, 502)
      assert.equal((res.body.error as { code: string }).code, 'ai_malformed')
    } finally { await stop() }
  })

  test('a well-formed but unusable drawing is refused, not passed on', async () => {
    // Valid JSON, valid against the schema, but the first command of a subpath
    // is not M -- the contract validator the browser also runs catches it.
    await startWith(JSON.stringify({
      version: 1, units: 'mm', widthMm: 10, heightMm: 10, notes: '',
      paths: [{ id: 'p', name: 'P', commands: [{ cmd: 'L', to: [1, 1] }] }],
    }))
    try {
      await upload(PHOTO, PHOTO_HASH, 'jpeg', 'logo.jpg')
      const res = await post({ hashes: [PHOTO_HASH] })
      assert.equal(res.status, 502)
      assert.equal((res.body.error as { code: string }).code, 'ai_invalid_drawing')
    } finally { await stop() }
  })

  test('the route requires authentication', async () => {
    await startWith(JSON.stringify(validDrawing))
    try {
      const res = await server.fetchJson(VECTOR, {
        method: 'POST', body: JSON.stringify({ hashes: ['a'.repeat(64)] }),
      })
      assert.equal(res.status, 401)
    } finally { await stop() }
  })
})
