import type { SqliteDatabase } from '../connection.ts'
import type {
  AppPreferences, BambuDefaults, DesignerDefaults, KeycapTrayDefaults, SettingsRepository,
  ShaperDefaults,
} from './contracts.ts'

/**
 * What each designer opens with out of the box. These are the values the
 * designers themselves used to hard-code; moving them here is what lets a
 * person change them once instead of on every new document.
 */
export const DEFAULT_DESIGNER_DEFAULTS: DesignerDefaults = {
  keycapTray: {
    view: '2d',
    snapMm: 0.5,
    gridMm: 5,
    showLabels: true,
    showPlate: false,
    showBuffer: false,
    /** DEFAULT_FABRICATION.minWallMm, the bound the wall check uses. */
    bufferMm: 1.8,
    imperial: false,
    target: 'print',
  },
  shaper: { imperial: false, snapMm: 1, gridMm: 10 },
  bambu: { imperial: false, snapMm: 1, gizmo: 'translate', addMode: 'solid' },
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  themeMode: 'light',
  units: 'mm',
  reducedMotion: 'system',
  designerDefaults: DEFAULT_DESIGNER_DEFAULTS,
}

const THEME_MODES = new Set<AppPreferences['themeMode']>(['light', 'dark', 'system'])
const UNITS = new Set<AppPreferences['units']>(['mm', 'in'])
const MOTION = new Set<AppPreferences['reducedMotion']>(['system', 'reduce', 'no-preference'])
const VIEWS = new Set<KeycapTrayDefaults['view']>(['2d', '3d'])
const TARGETS = new Set<KeycapTrayDefaults['target']>(['print', 'cnc'])
const GIZMOS = new Set<BambuDefaults['gizmo']>(['translate', 'rotate', 'scale'])
const ADD_MODES = new Set<BambuDefaults['addMode']>(['solid', 'hole'])

const object = (value: unknown): Record<string, unknown> =>
  (typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {})

const bool = (value: unknown, fallback: boolean): boolean =>
  (typeof value === 'boolean' ? value : fallback)

/**
 * A length in millimetres, refused rather than clamped when it is out of
 * range: clamping would invent a setting nobody chose and then present it back
 * as theirs.
 */
const mm = (value: unknown, fallback: number): number =>
  (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : fallback)

const pick = <T>(allowed: Set<T>, value: unknown, fallback: T): T =>
  (allowed.has(value as T) ? value as T : fallback)

function normalizeDesignerDefaults(value: unknown): DesignerDefaults {
  const raw = object(value)
  const fallback = DEFAULT_DESIGNER_DEFAULTS

  const tray = object(raw.keycapTray)
  const shaper = object(raw.shaper)
  const bambu = object(raw.bambu)

  return {
    keycapTray: {
      view: pick(VIEWS, tray.view, fallback.keycapTray.view),
      snapMm: mm(tray.snapMm, fallback.keycapTray.snapMm),
      gridMm: mm(tray.gridMm, fallback.keycapTray.gridMm),
      showLabels: bool(tray.showLabels, fallback.keycapTray.showLabels),
      showPlate: bool(tray.showPlate, fallback.keycapTray.showPlate),
      showBuffer: bool(tray.showBuffer, fallback.keycapTray.showBuffer),
      bufferMm: mm(tray.bufferMm, fallback.keycapTray.bufferMm),
      imperial: bool(tray.imperial, fallback.keycapTray.imperial),
      target: pick(TARGETS, tray.target, fallback.keycapTray.target),
    } satisfies KeycapTrayDefaults,
    shaper: {
      imperial: bool(shaper.imperial, fallback.shaper.imperial),
      snapMm: mm(shaper.snapMm, fallback.shaper.snapMm),
      gridMm: mm(shaper.gridMm, fallback.shaper.gridMm),
    } satisfies ShaperDefaults,
    bambu: {
      imperial: bool(bambu.imperial, fallback.bambu.imperial),
      snapMm: mm(bambu.snapMm, fallback.bambu.snapMm),
      gizmo: pick(GIZMOS, bambu.gizmo, fallback.bambu.gizmo),
      addMode: pick(ADD_MODES, bambu.addMode, fallback.bambu.addMode),
    } satisfies BambuDefaults,
  }
}

/** Unknown or malformed stored values fall back to the default, never throw. */
export function normalizePreferences(value: unknown): AppPreferences {
  const raw = (value ?? {}) as Partial<AppPreferences>
  return {
    themeMode: THEME_MODES.has(raw.themeMode as AppPreferences['themeMode'])
      ? raw.themeMode as AppPreferences['themeMode']
      : DEFAULT_PREFERENCES.themeMode,
    units: UNITS.has(raw.units as AppPreferences['units'])
      ? raw.units as AppPreferences['units']
      : DEFAULT_PREFERENCES.units,
    reducedMotion: MOTION.has(raw.reducedMotion as AppPreferences['reducedMotion'])
      ? raw.reducedMotion as AppPreferences['reducedMotion']
      : DEFAULT_PREFERENCES.reducedMotion,
    // Rebuilt whether or not the caller sent any: a stored blob written before
    // these existed reads back complete, so nothing downstream has to cope
    // with a half-populated preferences object.
    designerDefaults: normalizeDesignerDefaults(raw.designerDefaults),
  }
}

export function createSettingsRepository(db: SqliteDatabase): SettingsRepository {
  const select = db.prepare<[string, string], { settings_json: string }>(
    'SELECT settings_json FROM app_settings WHERE tenant_id = ? AND oid = ?')

  const upsert = db.prepare(`
    INSERT INTO app_settings (tenant_id, oid, settings_json)
    VALUES (?, ?, ?)
    ON CONFLICT (tenant_id, oid)
    DO UPDATE SET settings_json = excluded.settings_json, updated_at = datetime('now')`)

  return {
    async get(owner) {
      const row = select.get(owner.tenantId, owner.oid)
      if (!row) return null
      try {
        return normalizePreferences(JSON.parse(row.settings_json))
      } catch {
        return DEFAULT_PREFERENCES
      }
    },

    async put(owner, preferences) {
      const normalized = normalizePreferences(preferences)
      upsert.run(owner.tenantId, owner.oid, JSON.stringify(normalized))
      return normalized
    },
  }
}
