// Runtime validation of the keycap tray write routes.
//
// Table-driven: every row is a payload that must be refused with a typed 400
// naming the offending field, and the database must be byte-identical
// afterwards — same row counts, same rows, same sequences. The valid cases at
// the end pin the behaviour that must *not* change, including `shape` and the
// `mirror_x` mirror/flip bitfield surviving a save/load round-trip.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, test } from 'vitest'
import {
  TEST_OID, TEST_TENANT, startTestServer, stubVerifier, validClaims,
} from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'
import {
  KNOWN_PRESET_PROFILE_IDS, LIMITS, validateCloneRequest, validateLibraryPocketInput,
  validateTrayDesignInput,
} from '../../server/validation/keycapTray.ts'
import { ApiError } from '../../server/errors/ApiError.ts'

const TOKEN = 'validation-token'

const sizing = {
  pitch: 19.05, widthOffset: -0.45, height: 18.6, cornerRadius: 2, cornerSegments: 16,
}

const design = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Valid tray',
  profile: { kind: 'preset', id: 'systainer-s76-notched' },
  sizing,
  floorThicknessMm: 2.4,
  pocketDepthMm: 10,
  engraveDepthMm: 0.4,
  pockets: [{ id: 'a', units: 1, x: 10, y: 10, label: '1u' }],
  ...over,
})

const pocketDesign = (pocket: Record<string, unknown>): Record<string, unknown> =>
  design({ pockets: [{ units: 1, x: 1, y: 1, ...pocket }] })

const square = [[[[0, 0], [10, 0], [10, 10], [0, 10]]]]

interface ErrorBody { error: { code: string; message: string; details?: { field?: string } } }

describe('keycap tray write validation', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startTestServer({
      label: 'validation',
      verifier: stubVerifier({ [TOKEN]: validClaims() }),
    })
  })

  afterAll(async () => { await server.close() })

  /**
   * Everything a keycap write could disturb, in one comparable value. The audit
   * table is deliberately out of scope: a refused request is *supposed* to be
   * audited, and that write is asynchronous.
   */
  const snapshot = (): string => {
    const handle = server.database.handle
    const dump = (sql: string): unknown[] => handle.prepare(sql).all()
    return JSON.stringify({
      designs: dump('SELECT * FROM keycap_tray_designs ORDER BY id'),
      pockets: dump('SELECT * FROM keycap_tray_pockets ORDER BY id'),
      library: dump('SELECT * FROM keycap_pocket_library ORDER BY id'),
      sequences: dump(
        "SELECT name, seq FROM sqlite_sequence WHERE name LIKE 'keycap%' ORDER BY name"),
    })
  }

  const send = async (
    path: string, method: string, body: unknown,
  ): Promise<{ status: number; body: ErrorBody }> =>
    server.fetchJson<ErrorBody>(path, { method, token: TOKEN, body: JSON.stringify(body) })

  /**
   * `JSON.stringify` turns Infinity into `null`, so a non-finite number can
   * only be put on the wire as raw text. This is how a hostile client would
   * send one.
   */
  const sendRaw = async (
    path: string, method: string, body: string,
  ): Promise<{ status: number; body: ErrorBody }> =>
    server.fetchJson<ErrorBody>(path, { method, token: TOKEN, body })

  const refuses = async (
    label: string, path: string, method: string, body: unknown, field?: string,
  ): Promise<void> => {
    const before = snapshot()
    const response = await send(path, method, body)
    assert.equal(response.status, 400, `${label} must be a 400 (was ${response.status})`)
    assert.equal(response.body.error.code, 'bad_request', label)
    if (field) {
      assert.equal(response.body.error.details?.field, field, `${label} field`)
    }
    assert.equal(snapshot(), before, `${label} must not change the database`)
  }

  test('the shape of the body itself is checked', async () => {
    await refuses('an array body', '/api/keycap-trays', 'POST', [], 'body')

    // A scalar is not a JSON *document* the body parser will accept at all; it
    // is still a typed 400 and still changes nothing.
    for (const raw of ['"a string"', '42', 'true', 'null']) {
      const before = snapshot()
      const response = await sendRaw('/api/keycap-trays', 'POST', raw)
      assert.equal(response.status, 400, `body ${raw}`)
      assert.ok(
        ['bad_request', 'invalid_json'].includes(response.body.error.code),
        `body ${raw} code ${response.body.error.code}`)
      assert.equal(snapshot(), before, `body ${raw} must not change the database`)
    }
  })

  test('non-finite numbers are refused wherever they appear', async () => {
    const preset = '"profile":{"kind":"preset","id":"systainer-s76-notched"}'
    const cases: [string, string, string, string][] = [
      ['infinite rect width', '/api/keycap-trays',
        '{"name":"inf","profile":{"kind":"rect","widthMm":1e999,"heightMm":100}}',
        'profile.widthMm'],
      ['infinite pocket depth', '/api/keycap-trays',
        `{"name":"inf",${preset},"pocketDepthMm":1e999}`, 'pocketDepthMm'],
      ['negative infinite floor', '/api/keycap-trays',
        `{"name":"inf",${preset},"floorThicknessMm":-1e999}`, 'floorThicknessMm'],
      ['infinite pocket coordinate', '/api/keycap-trays',
        `{"name":"inf",${preset},"pockets":[{"units":1,"x":-1e999,"y":0}]}`, 'pockets[0].x'],
      ['infinite sizing pitch', '/api/keycap-trays',
        `{"name":"inf",${preset},"sizing":{"pitch":1e999,"widthOffset":0,"height":18.6,`
        + '"cornerRadius":2,"cornerSegments":16}}', 'sizing.pitch'],
      ['infinite custom coordinate', '/api/keycap-trays',
        '{"name":"inf","profile":{"kind":"custom","rings":[[[[1e999,0],[10,0],[0,10]]]]}}',
        'profile.rings[0][0][0][0]'],
      ['infinite library units', '/api/keycap-trays/library/pockets',
        '{"name":"inf","units":1e999}', 'units'],
      ['infinite library width', '/api/keycap-trays/library/pockets',
        '{"name":"inf","widthMm":1e999}', 'widthMm'],
    ]

    for (const [label, path, raw, field] of cases) {
      const before = snapshot()
      const response = await sendRaw(path, 'POST', raw)
      assert.equal(response.status, 400, `${label} (was ${response.status})`)
      assert.equal(response.body.error.details?.field, field, label)
      assert.equal(snapshot(), before, `${label} must not change the database`)
    }
  })

  const DESIGN_CASES: [string, Record<string, unknown>, string][] = [
    ['missing name', design({ name: undefined }), 'name'],
    ['blank name', design({ name: '   ' }), 'name'],
    ['numeric name', design({ name: 12 }), 'name'],
    ['oversized name', design({ name: 'x'.repeat(LIMITS.nameMaxLength + 1) }), 'name'],
    ['unknown top-level key', design({ revision: 3 }), 'body.revision'],
    ['numeric notes', design({ notes: 7 }), 'notes'],
    ['oversized notes', design({ notes: 'n'.repeat(LIMITS.notesMaxLength + 1) }), 'notes'],

    ['missing profile', design({ profile: undefined }), 'profile'],
    ['array profile', design({ profile: [] }), 'profile'],
    ['missing profile kind', design({ profile: {} }), 'profile.kind'],
    ['unknown profile kind', design({ profile: { kind: 'hexagon' } }), 'profile.kind'],
    ['unknown preset id', design({ profile: { kind: 'preset', id: 'systainer-s99' } }), 'profile.id'],
    ['preset with extra keys',
      design({ profile: { kind: 'preset', id: 'systainer-s76-plain', widthMm: 10 } }),
      'profile.widthMm'],

    ['rect without width', design({ profile: { kind: 'rect', heightMm: 100 } }), 'profile.widthMm'],
    ['rect with string width',
      design({ profile: { kind: 'rect', widthMm: '248', heightMm: 156 } }), 'profile.widthMm'],
    ['rect with zero width',
      design({ profile: { kind: 'rect', widthMm: 0, heightMm: 156 } }), 'profile.widthMm'],
    ['rect with negative height',
      design({ profile: { kind: 'rect', widthMm: 248, heightMm: -1 } }), 'profile.heightMm'],
    ['rect with a null width',
      design({ profile: { kind: 'rect', widthMm: null, heightMm: 156 } }), 'profile.widthMm'],
    ['rect beyond the extent bound',
      design({ profile: { kind: 'rect', widthMm: LIMITS.maxExtentMm + 1, heightMm: 156 } }),
      'profile.widthMm'],
    ['rect with a negative corner radius',
      design({ profile: { kind: 'rect', widthMm: 248, heightMm: 156, cornerRadiusMm: -1 } }),
      'profile.cornerRadiusMm'],

    ['custom without rings', design({ profile: { kind: 'custom' } }), 'profile.rings'],
    ['custom with rings as an object',
      design({ profile: { kind: 'custom', rings: {} } }), 'profile.rings'],
    ['custom with no polygons', design({ profile: { kind: 'custom', rings: [] } }), 'profile.rings'],
    ['custom with an empty polygon',
      design({ profile: { kind: 'custom', rings: [[]] } }), 'profile.rings[0]'],
    ['custom with a two-point ring',
      design({ profile: { kind: 'custom', rings: [[[[0, 0], [1, 1]]]] } }), 'profile.rings[0][0]'],
    ['custom with a degenerate ring',
      design({ profile: { kind: 'custom', rings: [[[[0, 0], [0, 0], [0, 0], [0, 0]]]] } }),
      'profile.rings[0][0]'],
    ['custom with a zero-area ring',
      design({ profile: { kind: 'custom', rings: [[[[0, 0], [5, 0], [10, 0]]]] } }),
      'profile.rings[0][0]'],
    ['custom with a self-intersecting ring',
      design({ profile: { kind: 'custom', rings: [[[[0, 0], [4, 4], [0, 4], [3, 0]]]] } }),
      'profile.rings[0][0]'],
    ['custom with a hole outside its outer ring',
      design({
        profile: {
          kind: 'custom',
          rings: [[
            [[0, 0], [10, 0], [10, 10], [0, 10]],
            [[20, 20], [22, 20], [22, 22], [20, 22]],
          ]],
        },
      }),
      'profile.rings[0][1]'],
    ['custom with intersecting holes',
      design({
        profile: {
          kind: 'custom',
          rings: [[
            [[0, 0], [20, 0], [20, 20], [0, 20]],
            [[2, 2], [10, 2], [10, 10], [2, 10]],
            [[8, 8], [16, 8], [16, 16], [8, 16]],
          ]],
        },
      }),
      'profile.rings[0][2]'],
    ['custom with overlapping polygons',
      design({
        profile: {
          kind: 'custom',
          rings: [
            [[[0, 0], [10, 0], [10, 10], [0, 10]]],
            [[[5, 5], [15, 5], [15, 15], [5, 15]]],
          ],
        },
      }),
      'profile.rings'],
    ['custom with a three-number point',
      design({ profile: { kind: 'custom', rings: [[[[0, 0, 0], [10, 0], [0, 10]]]] } }),
      'profile.rings[0][0][0]'],
    ['custom with a string coordinate',
      design({ profile: { kind: 'custom', rings: [[[['0', 0], [10, 0], [0, 10]]]] } }),
      'profile.rings[0][0][0][0]'],
    ['custom with a null coordinate',
      design({ profile: { kind: 'custom', rings: [[[[null, 0], [10, 0], [0, 10]]]] } }),
      'profile.rings[0][0][0][0]'],
    ['custom with an out-of-bounds coordinate',
      design({
        profile: {
          kind: 'custom',
          rings: [[[[LIMITS.maxCoordinateMm + 1, 0], [10, 0], [0, 10]]]],
        },
      }),
      'profile.rings[0][0][0][0]'],
    ['custom with too many polygons',
      design({
        profile: {
          kind: 'custom',
          rings: Array.from({ length: LIMITS.maxPolygons + 1 }, () => square[0]),
        },
      }),
      'profile.rings'],
    ['custom with too many points in one ring',
      design({
        profile: {
          kind: 'custom',
          rings: [[Array.from(
            { length: LIMITS.maxPointsPerRing + 1 },
            (_, index) => [index, index % 2],
          )]],
        },
      }),
      'profile.rings[0][0]'],
    ['custom with a numeric source name',
      design({ profile: { kind: 'custom', rings: square, sourceName: 4 } }),
      'profile.sourceName'],

    ['sizing as an array', design({ sizing: [] }), 'sizing'],
    ['sizing with an unknown key',
      design({ sizing: { ...sizing, tolerance: 0.1 } }), 'sizing.tolerance'],
    ['sizing missing pitch',
      design({ sizing: { ...sizing, pitch: undefined } }), 'sizing.pitch'],
    ['sizing with a string pitch',
      design({ sizing: { ...sizing, pitch: '19.05' } }), 'sizing.pitch'],
    ['sizing with a zero pitch', design({ sizing: { ...sizing, pitch: 0 } }), 'sizing.pitch'],
    ['sizing with a null height',
      design({ sizing: { ...sizing, height: null } }), 'sizing.height'],
    ['sizing with a negative corner radius',
      design({ sizing: { ...sizing, cornerRadius: -0.5 } }), 'sizing.cornerRadius'],
    ['sizing with fractional corner segments',
      design({ sizing: { ...sizing, cornerSegments: 16.5 } }), 'sizing.cornerSegments'],
    ['sizing with zero corner segments',
      design({ sizing: { ...sizing, cornerSegments: 0 } }), 'sizing.cornerSegments'],
    ['sizing with unbounded corner segments',
      design({ sizing: { ...sizing, cornerSegments: LIMITS.maxCornerSegments + 1 } }),
      'sizing.cornerSegments'],
    ['sizing with an unbounded width offset',
      design({ sizing: { ...sizing, widthOffset: LIMITS.maxWidthOffsetMm + 1 } }),
      'sizing.widthOffset'],
    ['sizing that collapses a derived pocket width',
      design({
        sizing: { ...sizing, pitch: 1, widthOffset: -1 },
        pockets: [{ units: 1, x: 0, y: 0 }],
      }),
      'pockets[0].widthMm'],
    ['sizing that collapses a derived multi-unit pocket height',
      design({
        sizing: { ...sizing, pitch: 1, widthOffset: -2, height: 1 },
        pockets: [{ units: 3, heightUnits: 2, x: 0, y: 0 }],
      }),
      'pockets[0].heightMm'],

    ['zero floor thickness', design({ floorThicknessMm: 0 }), 'floorThicknessMm'],
    ['string floor thickness', design({ floorThicknessMm: '2.4' }), 'floorThicknessMm'],
    ['unbounded pocket depth',
      design({ pocketDepthMm: LIMITS.maxDepthMm + 1 }), 'pocketDepthMm'],
    ['negative engrave depth', design({ engraveDepthMm: -0.4 }), 'engraveDepthMm'],

    ['corner spacers with an unknown key',
      design({ cornerSpacers: { heightMm: 7, sizeMm: 10, depthMm: 1 } }), 'cornerSpacers.depthMm'],
    ['corner spacers with zero height',
      design({ cornerSpacers: { heightMm: 0, sizeMm: 10 } }), 'cornerSpacers.heightMm'],
    ['corner spacers with a string size',
      design({ cornerSpacers: { heightMm: 7, sizeMm: '10' } }), 'cornerSpacers.sizeMm'],
    ['corner spacers that are not an object',
      design({ cornerSpacers: 7 }), 'cornerSpacers'],

    ['pockets as an object', design({ pockets: {} }), 'pockets'],
    ['too many pockets',
      design({
        pockets: Array.from({ length: LIMITS.maxPockets + 1 }, () => ({ units: 1, x: 0, y: 0 })),
      }),
      'pockets'],
    ['a pocket that is not an object', design({ pockets: [42] }), 'pockets[0]'],
    ['a pocket with an unknown key',
      pocketDesign({ nope: true }), 'pockets[0].nope'],
    ['a pocket without units', pocketDesign({ units: undefined }), 'pockets[0].units'],
    ['a pocket with string units', pocketDesign({ units: '1' }), 'pockets[0].units'],
    ['a pocket with zero units', pocketDesign({ units: 0 }), 'pockets[0].units'],
    ['a pocket with unbounded units',
      pocketDesign({ units: LIMITS.maxUnits + 1 }), 'pockets[0].units'],
    ['a pocket with zero height units',
      pocketDesign({ heightUnits: 0 }), 'pockets[0].heightUnits'],
    ['a pocket without x', pocketDesign({ x: undefined }), 'pockets[0].x'],
    ['a pocket with a null x', pocketDesign({ x: null }), 'pockets[0].x'],
    ['a pocket with an out-of-bounds y',
      pocketDesign({ y: LIMITS.maxCoordinateMm + 1 }), 'pockets[0].y'],
    ['a pocket rotated a full turn', pocketDesign({ rotationDeg: 360 }), 'pockets[0].rotationDeg'],
    ['a pocket rotated negatively', pocketDesign({ rotationDeg: -1 }), 'pockets[0].rotationDeg'],
    ['a pocket rotated by a string', pocketDesign({ rotationDeg: '90' }), 'pockets[0].rotationDeg'],
    ['a pocket with a numeric isThrough', pocketDesign({ isThrough: 1 }), 'pockets[0].isThrough'],
    ['a pocket with a numeric mirrorX', pocketDesign({ mirrorX: 1 }), 'pockets[0].mirrorX'],
    ['a pocket with a string flipY', pocketDesign({ flipY: 'yes' }), 'pockets[0].flipY'],
    ['a pocket with an unknown shape', pocketDesign({ shape: 'circle' }), 'pockets[0].shape'],
    ['a pocket with an unknown label mode',
      pocketDesign({ labelMode: 'shout' }), 'pockets[0].labelMode'],
    ['a pocket with an oversized label',
      pocketDesign({ label: 'l'.repeat(LIMITS.labelMaxLength + 1) }), 'pockets[0].label'],
    ['a pocket with a numeric label', pocketDesign({ label: 5 }), 'pockets[0].label'],
    ['a pocket with a zero depth', pocketDesign({ depthMm: 0 }), 'pockets[0].depthMm'],
    ['a pocket with a negative width', pocketDesign({ widthMm: -1 }), 'pockets[0].widthMm'],
    ['a pocket with an unbounded height',
      pocketDesign({ heightMm: LIMITS.maxExtentMm + 1 }), 'pockets[0].heightMm'],
    ['a pocket with a negative corner radius',
      pocketDesign({ cornerRadiusMm: -0.1 }), 'pockets[0].cornerRadiusMm'],

    ['locating posts with an unknown key',
      pocketDesign({ locatingPosts: { heightMm: 3, outerDiameterMm: 6, boreDiameterMm: 4, blindMm: 1 } }),
      'pockets[0].locatingPosts.blindMm'],
    ['locating posts with a bore not smaller than the post',
      pocketDesign({ locatingPosts: { heightMm: 3, outerDiameterMm: 5, boreDiameterMm: 5 } }),
      'pockets[0].locatingPosts.boreDiameterMm'],
    ['locating posts with a zero height',
      pocketDesign({ locatingPosts: { heightMm: 0, outerDiameterMm: 6, boreDiameterMm: 4 } }),
      'pockets[0].locatingPosts.heightMm'],
    ['locating posts that are not an object',
      pocketDesign({ locatingPosts: 3 }), 'pockets[0].locatingPosts'],
    ['a pocket with an oversized client id',
      pocketDesign({ id: 'i'.repeat(LIMITS.clientIdMaxLength + 1) }), 'pockets[0].id'],
  ]

  test('every invalid design body is a typed 400 that changes nothing', async () => {
    for (const [label, body, field] of DESIGN_CASES) {
      await refuses(label, '/api/keycap-trays', 'POST', body, field)
    }
  })

  test('the same rules apply to update, before the transaction', async () => {
    const created = await server.fetchJson<{ id: string }>('/api/keycap-trays', {
      method: 'POST', token: TOKEN, body: JSON.stringify(design({ name: 'Update target' })),
    })
    assert.equal(created.status, 201)
    const path = `/api/keycap-trays/${created.body.id}`

    for (const [label, body, field] of DESIGN_CASES) {
      await refuses(`update: ${label}`, path, 'PUT', body, field)
    }

    // ...and the design is still exactly what it was.
    const loaded = await server.fetchJson<{ name: string; pockets: unknown[] }>(
      path, { token: TOKEN })
    assert.equal(loaded.body.name, 'Update target')
    assert.equal(loaded.body.pockets.length, 1)
  })

  const LIBRARY_CASES: [string, Record<string, unknown>, string][] = [
    ['missing name', {}, 'name'],
    ['blank name', { name: '  ' }, 'name'],
    ['numeric name', { name: 4 }, 'name'],
    ['unknown key', { name: 'ok', libraryId: 'x' }, 'body.libraryId'],
    ['string units', { name: 'ok', units: '1' }, 'units'],
    ['zero units', { name: 'ok', units: 0 }, 'units'],
    ['negative width', { name: 'ok', widthMm: -1 }, 'widthMm'],
    ['unbounded height', { name: 'ok', heightMm: LIMITS.maxExtentMm + 1 }, 'heightMm'],
    ['negative corner radius', { name: 'ok', cornerRadiusMm: -2 }, 'cornerRadiusMm'],
    ['numeric notes', { name: 'ok', notes: 9 }, 'notes'],
  ]

  test('every invalid library pocket body is a typed 400 that changes nothing', async () => {
    for (const [label, body, field] of LIBRARY_CASES) {
      await refuses(label, '/api/keycap-trays/library/pockets', 'POST', body, field)
    }
  })

  test('the clone body is validated too', async () => {
    const created = await server.fetchJson<{ id: string }>('/api/keycap-trays', {
      method: 'POST', token: TOKEN, body: JSON.stringify(design({ name: 'Clone source' })),
    })
    const path = `/api/keycap-trays/${created.body.id}/clone`
    await refuses('numeric clone name', path, 'POST', { name: 5 }, 'name')
    await refuses('unknown clone key', path, 'POST', { rename: 'x' }, 'body.rename')
  })
})

describe('valid keycap tray behaviour is unchanged', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startTestServer({
      label: 'validation-valid',
      verifier: stubVerifier({ [TOKEN]: validClaims() }),
    })
  })

  afterAll(async () => { await server.close() })

  const create = async (body: Record<string, unknown>) =>
    server.fetchJson<{ id: string }>('/api/keycap-trays', {
      method: 'POST', token: TOKEN, body: JSON.stringify(body),
    })

  test('a full valid design round-trips, including ISO Enter geometry', async () => {
    const created = await create(design({
      name: 'Everything',
      notes: 'a note',
      pockets: [{
        id: 'a', units: 1.5, heightUnits: 2, x: 10.5, y: 20.25, rotationDeg: 90,
        isThrough: true, shape: 'iso-enter', label: 'ISO Enter', labelMode: 'engrave',
        depthMm: 9, widthMm: 14, heightMm: 14, cornerRadiusMm: 1.5,
      }],
    }))
    assert.equal(created.status, 201)

    const loaded = await server.fetchJson<{
      pockets: {
        rotationDeg: number
        isThrough: boolean
        shape?: 'rect' | 'iso-enter'
        labelMode: string
        heightUnits: number
      }[]
    }>(`/api/keycap-trays/${created.body.id}`, { token: TOKEN })
    assert.equal(loaded.body.pockets[0].rotationDeg, 90)
    assert.equal(loaded.body.pockets[0].isThrough, true)
    assert.equal(loaded.body.pockets[0].shape, 'iso-enter')
    assert.equal(loaded.body.pockets[0].labelMode, 'engrave')
    assert.equal(loaded.body.pockets[0].heightUnits, 2)

    // ShapePilot persists the geometry discriminant. This payload sets no
    // mirror/flip flag, so the mirror_x bitfield stays 0.
    const row = server.database.handle.prepare<[string], { shape: string | null; mirror_x: number }>(
      'SELECT shape, mirror_x FROM keycap_tray_pockets WHERE design_id = ?',
    ).get(created.body.id)
    assert.equal(row?.shape, 'iso-enter')
    assert.equal(Number(row?.mirror_x), 0)
  })

  test('free rotation and the mirror/flip bitfield round-trip through storage', async () => {
    const created = await create(design({
      name: 'Transformed',
      pockets: [{
        id: 'm', units: 1, x: 5, y: 5, rotationDeg: 33.5, mirrorX: true, flipY: true,
      }],
    }))
    assert.equal(created.status, 201)

    const loaded = await server.fetchJson<{
      pockets: { rotationDeg: number; mirrorX?: boolean; flipY?: boolean }[]
    }>(`/api/keycap-trays/${created.body.id}`, { token: TOKEN })
    assert.equal(loaded.body.pockets[0].rotationDeg, 33.5)
    assert.equal(loaded.body.pockets[0].mirrorX, true)
    assert.equal(loaded.body.pockets[0].flipY, true)

    const row = server.database.handle.prepare<[string], { rotation_deg: number; mirror_x: number }>(
      'SELECT rotation_deg, mirror_x FROM keycap_tray_pockets WHERE design_id = ?',
    ).get(created.body.id)
    assert.equal(row?.rotation_deg, 33.5)
    assert.equal(Number(row?.mirror_x), 3)
  })

  test('a custom outline is accepted and stored verbatim', async () => {
    const rings = [[[[0, 0], [200, 0], [200, 120], [0, 120]], [[10, 10], [20, 10], [20, 20]]]]
    const created = await create(design({
      name: 'Custom outline',
      profile: { kind: 'custom', rings, sourceName: 'tray.svg' },
    }))
    assert.equal(created.status, 201)

    const loaded = await server.fetchJson<{ profile: Record<string, unknown> }>(
      `/api/keycap-trays/${created.body.id}`, { token: TOKEN })
    assert.deepEqual(loaded.body.profile, { kind: 'custom', rings, sourceName: 'tray.svg' })
  })

  test('a disjoint island inside a polygon hole remains valid', async () => {
    const rings = [
      [
        [[0, 0], [100, 0], [100, 100], [0, 100]],
        [[20, 20], [80, 20], [80, 80], [20, 80]],
      ],
      [
        [[40, 40], [60, 40], [60, 60], [40, 60]],
      ],
    ]
    const created = await create(design({
      name: 'Frame and island',
      profile: { kind: 'custom', rings },
    }))
    assert.equal(created.status, 201)
  })

  test('an absent sizing still stores {} and absent dimensions keep the pinned defaults',
    async () => {
      const created = await create({
        name: 'Minimal',
        profile: { kind: 'rect', widthMm: 248, heightMm: 156 },
      })
      assert.equal(created.status, 201)

      const loaded = await server.fetchJson<{
        name: string
        profile: Record<string, unknown>
        sizing: Record<string, unknown>
        floorThicknessMm: number
        pocketDepthMm: number
        engraveDepthMm: number
        pockets: Record<string, unknown>[]
      }>(`/api/keycap-trays/${created.body.id}`, { token: TOKEN })
      assert.deepEqual(loaded.body.sizing, {})
      assert.equal(loaded.body.floorThicknessMm, 2.4)
      assert.equal(loaded.body.pocketDepthMm, 10)
      assert.equal(loaded.body.engraveDepthMm, 0.4)
      assert.deepEqual(loaded.body.pockets, [])

      const savedAgain = await server.fetchJson(
        `/api/keycap-trays/${created.body.id}`,
        {
          method: 'PUT',
          token: TOKEN,
          body: JSON.stringify({
            name: loaded.body.name,
            profile: loaded.body.profile,
            sizing: loaded.body.sizing,
            floorThicknessMm: loaded.body.floorThicknessMm,
            pocketDepthMm: loaded.body.pocketDepthMm,
            engraveDepthMm: loaded.body.engraveDepthMm,
            pockets: loaded.body.pockets,
          }),
        },
      )
      assert.equal(savedAgain.status, 200)
    })

  test('an engrave depth of zero and a null note are accepted', async () => {
    const created = await create(design({ engraveDepthMm: 0, notes: null }))
    assert.equal(created.status, 201)
    const loaded = await server.fetchJson<{ engraveDepthMm: number; notes?: string }>(
      `/api/keycap-trays/${created.body.id}`, { token: TOKEN })
    assert.equal(loaded.body.engraveDepthMm, 0)
    assert.equal(loaded.body.notes, undefined)
  })

  test('corner spacers round-trip, and null clears them on update', async () => {
    const created = await create(design({ cornerSpacers: { heightMm: 7, sizeMm: 10 } }))
    assert.equal(created.status, 201)

    const loaded = await server.fetchJson<{
      name: string; profile: unknown; cornerSpacers?: { heightMm: number; sizeMm: number }
    }>(`/api/keycap-trays/${created.body.id}`, { token: TOKEN })
    assert.deepEqual(loaded.body.cornerSpacers, { heightMm: 7, sizeMm: 10 })

    const cleared = await server.fetchJson<{ cornerSpacers?: unknown }>(
      `/api/keycap-trays/${created.body.id}`, {
        method: 'PUT', token: TOKEN,
        body: JSON.stringify({ name: loaded.body.name, profile: loaded.body.profile, cornerSpacers: null }),
      })
    assert.equal(cleared.status, 200)
    const reloaded = await server.fetchJson<{ cornerSpacers?: unknown }>(
      `/api/keycap-trays/${created.body.id}`, { token: TOKEN })
    assert.equal(reloaded.body.cornerSpacers, undefined)
  })

  test('a pocket\'s locating posts round-trip, and null clears them on update', async () => {
    const created = await create(pocketDesign({
      id: 'a', units: 5, x: 10, y: 10,
      locatingPosts: { heightMm: 3, outerDiameterMm: 6, boreDiameterMm: 4 },
    }))
    assert.equal(created.status, 201)

    const loaded = await server.fetchJson<{
      name: string; profile: unknown
      pockets: { locatingPosts?: { heightMm: number; outerDiameterMm: number; boreDiameterMm: number } }[]
    }>(`/api/keycap-trays/${created.body.id}`, { token: TOKEN })
    assert.deepEqual(loaded.body.pockets[0].locatingPosts, { heightMm: 3, outerDiameterMm: 6, boreDiameterMm: 4 })

    const clearedPockets = loaded.body.pockets.map(p => ({ ...p, locatingPosts: null }))
    const cleared = await server.fetchJson(
      `/api/keycap-trays/${created.body.id}`, {
        method: 'PUT', token: TOKEN,
        body: JSON.stringify({ name: loaded.body.name, profile: loaded.body.profile, pockets: clearedPockets }),
      })
    assert.equal(cleared.status, 200)
    const reloaded = await server.fetchJson<{ pockets: { locatingPosts?: unknown }[] }>(
      `/api/keycap-trays/${created.body.id}`, { token: TOKEN })
    assert.equal(reloaded.body.pockets[0].locatingPosts, undefined)
  })

  test('a library pocket with only a name keeps the pinned defaults', async () => {
    const created = await server.fetchJson<{ id: string }>(
      '/api/keycap-trays/library/pockets', {
        method: 'POST', token: TOKEN, body: JSON.stringify({ name: 'only a name' }),
      })
    assert.equal(created.status, 201)
    const list = await server.fetchJson<{ name: string; units: number; widthMm?: number }[]>(
      '/api/keycap-trays/library/pockets', { token: TOKEN })
    const stored = list.body.find(pocket => pocket.name === 'only a name')
    assert.equal(stored?.units, 1)
    assert.equal(stored?.widthMm, undefined)
  })
})

describe('validation the wire cannot express', () => {
  const owner = { tenantId: TEST_TENANT, oid: TEST_OID }

  test('NaN and -Infinity are refused', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.throws(
        () => validateTrayDesignInput({
          name: 'NaN tray',
          profile: { kind: 'rect', widthMm: value, heightMm: 100 },
        }),
        (error: unknown) => error instanceof ApiError && error.status === 400
          && (error.details as { field?: string }).field === 'profile.widthMm')
      assert.throws(
        () => validateLibraryPocketInput({ name: 'x', units: value }),
        (error: unknown) => error instanceof ApiError && error.status === 400)
    }
    assert.ok(owner.tenantId)
  })

  test('the cumulative profile point budget is enforced before quadratic topology checks', () => {
    const ring = Array.from({ length: 2_000 }, (_, index) => {
      const angle = index / 2_000 * Math.PI * 2
      return [100 * Math.cos(angle), 100 * Math.sin(angle)]
    })
    assert.throws(
      () => validateTrayDesignInput(design({
        profile: { kind: 'custom', rings: [[ring, ring, ring]] },
      })),
      (error: unknown) => error instanceof ApiError && error.status === 400
        && (error.details as { field?: string }).field === 'profile.rings',
    )
  })

  test('undefined and empty clone names fall back to the pinned default', () => {
    assert.deepEqual(validateCloneRequest({}), {})
    assert.deepEqual(validateCloneRequest({ name: '' }), {})
    assert.deepEqual(validateCloneRequest({ name: 'Copy' }), { name: 'Copy' })
  })

  test('a clone may name a destination project, or null to unassign the copy', () => {
    assert.deepEqual(validateCloneRequest({ projectId: '42' }), { projectId: '42' })
    assert.deepEqual(validateCloneRequest({ projectId: null }), { projectId: null })
    assert.deepEqual(
      validateCloneRequest({ name: 'Copy', projectId: '42' }), { name: 'Copy', projectId: '42' })
    assert.throws(
      () => validateCloneRequest({ projectId: 'not-an-id' }),
      (error: unknown) => error instanceof ApiError
        && (error.details as { field?: string }).field === 'projectId')
    assert.throws(
      () => validateCloneRequest({ rename: 'x' }),
      (error: unknown) => error instanceof ApiError
        && (error.details as { field?: string }).field === 'body.rename')
  })

  test('the accepted preset ids are exactly the ones the client ships', () => {
    // Read as text rather than imported: the browser bundle and the server are
    // separate TypeScript projects, and this file is in the server one.
    const source = readFileSync('src/features/keycap-tray/model/profileData.ts', 'utf8')
    const shipped = [...source.matchAll(/"id":\s*"([^"]+)"/g)].map(match => match[1])
    assert.deepEqual(shipped.sort(), [...KNOWN_PRESET_PROFILE_IDS].sort())
  })
})
