// The outline a tray is cut from, shared by every tray-shaped designer.
//
// This started life inside the keycap tray and moved out when the switch tray
// needed the same Systainer outlines. Nothing here knows what goes *in* a tray
// -- pockets, switch cells and their sizing stay in their own features.
import type { MultiPolygon, Ring } from '../geometry/vec.ts'
import { normalizePolygon, ringBBox, rotateRing } from '../geometry/vec.ts'
import { rectRing } from '../geometry/primitives.ts'
import { PRESET_PROFILE_DATA } from './trayProfileData.ts'

export type { PresetProfileData } from './trayProfileData.ts'
export { PRESET_PROFILE_DATA }

export type TrayProfile =
  | { kind: 'rect'; widthMm: number; heightMm: number; cornerRadiusMm?: number }
  | { kind: 'preset'; id: PresetProfileId }
  | { kind: 'custom'; rings: MultiPolygon; sourceName?: string }

export type PresetProfileId = 'systainer-s76-plain' | 'systainer-s76-notched'

export interface ProfilePreset {
  id: PresetProfileId
  label: string
  description: string
  widthMm: number
  heightMm: number
  ring: Ring
  /**
   * Clear height inside the case, floor to lid, mm -- the budget a stack of
   * trays has to live within. PROVISIONAL: measured off the case's stated 76 mm
   * outer height less an estimated 13 mm of lid and base, not with calipers.
   * Every designer that uses it lets the user override it, so a real
   * measurement never needs a code change.
   */
  internalClearHeightMm: number
}

const LABELS: Record<PresetProfileId, {
  label: string; description: string; internalClearHeightMm: number
}> = {
  'systainer-s76-plain': {
    label: 'Systainer SYS3 S 76 — plain',
    description: 'Rectangular insert, 248 × 156 mm. Matches systainer_tray_1.',
    internalClearHeightMm: 63,
  },
  'systainer-s76-notched': {
    label: 'Systainer SYS3 S 76 — notched',
    description: 'Notched and filleted insert, 249 × 165.5 mm. Matches TRAY3 upper.',
    internalClearHeightMm: 63,
  },
}

/**
 * `systainer-s76-notched` is extracted from a Shaper (CNC) drawing that sits
 * 180° from how a printed tray drops face-up into the real Systainer S76 -- the
 * case's notch pattern only accepts the tray turned over. Confirmed against the
 * physical case: it is *always* 180° off. Corrected here so every tray built on
 * the preset comes out the right way up; the raw extraction in
 * trayProfileData.ts is left untouched.
 */
const TURN_180: ReadonlySet<PresetProfileId> = new Set(['systainer-s76-notched'])

const orientRing = (id: PresetProfileId, ring: Ring): Ring => {
  if (!TURN_180.has(id)) return ring
  const b = ringBBox(ring)
  return rotateRing(ring, 180, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2)
}

export const PROFILE_PRESETS: ProfilePreset[] = PRESET_PROFILE_DATA.map(d => ({
  id: d.id as PresetProfileId,
  ...LABELS[d.id as PresetProfileId],
  widthMm: d.widthMm,
  heightMm: d.heightMm,
  ring: orientRing(d.id as PresetProfileId, d.ring),
}))

export const getPreset = (id: PresetProfileId): ProfilePreset => {
  const p = PROFILE_PRESETS.find(x => x.id === id)
  if (!p) throw new Error(`unknown profile preset: ${id}`)
  return p
}

export function profileToMulti(profile: TrayProfile): MultiPolygon {
  switch (profile.kind) {
    case 'rect':
      return [normalizePolygon([
        rectRing(profile.widthMm, profile.heightMm, profile.cornerRadiusMm ?? 0),
      ])]
    case 'preset':
      return [normalizePolygon([getPreset(profile.id).ring])]
    case 'custom':
      return profile.rings.map(normalizePolygon)
  }
}

export function profileSize(profile: TrayProfile): { widthMm: number; heightMm: number } {
  if (profile.kind === 'rect') return { widthMm: profile.widthMm, heightMm: profile.heightMm }
  if (profile.kind === 'preset') {
    const p = getPreset(profile.id)
    return { widthMm: p.widthMm, heightMm: p.heightMm }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const poly of profile.rings) {
    for (const [x, y] of poly[0] ?? []) {
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
  }
  return { widthMm: maxX - minX, heightMm: maxY - minY }
}

/**
 * The clear height a stack of trays has, given the profile they are cut from.
 * Only the presets carry a real case; a bare rectangle or an imported outline
 * has no case to measure, so callers fall back to their own field.
 */
export function profileInternalClearHeight(profile: TrayProfile): number | null {
  return profile.kind === 'preset' ? getPreset(profile.id).internalClearHeightMm : null
}
