// Tool tray write validation.
//
// The largest payload of any designer here: a list of pockets, each a list of
// extruded steps, each with a footprint that may be a traced outline. So the
// budgets are not tidiness -- without them one row holds a megabyte, and the
// mesher's band count is driven by the depths in that row, which puts the
// polygon clipper and the T-junction pass in reach of a hostile payload.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, test } from 'vitest'
import { startTestServer, stubVerifier, validClaims } from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'
import { LIMITS, validateCloneRequest, validateToolTrayInput } from '../../server/validation/toolTray.ts'
import { ApiError } from '../../server/errors/ApiError.ts'

const TOKEN = 'tool-validation-token'

const bin = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'p1',
  kind: 'bin',
  x: 20,
  y: 20,
  widthMm: 40,
  heightMm: 30,
  steps: [{ shape: { kind: 'rect', widthMm: 40, heightMm: 30, cornerRadiusMm: 2 }, depthMm: 12 }],
  ...over,
})

const design = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Valid tool tray',
  profile: { kind: 'preset', id: 'systainer-s76-notched' },
  heightMm: 21,
  layerHeightMm: 0.2,
  minFloorMm: 1.6,
  pockets: [bin()],
  feet: { heightMm: 6, sizeMm: 10, pattern: 'corners' },
  undersideReliefs: 'avoid',
  ...over,
})

const rejects = (body: Record<string, unknown>, field: string): void => {
  try {
    validateToolTrayInput(body)
    assert.fail(`expected a 400 on ${field}`)
  } catch (error) {
    assert.ok(error instanceof ApiError, `${field} threw ${String(error)}`)
    assert.equal(error.status, 400)
    assert.equal((error.details as { field?: string } | undefined)?.field, field)
  }
}

describe('tool tray validation', () => {
  test('a well-formed design is accepted and rebuilt', () => {
    const input = validateToolTrayInput(design())
    assert.equal(input.name, 'Valid tool tray')
    assert.equal(input.heightMm, 21)
    assert.equal((input.pockets as unknown[]).length, 1)
    assert.deepEqual(input.profile, { kind: 'preset', id: 'systainer-s76-notched' })
    assert.equal(input.undersideReliefs, 'avoid')
  })

  test('absent optionals come out as null, so an update really clears them', () => {
    const input = validateToolTrayInput(design({ feet: undefined, undersideReliefs: undefined }))
    assert.equal(input.feet, null)
    assert.equal(input.undersideReliefs, null)
    assert.equal(input.caseClearHeightMm, null)
    assert.equal(input.notes, null)
  })

  test('server-owned fields are accepted and ignored, so saving an opened tray is not a 400', () => {
    // The client round-trips whole records. Refusing these would make the
    // second save of any tray fail.
    const input = validateToolTrayInput(design({
      id: '7', createdAt: 'x', updatedAt: 'y', revision: 12,
    }))
    assert.equal(input.name, 'Valid tool tray')
    assert.ok(!Object.hasOwn(input, 'revision'))
  })

  test('an unknown key is refused at every level it can appear', () => {
    rejects(design({ nope: 1 }), 'body.nope')
    rejects(design({ pockets: [bin({ nope: 1 })] }), 'pockets[0].nope')
    rejects(design({ feet: { heightMm: 6, sizeMm: 10, pattern: 'corners', nope: 1 } }), 'feet.nope')
    rejects(design({
      pockets: [bin({ steps: [{ shape: { kind: 'rect', widthMm: 1, heightMm: 1 }, depthMm: 1, nope: 1 }] })],
    }), 'pockets[0].steps[0].nope')
    rejects(design({
      pockets: [bin({ steps: [{ shape: { kind: 'rect', widthMm: 1, heightMm: 1, nope: 1 }, depthMm: 1 }] })],
    }), 'pockets[0].steps[0].shape.nope')
  })

  test('the tray itself is bounded', () => {
    rejects(design({ name: '' }), 'name')
    rejects(design({ heightMm: 0 }), 'heightMm')
    rejects(design({ heightMm: LIMITS.maxHeightMm + 1 }), 'heightMm')
    rejects(design({ layerHeightMm: 0 }), 'layerHeightMm')
    rejects(design({ layerHeightMm: LIMITS.maxLayerMm + 1 }), 'layerHeightMm')
    rejects(design({ minFloorMm: -1 }), 'minFloorMm')
    rejects(design({ caseClearHeightMm: 0 }), 'caseClearHeightMm')
    rejects(design({ undersideReliefs: 'sometimes' }), 'undersideReliefs')
  })

  test('a number is a number, not a coerced string', () => {
    rejects(design({ heightMm: '21' }), 'heightMm')
    rejects(design({ pockets: [bin({ widthMm: '40' })] }), 'pockets[0].widthMm')
  })

  test('a pocket needs an id, a known kind and at least one step', () => {
    rejects(design({ pockets: [bin({ id: undefined })] }), 'pockets[0].id')
    rejects(design({ pockets: [bin({ kind: 'sandwich' })] }), 'pockets[0].kind')
    rejects(design({ pockets: [bin({ steps: [] })] }), 'pockets[0].steps')
    rejects(design({ pockets: 'lots' }), 'pockets')
  })

  test('a step depth of null is a through-cut, not a missing field', () => {
    const input = validateToolTrayInput(design({
      pockets: [bin({ steps: [{ shape: { kind: 'rect', widthMm: 10, heightMm: 10 }, depthMm: null }] })],
    }))
    const steps = (input.pockets as { steps: { depthMm: number | null }[] }[])[0]!.steps
    assert.equal(steps[0]!.depthMm, null)
  })

  test('a step with no depth at all is refused -- null has to be deliberate', () => {
    rejects(design({
      pockets: [bin({ steps: [{ shape: { kind: 'rect', widthMm: 10, heightMm: 10 } }] })],
    }), 'pockets[0].steps[0].depthMm')
  })

  test('every step shape is validated on its own terms', () => {
    const step = (shape: unknown) => design({ pockets: [bin({ steps: [{ shape, depthMm: 5 }] })] })
    assert.doesNotThrow(() => validateToolTrayInput(step({ kind: 'ellipse', rxMm: 8, ryMm: 5 })))
    assert.doesNotThrow(() => validateToolTrayInput(step({ kind: 'polygon', sides: 6, radiusMm: 9 })))
    assert.doesNotThrow(() => validateToolTrayInput(
      step({ kind: 'channel', path: [[0, 0], [20, 0], [20, 10]], widthMm: 4 })))

    rejects(step({ kind: 'blob' }), 'pockets[0].steps[0].shape.kind')
    rejects(step({ kind: 'ellipse', rxMm: 0, ryMm: 5 }), 'pockets[0].steps[0].shape.rxMm')
    rejects(step({ kind: 'polygon', sides: 2, radiusMm: 9 }), 'pockets[0].steps[0].shape.sides')
    rejects(step({ kind: 'channel', path: [[0, 0]], widthMm: 4 }),
      'pockets[0].steps[0].shape.path')
    rejects(step({ kind: 'channel', path: [[0, 0], [1, 'x']], widthMm: 4 }),
      'pockets[0].steps[0].shape.path[1][1]')
  })

  test('finger access is validated when present and optional when not', () => {
    assert.doesNotThrow(() => validateToolTrayInput(design({
      pockets: [bin({ fingerAccess: { style: 'scallop', side: 'left', widthMm: 12, reachMm: 5 } })],
    })))
    rejects(design({
      pockets: [bin({ fingerAccess: { style: 'gouge', side: 'left', widthMm: 12, reachMm: 5 } })],
    }), 'pockets[0].fingerAccess.style')
    rejects(design({
      pockets: [bin({ fingerAccess: { style: 'slot', side: 'sideways', widthMm: 12, reachMm: 5 } })],
    }), 'pockets[0].fingerAccess.side')
  })

  test('booleans are booleans', () => {
    rejects(design({ pockets: [bin({ mirrorX: 'yes' })] }), 'pockets[0].mirrorX')
    rejects(design({
      pockets: [bin({ steps: [{ shape: { kind: 'rect', widthMm: 1, heightMm: 1 }, depthMm: 1, liftOverKeepOut: 1 }] })],
    }), 'pockets[0].steps[0].liftOverKeepOut')
  })

  test('presetId is free text -- an unknown preset must still save', () => {
    // A tray built on a preset a later build has never heard of has to open.
    const input = validateToolTrayInput(design({
      pockets: [bin({ presetId: 'something-from-the-future' })],
    }))
    const first = (input.pockets as { presetId?: string }[])[0]!
    assert.equal(first.presetId, 'something-from-the-future')
  })

  describe('the budgets', () => {
    test('too many pockets is refused', () => {
      const many = Array.from({ length: LIMITS.maxPockets + 1 }, (_, i) => bin({ id: `p${i}` }))
      rejects(design({ pockets: many }), 'pockets')
    })

    test('too many steps in one pocket is refused', () => {
      const steps = Array.from({ length: LIMITS.maxStepsPerPocket + 1 }, () =>
        ({ shape: { kind: 'rect', widthMm: 5, heightMm: 5 }, depthMm: 5 }))
      rejects(design({ pockets: [bin({ steps })] }), 'pockets[0].steps')
    })

    test('one enormous path is refused', () => {
      const path = Array.from({ length: LIMITS.maxPathPoints + 1 }, (_, i) => [i, 0])
      rejects(design({
        pockets: [bin({ steps: [{ shape: { kind: 'channel', path, widthMm: 3 }, depthMm: 5 }] })],
      }), 'pockets[0].steps[0].shape.path')
    })

    test('many merely large paths are refused too -- the point budget is shared', () => {
      // Each path is individually legal; together they are not. Without the
      // shared budget a payload could be arbitrarily large in aggregate.
      const path = Array.from({ length: 500 }, (_, i) => [i, 0])
      const pockets = Array.from({ length: 40 }, (_, i) => bin({
        id: `p${i}`,
        steps: [{ shape: { kind: 'channel', path, widthMm: 3 }, depthMm: 5 }],
      }))
      try {
        validateToolTrayInput(design({ pockets }))
        assert.fail('expected the shared point budget to reject this')
      } catch (error) {
        assert.ok(error instanceof ApiError)
        assert.equal(error.status, 400)
        assert.match(error.message, /points in total/)
      }
    })
  })

  test('the clone body accepts a name and nothing else', () => {
    assert.deepEqual(validateCloneRequest({ name: 'Copy' }), { name: 'Copy' })
    assert.deepEqual(validateCloneRequest({}), {})
    assert.deepEqual(validateCloneRequest({ name: '   ' }), {})
    assert.throws(() => validateCloneRequest({ nope: 1 }))
  })

  test('the design fields the client ships are exactly the ones accepted', () => {
    // Read as text: the browser bundle and the server are separate TypeScript
    // projects and this file is in the server one. A field added to
    // `ToolTrayDesign` without being added here would be an unknown-key 400 the
    // moment anyone saved a tray.
    const source = readFileSync('src/features/tool-tray/model/types.ts', 'utf8')
    const body = source.slice(source.indexOf('export interface ToolTrayDesign {'))
    const shipped = [...body.slice(0, body.indexOf('\n}')).matchAll(/^\s{2}(\w+)\??:/gm)]
      .map(m => m[1])
      .filter(f => f !== 'id' && f !== 'revision')
    for (const field of shipped) {
      assert.doesNotThrow(
        () => validateToolTrayInput(design()),
        `the fixture does not exercise ${field}`)
    }
    assert.deepEqual(shipped.sort(), [
      'caseClearHeightMm', 'feet', 'heightMm', 'layerHeightMm', 'minFloorMm',
      'name', 'notes', 'pockets', 'profile', 'undersideReliefs',
    ])
  })
})

describe('tool tray validation over HTTP', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startTestServer({
      label: 'tool-validation',
      verifier: stubVerifier({ [TOKEN]: validClaims() }),
    })
  })

  afterAll(async () => { await server.close() })

  const post = (body: unknown) =>
    server.fetchJson<{ error: { code: string; message: string; details?: { field?: string } } }>(
      '/api/tool-trays', { method: 'POST', token: TOKEN, body: JSON.stringify(body) })

  test('a rejected body is a typed 400 naming the field, and writes nothing', async () => {
    const before = await server.fetchJson<unknown[]>('/api/tool-trays', { token: TOKEN })
    const bad = await post(design({ heightMm: 0 }))
    assert.equal(bad.status, 400)
    assert.equal(bad.body.error.code, 'bad_request')
    assert.equal(bad.body.error.details?.field, 'heightMm')
    const after = await server.fetchJson<unknown[]>('/api/tool-trays', { token: TOKEN })
    assert.equal(after.body.length, before.body.length)
  })

  test('an empty body is a 400 on name, not a 500', async () => {
    const empty = await post({})
    assert.equal(empty.status, 400)
    assert.equal(empty.body.error.details?.field, 'name')
  })

  test('a nested unknown key names its own path, not just "body"', async () => {
    const bad = await post(design({ pockets: [bin({ nope: 1 })] }))
    assert.equal(bad.status, 400)
    assert.equal(bad.body.error.details?.field, 'pockets[0].nope')
  })
})
