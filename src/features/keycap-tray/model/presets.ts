import type { MultiPolygon, Ring } from '../../../geometry/vec.ts'
import { normalizePolygon } from '../../../geometry/vec.ts'
import { rectRing } from '../geometry/shapes.ts'
import { LIBRARY_SIZING, PYTHON_SIZING } from '../geometry/shapes.ts'
import type { PresetProfileId, TrayDesign, TrayProfile } from './types.ts'
import { PRESET_PROFILE_DATA } from './profileData.ts'

export { LIBRARY_SIZING, PYTHON_SIZING }

export interface ProfilePreset {
  id: PresetProfileId
  label: string
  description: string
  widthMm: number
  heightMm: number
  ring: Ring
}

const LABELS: Record<PresetProfileId, { label: string; description: string }> = {
  'systainer-s76-plain': {
    label: 'Systainer SYS3 S 76 — plain',
    description: 'Rectangular insert, 248 × 156 mm. Matches systainer_tray_1.',
  },
  'systainer-s76-notched': {
    label: 'Systainer SYS3 S 76 — notched',
    description: 'Notched and filleted insert, 249 × 165.5 mm. Matches TRAY3 upper.',
  },
}

export const PROFILE_PRESETS: ProfilePreset[] = PRESET_PROFILE_DATA.map(d => ({
  id: d.id as PresetProfileId,
  ...LABELS[d.id as PresetProfileId],
  widthMm: d.widthMm,
  heightMm: d.heightMm,
  ring: d.ring,
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

/** ANSI keycap widths, from the reference guide. Used to seed the palette. */
export const KEY_SIZES: { units: number; label: string; typical: string }[] = [
  { units: 1, label: '1u', typical: 'Alphas, numbers, F-keys, arrows' },
  { units: 1.25, label: '1.25u', typical: 'Ctrl, Win/Cmd, Alt, Fn' },
  { units: 1.5, label: '1.5u', typical: 'Tab' },
  { units: 1.75, label: '1.75u', typical: 'Caps Lock' },
  { units: 2, label: '2u', typical: 'Backspace, numpad 0' },
  { units: 2.25, label: '2.25u', typical: 'ANSI Enter, left Shift' },
  { units: 2.75, label: '2.75u', typical: 'Right Shift' },
  { units: 6.25, label: '6.25u', typical: 'Spacebar' },
]

/** Full library range: 1u to 13u in 0.25u steps, matching the 49 pocket SVGs. */
export const LIBRARY_UNITS: number[] =
  Array.from({ length: 49 }, (_, i) => +(1 + i * 0.25).toFixed(2))

export function emptyDesign(name = 'Untitled tray'): TrayDesign {
  return {
    id: crypto.randomUUID(),
    name,
    profile: { kind: 'preset', id: 'systainer-s76-plain' },
    sizing: { ...PYTHON_SIZING },
    floorThicknessMm: 2.4,
    pocketDepthMm: 10,
    engraveDepthMm: 0.4,
    pockets: [],
    revision: 0,
  }
}
