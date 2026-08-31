// Per-designer defaults: how each designer opens before anyone touches it.
//
// Stored in the same preferences blob as theme and units, and normalised by
// the same function on the way in and out -- so a blob written before these
// existed reads back complete, and nothing downstream has to cope with a
// half-populated preferences object.
import assert from 'node:assert/strict'
import { afterAll, beforeAll, describe, test } from 'vitest'
import { startTestServer, stubVerifier, validClaims } from '../helpers/server.ts'
import type { TestServer } from '../helpers/server.ts'
import {
  DEFAULT_DESIGNER_DEFAULTS, normalizePreferences,
} from '../../lib/db/repositories/settings.ts'
import type { AppPreferences } from '../../lib/db/repositories/contracts.ts'

const TOKEN = 'owner-token'

describe('designer defaults', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startTestServer({
      label: 'designer-defaults',
      verifier: stubVerifier({ [TOKEN]: validClaims() }),
    })
  })

  afterAll(async () => { await server.close() })

  test('an account that has never saved anything gets the shipped defaults', async () => {
    const res = await server.fetchJson<{ preferences: AppPreferences }>('/api/settings', {
      token: TOKEN,
    })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.preferences.designerDefaults, DEFAULT_DESIGNER_DEFAULTS)
  })

  test('each designer keeps its own settings, and they round-trip', async () => {
    // The whole point of separate shapes: a snap chosen for the Bambu designer
    // must not become the keycap tray's snap.
    const preferences: AppPreferences = {
      themeMode: 'dark',
      units: 'in',
      reducedMotion: 'system',
      designerDefaults: {
        keycapTray: {
          view: '3d', snapMm: 19.05, gridMm: 2, showLabels: false, showPlate: true,
          showBuffer: true, bufferMm: 3, imperial: true, target: 'cnc',
        },
        shaper: { imperial: true, snapMm: 5, gridMm: 20 },
        bambu: { imperial: false, snapMm: 2, gizmo: 'rotate', addMode: 'hole' },
      },
    }
    const saved = await server.fetchJson<{ preferences: AppPreferences }>('/api/settings', {
      method: 'PUT', token: TOKEN, body: JSON.stringify(preferences),
    })
    assert.equal(saved.status, 200)
    assert.deepEqual(saved.body.preferences.designerDefaults, preferences.designerDefaults)

    const read = await server.fetchJson<{ preferences: AppPreferences }>('/api/settings', {
      token: TOKEN,
    })
    assert.equal(read.body.preferences.designerDefaults.keycapTray.snapMm, 19.05)
    assert.equal(read.body.preferences.designerDefaults.bambu.snapMm, 2)
    assert.equal(read.body.preferences.designerDefaults.shaper.gridMm, 20)
  })

  test('a preferences blob written before these existed reads back complete', () => {
    // The stored shape is a JSON blob and older accounts have one without any
    // designer defaults at all. It must not come back half-populated.
    const older = normalizePreferences({ themeMode: 'dark', units: 'in' })
    assert.deepEqual(older.designerDefaults, DEFAULT_DESIGNER_DEFAULTS)
    assert.equal(older.themeMode, 'dark')
  })

  test('nonsense falls back field by field rather than wholesale', () => {
    const salvaged = normalizePreferences({
      designerDefaults: {
        keycapTray: { view: 'hologram', snapMm: 'fast', gridMm: 2, target: 'cnc' },
        shaper: 'not an object',
        bambu: { gizmo: 'wobble', addMode: 'hole' },
      },
    })
    // The good values survive; only the bad ones fall back.
    assert.equal(salvaged.designerDefaults.keycapTray.gridMm, 2)
    assert.equal(salvaged.designerDefaults.keycapTray.target, 'cnc')
    assert.equal(
      salvaged.designerDefaults.keycapTray.view, DEFAULT_DESIGNER_DEFAULTS.keycapTray.view)
    assert.equal(
      salvaged.designerDefaults.keycapTray.snapMm, DEFAULT_DESIGNER_DEFAULTS.keycapTray.snapMm)
    assert.deepEqual(salvaged.designerDefaults.shaper, DEFAULT_DESIGNER_DEFAULTS.shaper)
    assert.equal(salvaged.designerDefaults.bambu.addMode, 'hole')
    assert.equal(
      salvaged.designerDefaults.bambu.gizmo, DEFAULT_DESIGNER_DEFAULTS.bambu.gizmo)
  })

  test('an out-of-range length is refused, not clamped', () => {
    // Clamping would invent a setting nobody chose and present it back as theirs.
    const salvaged = normalizePreferences({
      designerDefaults: { keycapTray: { snapMm: -1, gridMm: 1e6, bufferMm: Number.NaN } },
    })
    const shipped = DEFAULT_DESIGNER_DEFAULTS.keycapTray
    assert.equal(salvaged.designerDefaults.keycapTray.snapMm, shipped.snapMm)
    assert.equal(salvaged.designerDefaults.keycapTray.gridMm, shipped.gridMm)
    assert.equal(salvaged.designerDefaults.keycapTray.bufferMm, shipped.bufferMm)
  })

  test('one account’s defaults are not another’s', async () => {
    const other = await startTestServer({
      label: 'designer-defaults-other',
      verifier: stubVerifier({ [TOKEN]: validClaims() }),
    })
    try {
      const res = await other.fetchJson<{ preferences: AppPreferences }>('/api/settings', {
        token: TOKEN,
      })
      assert.deepEqual(res.body.preferences.designerDefaults, DEFAULT_DESIGNER_DEFAULTS)
    } finally { await other.close() }
  })
})
