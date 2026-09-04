// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import {
  DEFAULT_VIEW_SETTINGS, forgetViewSettings, loadViewSettings, readViewSettings,
  saveViewSettings,
} from './viewSettings.ts'
import type { ViewSettings } from './viewSettings.ts'

const KEY = 'shapepilot:keycap-tray:view-settings'

afterEach(() => { localStorage.clear() })

const custom: ViewSettings = {
  ...DEFAULT_VIEW_SETTINGS,
  view: '3d',
  snapMm: 19.05,
  gridMm: 2,
  showBuffer: true,
  bufferMm: 3,
  imperial: true,
  target: 'cnc',
  material: 'petg',
}

describe('per-tray view settings', () => {
  test('a tray comes back the way it was being looked at', () => {
    saveViewSettings('7', custom)
    expect(loadViewSettings('7', DEFAULT_VIEW_SETTINGS)).toMatchObject(custom)
  })

  test('a tray nothing is remembered about starts from the baseline', () => {
    expect(loadViewSettings('never-opened', DEFAULT_VIEW_SETTINGS))
      .toEqual(DEFAULT_VIEW_SETTINGS)
  })

  test('trays remember separately', () => {
    saveViewSettings('1', custom)
    saveViewSettings('2', { ...DEFAULT_VIEW_SETTINGS, snapMm: 1 })
    expect(loadViewSettings('1', DEFAULT_VIEW_SETTINGS).snapMm).toBe(19.05)
    expect(loadViewSettings('2', DEFAULT_VIEW_SETTINGS).snapMm).toBe(1)
  })

  test('stored nonsense falls back field by field rather than wholesale', () => {
    // Written by an older release, or by hand. A snap of null would silently
    // stop the canvas snapping, so each field is rebuilt against the baseline.
    const salvaged = readViewSettings(
      { view: 'hologram', snapMm: null, gridMm: 2, showBuffer: 'yes', target: 'cnc' },
      DEFAULT_VIEW_SETTINGS,
    )
    expect(salvaged).toEqual({
      ...DEFAULT_VIEW_SETTINGS,
      gridMm: 2,      // the one good value survives
      target: 'cnc',
    })
  })

  test('an unknown material falls back to the baseline', () => {
    expect(readViewSettings({ material: 'unobtainium' }, DEFAULT_VIEW_SETTINGS).material)
      .toBe(DEFAULT_VIEW_SETTINGS.material)
    expect(readViewSettings({ material: 'petg' }, DEFAULT_VIEW_SETTINGS).material).toBe('petg')
  })

  test('an out-of-range number is refused, not clamped', () => {
    // Clamping would invent a setting nobody chose.
    expect(readViewSettings({ snapMm: -1 }, DEFAULT_VIEW_SETTINGS).snapMm)
      .toBe(DEFAULT_VIEW_SETTINGS.snapMm)
    expect(readViewSettings({ gridMm: 1e9 }, DEFAULT_VIEW_SETTINGS).gridMm)
      .toBe(DEFAULT_VIEW_SETTINGS.gridMm)
    expect(readViewSettings({ snapMm: Number.NaN }, DEFAULT_VIEW_SETTINGS).snapMm)
      .toBe(DEFAULT_VIEW_SETTINGS.snapMm)
  })

  test('a deleted tray is forgotten', () => {
    saveViewSettings('1', custom)
    saveViewSettings('2', custom)
    forgetViewSettings('1')
    const record = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>
    expect(Object.keys(record)).toEqual(['2'])
  })

  test('the record is bounded, dropping the least recently opened', () => {
    // localStorage is a shared, bounded space; an app that grows in it forever
    // is a bad tenant.
    for (let i = 0; i < 70; i += 1) saveViewSettings(String(i), DEFAULT_VIEW_SETTINGS)
    const record = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>
    expect(Object.keys(record)).toHaveLength(60)
    expect(record['0']).toBeUndefined()
    expect(record['69']).toBeDefined()
  })

  test('unreadable storage is simply no memory, never an error', () => {
    localStorage.setItem(KEY, 'not json at all')
    expect(() => loadViewSettings('1', DEFAULT_VIEW_SETTINGS)).not.toThrow()
    expect(loadViewSettings('1', DEFAULT_VIEW_SETTINGS)).toEqual(DEFAULT_VIEW_SETTINGS)
    // And writing over it recovers.
    saveViewSettings('1', custom)
    expect(loadViewSettings('1', DEFAULT_VIEW_SETTINGS).view).toBe('3d')
  })
})
