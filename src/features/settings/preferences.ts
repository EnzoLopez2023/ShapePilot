import { apiRequest } from '../../services/http.ts'

export type ThemePreference = 'light' | 'dark' | 'system'

export interface AppPreferences {
  themeMode: ThemePreference
  units: 'mm' | 'in'
  reducedMotion: 'system' | 'reduce' | 'no-preference'
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

export const putPreferences = (preferences: AppPreferences) =>
  apiRequest<{ preferences: AppPreferences }>('/settings', { method: 'PUT', body: preferences })
