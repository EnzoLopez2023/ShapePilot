// Named ways of breaking a pocket wall so the part can be lifted out.
//
// PROVENANCE, and it is deliberately different from `partPresets.ts`. Every
// footprint in that file was measured off an insert that demonstrably fits a
// real part, and the one shape that was only estimated was left out entirely.
// Nothing here is a measurement, because there is nothing to measure: a scoop
// is sized to a hand, not to a part. These are ergonomic choices, and saying so
// is the point -- a guess sitting unlabelled beside measured data is how the
// measured data stops being trustworthy.
//
// The basis: an adult index fingertip is roughly 16-20 mm across the distal
// joint and a thumb 20-25 mm, so a scoop narrower than about 16 mm is
// decoration -- it looks like access and gives no purchase. That is the whole
// reasoning, and it is why the smallest entry here is 18 mm rather than the
// 12 mm this panel used to default to.
//
// `reachMm` is how far the scoop bites into the web BEYOND the pocket box, so
// it is what buys room for a fingertip to get under the part rather than merely
// beside it. It is also why finger access has to be part of the footprint the
// web and wall checks measure, which `pocketFootprint` already sees to.
import type { FingerAccess } from './types.ts'

export interface FingerAccessPreset {
  id: string
  label: string
  /** What it is for, in the words someone choosing it would use. */
  note: string
  style: FingerAccess['style']
  widthMm: number
  reachMm: number
}

export const FINGER_ACCESS_PRESETS: readonly FingerAccessPreset[] = [
  {
    id: 'fingertip',
    label: 'Fingertip scoop',
    note: 'One fingertip. For small or light parts in a shallow pocket.',
    style: 'scallop',
    widthMm: 18,
    reachMm: 6,
  },
  {
    id: 'thumb',
    label: 'Thumb scoop',
    note: 'Thumb and forefinger either side. The usual choice for a close-fitting bay.',
    style: 'scallop',
    widthMm: 25,
    reachMm: 8,
  },
  {
    id: 'lift-slot',
    label: 'Lift slot',
    note: 'A square notch two fingers reach into. For a deep bin you cannot tip.',
    style: 'slot',
    widthMm: 30,
    reachMm: 10,
  },
] as const

/** The preset as a placed access on one side of a pocket. */
export const fingerAccessFrom = (
  preset: FingerAccessPreset,
  side: FingerAccess['side'],
): FingerAccess => ({
  style: preset.style,
  side,
  widthMm: preset.widthMm,
  reachMm: preset.reachMm,
})

/**
 * Which preset a given access came from, or undefined if it has been dialled
 * away from all of them. Compared on the fields a preset actually sets, so
 * moving an access to another side keeps its identity.
 */
export const fingerAccessPresetOf = (
  fa: FingerAccess,
): FingerAccessPreset | undefined => FINGER_ACCESS_PRESETS.find(
  p => p.style === fa.style && p.widthMm === fa.widthMm && p.reachMm === fa.reachMm,
)

/** The one to reach for when nothing more is known about the part. */
export const DEFAULT_FINGER_ACCESS = FINGER_ACCESS_PRESETS[1]
