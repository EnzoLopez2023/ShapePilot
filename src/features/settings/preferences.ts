import { apiRequest } from '../../services/http.ts'

export type ThemePreference = 'light' | 'dark' | 'system'

/**
 * How a designer opens before anyone touches it. One shape per designer rather
 * than one shared shape: a keycap tray has a build plate and a buffer guide,
 * the Bambu designer has a gizmo and a solid/hole mode, and offering either
 * one the other's controls would be offering a setting that does nothing.
 */
export interface KeycapTrayDefaults {
  view: '2d' | '3d'
  snapMm: number
  gridMm: number
  showLabels: boolean
  showPlate: boolean
  showBuffer: boolean
  bufferMm: number
  imperial: boolean
  target: 'print' | 'cnc'
}

export interface ShaperDefaults {
  imperial: boolean
  snapMm: number
  gridMm: number
}

export interface BambuDefaults {
  imperial: boolean
  snapMm: number
  gizmo: 'translate' | 'rotate' | 'scale'
  addMode: 'solid' | 'hole'
}

export interface DesignerDefaults {
  keycapTray: KeycapTrayDefaults
  shaper: ShaperDefaults
  bambu: BambuDefaults
}

export interface AppPreferences {
  themeMode: ThemePreference
  units: 'mm' | 'in'
  reducedMotion: 'system' | 'reduce' | 'no-preference'
  designerDefaults: DesignerDefaults
}

export interface AccountProfile {
  tenantId: string
  oid: string
  displayName: string | null
  email: string | null
  role: 'user' | 'admin'
  authSource: 'entra' | 'development'
}

export interface SettingsResponse {
  preferences: AppPreferences
  profile: AccountProfile
}

export const getSettings = () => apiRequest<SettingsResponse>('/settings')

export const putPreferences = async (preferences: AppPreferences) => {
  const result = await apiRequest<{ preferences: AppPreferences }>(
    '/settings', { method: 'PUT', body: preferences })
  // What was just saved is what the designers should open with next.
  cachedDefaults = Promise.resolve(result.preferences.designerDefaults)
  return result
}

let cachedDefaults: Promise<DesignerDefaults> | null = null

/**
 * The designer defaults, or the shipped ones if settings cannot be read.
 *
 * A designer must open whatever the network did, so this never rejects: an
 * unreachable settings endpoint means the built-in defaults, not a broken page.
 *
 * Held for the session, because every designer asks on mount and a tray cannot
 * load until the answer arrives -- paying a round trip for it each time made
 * opening a tray measurably slower for a value that changes only when someone
 * edits it on the settings page, which invalidates this itself.
 */
export function designerDefaults(): Promise<DesignerDefaults> {
  cachedDefaults ??= getSettings()
    .then(result => result.preferences.designerDefaults ?? SHIPPED_DESIGNER_DEFAULTS)
    .catch(() => {
      // Not remembered: a designer opened while the network was down should
      // pick up the real defaults on the next try, not for the whole session.
      cachedDefaults = null
      return SHIPPED_DESIGNER_DEFAULTS
    })
  return cachedDefaults
}

/** Drop the cached defaults. Exported for tests, which mount fresh pages. */
export function forgetDesignerDefaults(): void {
  cachedDefaults = null
}

/** Mirrors DEFAULT_DESIGNER_DEFAULTS in lib/db/repositories/settings.ts. The
 *  server is the authority; this is the fallback when it cannot be asked. */
export const SHIPPED_DESIGNER_DEFAULTS: DesignerDefaults = {
  keycapTray: {
    view: '2d',
    snapMm: 0.5,
    gridMm: 5,
    showLabels: true,
    showPlate: false,
    showBuffer: false,
    bufferMm: 1.8,
    imperial: false,
    target: 'print',
  },
  shaper: { imperial: false, snapMm: 1, gridMm: 10 },
  bambu: { imperial: false, snapMm: 1, gizmo: 'translate', addMode: 'solid' },
}
