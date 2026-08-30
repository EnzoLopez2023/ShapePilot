// AI route behaviour with a stubbed Foundry client.
//
// The real deployment is not called from the test suite: it costs money per
// run and its answers are not deterministic. What is asserted here is
// everything around the model -- auth, validation, the rate limit, and that a
// bad answer from the model becomes a typed error rather than reaching the
// browser.
import assert from 'node:assert/strict'
import { afterAll, beforeAll, describe, test } from 'vitest'
import { startTestServer, stubVerifier, validClaims } from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'
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
    assert.match(recorded[0].request.input, /Current program/)
    assert.match(recorded[0].request.input, /"id":"body"/)
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
    const input = recorded[0].request.input
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
