import type { SqliteDatabase } from '../connection.ts'
import type { AppPreferences, SettingsRepository } from './contracts.ts'

export const DEFAULT_PREFERENCES: AppPreferences = {
  themeMode: 'system',
  units: 'mm',
  reducedMotion: 'system',
}

const THEME_MODES = new Set<AppPreferences['themeMode']>(['light', 'dark', 'system'])
const UNITS = new Set<AppPreferences['units']>(['mm', 'in'])
const MOTION = new Set<AppPreferences['reducedMotion']>(['system', 'reduce', 'no-preference'])

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
