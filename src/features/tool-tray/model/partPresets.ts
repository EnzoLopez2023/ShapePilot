// Pockets measured off inserts that are known to fit real Bambu parts.
//
// Static data, versioned with the code, the same call `SWITCH_PROFILES` and
// `MATERIALS` already make. Dropping a preset into a tray COPIES its steps, so
// a saved tray keeps printing the same after a catalogue edit -- and `presetId`
// rides along as provenance only, never validated, so a tray built on a preset
// a later build has never heard of still opens.
//
// PROVENANCE. Every footprint here was extracted from the H2D/H2S/H2C toolbox
// inserts by subtracting the insert mesh from its own outline and measuring the
// resulting cavities, so these are the shapes the parts demonstrably sit in
// rather than caliper readings off the parts themselves. The one part of the
// reference kit deliberately ABSENT is the open-end wrench: its 92 x 30 x 8 was
// estimated off a photograph, and a preset that is a guess is worse than no
// preset. Measure it and add it.
import type { PocketStep, ToolPocketKind } from './types.ts'

export interface PartPreset {
  id: string
  label: string
  /** What it holds, in the words someone picking it off a palette would use. */
  note: string
  kind: ToolPocketKind
  widthMm: number
  heightMm: number
  steps: PocketStep[]
}

/**
 * The hotend bay, and the reason `PocketStep` exists.
 *
 * A Bambu hotend lies down with its finned heatsink at one end and the nozzle
 * assembly projecting from the other, so one part wants three depths: a deep
 * bay for the heatsink, a shallower channel for the nozzle, and a deeper relief
 * so the tip itself is not resting on the floor. Measured floors were at z=2,
 * z=9 and z=6 of a 13 mm plate, hence 11, 4 and 7 mm of depth.
 */
const HOTEND_STEPS: PocketStep[] = [
  { shape: { kind: 'rect', widthMm: 19.4, heightMm: 33, cornerRadiusMm: 1 }, offset: [0, 27.9], depthMm: 11 },
  { shape: { kind: 'rect', widthMm: 19.4, heightMm: 27.9, cornerRadiusMm: 1 }, offset: [0, 0], depthMm: 4 },
  { shape: { kind: 'rect', widthMm: 11, heightMm: 6, cornerRadiusMm: 1 }, offset: [4.2, 0], depthMm: 7 },
]

export const PART_PRESETS: readonly PartPreset[] = [
  {
    id: 'bambu-hotend',
    label: 'Hotend',
    note: 'One Bambu hotend lying down, heatsink in the deep bay, nozzle in the channel.',
    kind: 'composite',
    widthMm: 19.4,
    heightMm: 60.9,
    steps: HOTEND_STEPS,
  },
  {
    id: 'bambu-lube-tube',
    label: 'Lubricant tube',
    note: 'A 3 g Bambu oil or grease tube. Three of these hold a full set.',
    kind: 'bin',
    widthMm: 79,
    heightMm: 26,
    steps: [{ shape: { kind: 'rect', widthMm: 79, heightMm: 26, cornerRadiusMm: 3 }, depthMm: 17 }],
  },
  {
    id: 'allen-and-rods',
    label: 'Allen keys and rods',
    note: 'Two L-shaped keys plus the cleaning needle and unclogging rods.',
    kind: 'channel',
    widthMm: 136,
    heightMm: 37,
    // The long arm runs the width, the short arm turns down at the end -- which
    // a straight slot cannot express, and is why `channel` takes a path.
    steps: [
      { shape: { kind: 'channel', path: [[3, 33], [131, 33], [131, 15]], widthMm: 4 }, depthMm: 9 },
      { shape: { kind: 'channel', path: [[3, 24], [118, 24], [118, 9]], widthMm: 3.4 }, depthMm: 9 },
      { shape: { kind: 'channel', path: [[3, 14], [100, 14]], widthMm: 2.6 }, depthMm: 9 },
      { shape: { kind: 'channel', path: [[3, 6], [100, 6]], widthMm: 2.6 }, depthMm: 9 },
    ],
  },
  {
    id: 'small-parts-bin',
    label: 'Screws and small parts',
    note: 'Loose hardware, the nozzle blocker, spare grub screws.',
    kind: 'bin',
    widthMm: 46,
    heightMm: 36,
    steps: [{ shape: { kind: 'rect', widthMm: 46, heightMm: 36, cornerRadiusMm: 3 }, depthMm: 19 }],
  },
  {
    id: 'sock-slots',
    label: 'Silicone socks',
    note: 'Three slots for spare hotend socks, so they do not nest into each other.',
    kind: 'composite',
    widthMm: 46,
    heightMm: 28,
    steps: [
      { shape: { kind: 'rect', widthMm: 46, heightMm: 8, cornerRadiusMm: 2 }, offset: [0, 0], depthMm: 12 },
      { shape: { kind: 'rect', widthMm: 46, heightMm: 8, cornerRadiusMm: 2 }, offset: [0, 10], depthMm: 12 },
      { shape: { kind: 'rect', widthMm: 46, heightMm: 8, cornerRadiusMm: 2 }, offset: [0, 20], depthMm: 12 },
    ],
  },
  {
    id: 'nozzle-wiper',
    label: 'Nozzle wiper',
    note: 'The wiper block and its clip.',
    kind: 'bin',
    widthMm: 18.5,
    heightMm: 23.5,
    steps: [{ shape: { kind: 'rect', widthMm: 18.5, heightMm: 23.5, cornerRadiusMm: 2 }, depthMm: 13 }],
  },
  {
    id: 'long-bay',
    label: 'Long bay',
    note: 'A deep narrow well for blades, tweezers, or anything that will not lie flat.',
    kind: 'bin',
    widthMm: 23,
    heightMm: 72.3,
    steps: [{ shape: { kind: 'rect', widthMm: 23, heightMm: 72.3, cornerRadiusMm: 3 }, depthMm: 19 }],
  },
]

export const getPartPreset = (id: string): PartPreset | undefined =>
  PART_PRESETS.find(p => p.id === id)
