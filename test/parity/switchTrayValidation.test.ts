// Switch tray write validation.
//
// A switch tray stores no cell list -- the layout is generated from these
// parameters -- so a bad pitch or margin is not a bad row, it is a planner that
// never terminates. Every field is therefore bounded, every object refuses keys
// it does not know, and the whole payload is rebuilt rather than passed through.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, test } from 'vitest'
import { startTestServer, stubVerifier, validClaims } from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'
import { LIMITS, validateCloneRequest, validateSwitchTrayInput } from '../../server/validation/switchTray.ts'
import { KNOWN_PRESET_PROFILE_IDS } from '../../server/validation/trayProfile.ts'
import { ApiError } from '../../server/errors/ApiError.ts'
import { SWITCH_PROFILES } from '../../src/features/switch-tray/model/switches.ts'

const TOKEN = 'switch-validation-token'

const mx = {
  id: 'mx',
  label: 'Cherry MX',
  bodyMm: 14,
  housingMm: 15.6,
  flangeToTopMm: 11.6,
  flangeToTipMm: 8.3,
  clipPlateMm: 1.5,
  standardPitchMm: 19.05,
  minPitchMm: 16,
  source: 'Cherry MX1A drawing',
}

const design = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Valid switch tray',
  profile: { kind: 'preset', id: 'systainer-s76-plain' },
  switch: mx,
  plate: {
    retention: 'shelf', shelfMm: 1.6, recessMm: 2,
    holeClearanceMm: 0.2, recessClearanceMm: 0.3, cornerRadiusMm: 0.5,
  },
  fill: {
    pitchXMm: 17.1, pitchYMm: 17.1, marginMm: 3,
    stagger: 'none', origin: 'maximised', spreadEvenly: true,
  },
  feet: { heightMm: 16.8, sizeMm: 12, pattern: 'corners' },
  ...over,
})

const rejects = (body: Record<string, unknown>, field: string): void => {
  try {
    validateSwitchTrayInput(body)
    assert.fail(`expected a 400 on ${field}`)
  } catch (error) {
    assert.ok(error instanceof ApiError, `${field} threw ${String(error)}`)
    assert.equal(error.status, 400)
    assert.equal((error.details as { field?: string } | undefined)?.field, field)
  }
}

describe('switch tray validation', () => {
  test('a well-formed design is accepted and rebuilt', () => {
    const input = validateSwitchTrayInput(design())
    assert.equal(input.name, 'Valid switch tray')
    assert.deepEqual(input.profile, { kind: 'preset', id: 'systainer-s76-plain' })
    assert.deepEqual(input.switch, mx)
    // Absent optionals are normalised to null so an update really clears them.
    assert.equal(input.nameplate, null)
    assert.equal(input.skippedCells, null)
    assert.equal(input.caseClearHeightMm, null)
  })

  test('a name is required', () => {
    rejects(design({ name: '   ' }), 'name')
    rejects(design({ name: 42 }), 'name')
  })

  test('unknown keys are refused rather than dropped', () => {
    rejects(design({ colour: 'red' }), 'body.colour')
    rejects(design({ plate: { ...(design().plate as object), sneak: 1 } }), 'plate.sneak')
    rejects(design({ fill: { ...(design().fill as object), sneak: 1 } }), 'fill.sneak')
    rejects(design({ switch: { ...mx, sneak: 1 } }), 'switch.sneak')
    rejects(design({ feet: { heightMm: 5, sizeMm: 8, pattern: 'corners', sneak: 1 } }), 'feet.sneak')
  })

  test('the round trip of a saved design is accepted', () => {
    // The client PUTs back whole records, server-owned fields and all. Refusing
    // those would make saving an opened tray a 400.
    const saved = design({
      id: '7', createdAt: '2026-01-01 00:00:00', updatedAt: '2026-01-01 00:00:00', revision: 12,
    })
    assert.doesNotThrow(() => validateSwitchTrayInput(saved))
  })

  test('enums only accept what the client can produce', () => {
    rejects(design({ plate: { ...(design().plate as object), retention: 'glue' } }), 'plate.retention')
    rejects(design({ fill: { ...(design().fill as object), stagger: 'diagonal' } }), 'fill.stagger')
    rejects(design({ fill: { ...(design().fill as object), origin: 'wherever' } }), 'fill.origin')
    rejects(design({ feet: { heightMm: 5, sizeMm: 8, pattern: 'random' } }), 'feet.pattern')
    rejects(design({ profile: { kind: 'preset', id: 'systainer-s99' } }), 'profile.id')
  })

  test('a pitch that would hang the planner is refused, not clamped', () => {
    const fill = design().fill as Record<string, unknown>
    rejects(design({ fill: { ...fill, pitchXMm: 0 } }), 'fill.pitchXMm')
    rejects(design({ fill: { ...fill, pitchYMm: -5 } }), 'fill.pitchYMm')
    rejects(design({ fill: { ...fill, pitchXMm: LIMITS.maxPitchMm + 1 } }), 'fill.pitchXMm')
    rejects(design({ fill: { ...fill, pitchXMm: Number.NaN } }), 'fill.pitchXMm')
    rejects(design({ fill: { ...fill, pitchXMm: Number.POSITIVE_INFINITY } }), 'fill.pitchXMm')
    // A numeric string is refused rather than coerced -- SQLite would store it.
    rejects(design({ fill: { ...fill, pitchXMm: '17.1' } }), 'fill.pitchXMm')
    rejects(design({ fill: { ...fill, marginMm: -1 } }), 'fill.marginMm')
  })

  test('switch dimensions are bounded and finite', () => {
    rejects(design({ switch: { ...mx, bodyMm: 0 } }), 'switch.bodyMm')
    rejects(design({ switch: { ...mx, housingMm: 1e9 } }), 'switch.housingMm')
    rejects(design({ switch: { ...mx, flangeToTopMm: Number.NaN } }), 'switch.flangeToTopMm')
  })

  test('a skipped cell has to look like a cell', () => {
    rejects(design({ skippedCells: 'all of them' }), 'skippedCells')
    rejects(design({ skippedCells: ['3'] }), 'skippedCells[0]')
    rejects(design({ skippedCells: ['3,4,5'] }), 'skippedCells[0]')
    rejects(design({ skippedCells: [{ col: 3, row: 4 }] }), 'skippedCells[0]')
    rejects(
      design({ skippedCells: Array.from({ length: LIMITS.maxSkippedCells + 1 }, (_, i) => `${i},0`) }),
      'skippedCells')
    const ok = validateSwitchTrayInput(design({ skippedCells: ['3,4', '3,4', '-1,0'] }))
    assert.deepEqual(ok.skippedCells, ['3,4', '-1,0'])
  })

  test('a custom outline goes through the same geometry rules as a keycap tray', () => {
    // Self-intersecting ring: the shared validator's job, reached from here too.
    rejects(design({
      profile: { kind: 'custom', rings: [[[[0, 0], [10, 10], [10, 0], [0, 10]]]] },
    }), 'profile.rings[0][0]')
    assert.doesNotThrow(() => validateSwitchTrayInput(design({
      profile: { kind: 'custom', rings: [[[[0, 0], [100, 0], [100, 60], [0, 60]]]] },
    })))
  })

  test('clone only accepts a name', () => {
    assert.deepEqual(validateCloneRequest({}), {})
    assert.deepEqual(validateCloneRequest({ name: 'Copy' }), { name: 'Copy' })
    assert.deepEqual(validateCloneRequest({ name: '  ' }), {})
    try {
      validateCloneRequest({ projectId: '3' })
      assert.fail('expected a 400')
    } catch (error) {
      assert.ok(error instanceof ApiError)
      assert.equal(error.status, 400)
    }
  })

  test('the accepted preset ids are exactly the ones the client ships', () => {
    // Read as text rather than imported: the browser bundle and the server are
    // separate TypeScript projects, and this file is in the server one.
    const source = readFileSync('src/model/trayProfileData.ts', 'utf8')
    const shipped = [...source.matchAll(/"id":\s*"([^"]+)"/g)].map(match => match[1])
    assert.deepEqual(shipped.sort(), [...KNOWN_PRESET_PROFILE_IDS].sort())
  })

  test('every switch profile the client ships passes validation', () => {
    for (const profile of SWITCH_PROFILES) {
      assert.doesNotThrow(
        () => validateSwitchTrayInput(design({ switch: profile })), profile.id)
    }
  })
})

describe('switch tray validation over HTTP', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startTestServer({
      label: 'switch-validation',
      verifier: stubVerifier({ [TOKEN]: validClaims() }),
    })
  })

  afterAll(async () => { await server.close() })

  const post = (body: unknown) =>
    server.fetchJson<{ error: { code: string; message: string; details?: { field?: string } } }>(
      '/api/switch-trays', { method: 'POST', token: TOKEN, body: JSON.stringify(body) })

  test('a rejected body is a typed 400 naming the field, and writes nothing', async () => {
    const before = await server.fetchJson<unknown[]>('/api/switch-trays', { token: TOKEN })
    const bad = await post(design({ fill: { ...(design().fill as object), pitchXMm: 0 } }))
    assert.equal(bad.status, 400)
    assert.equal(bad.body.error.code, 'bad_request')
    assert.equal(bad.body.error.details?.field, 'fill.pitchXMm')
    const after = await server.fetchJson<unknown[]>('/api/switch-trays', { token: TOKEN })
    assert.equal(after.body.length, before.body.length)
  })

  test('an empty body is a 400 on name, not a 500', async () => {
    const empty = await post({})
    assert.equal(empty.status, 400)
    assert.equal(empty.body.error.details?.field, 'name')
  })
})
