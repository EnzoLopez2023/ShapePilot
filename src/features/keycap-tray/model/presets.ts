// The tray outline itself now lives in src/model/trayProfile.ts, shared with
// the switch tray. Re-exported here so every keycap-tray caller keeps its
// existing import; what stays below is keycap-specific.
import { LIBRARY_SIZING, PYTHON_SIZING } from '../geometry/shapes.ts'
import type { TrayDesign } from './types.ts'

export {
  PROFILE_PRESETS, PRESET_PROFILE_DATA, getPreset, profileToMulti, profileSize,
  profileInternalClearHeight,
} from '../../../model/trayProfile.ts'
export type { ProfilePreset, PresetProfileData } from '../../../model/trayProfile.ts'

export { LIBRARY_SIZING, PYTHON_SIZING }

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
