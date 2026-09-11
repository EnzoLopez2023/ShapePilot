// Pockets measured off inserts that are known to fit real Bambu parts.
//
// Static data, versioned with the code, the same call `SWITCH_PROFILES` and
// `MATERIALS` already make. Dropping a preset into a tray COPIES its steps, so
// a saved tray keeps printing the same after a catalogue edit -- and `presetId`
// rides along as provenance only, never validated, so a tray built on a preset
// a later build has never heard of still opens.
//
// PROVENANCE, and it is not the same for every entry.
//
// All but one footprint here was extracted from the H2D/H2S/H2C toolbox inserts
// by subtracting the insert mesh from its own outline and measuring the
// resulting cavities, so these are the shapes the parts demonstrably sit in
// rather than caliper readings off the parts themselves.
//
// The open-end wrench is the exception, and worth reading before adding
// anything to this file. It had no insert to subtract, so it was once estimated
// off a photograph at 92 x 30 x 8 and deliberately kept OUT of this list on the
// grounds that a preset that is a guess is worse than no preset. Calipers have
// since settled it: 70.37 x 22.07 x 1.65. The guess was 31% too long and 36%
// too wide -- a pocket cut to it would have held a 70 mm wrench in a 92 mm slot.
//
// The lesson is not that the estimate was careless. It is that an uncalibrated
// photograph carries NO scale information at all, so any number taken from one
// is an assumption about the object wearing a measurement's clothes. Measure it,
// or leave it out.
import type { FingerAccess, PocketStep, ToolPocketKind } from './types.ts'
import { FINGER_ACCESS_PRESETS, fingerAccessFrom } from './fingerAccess.ts'

const preset = (id: string): typeof FINGER_ACCESS_PRESETS[number] => {
  const found = FINGER_ACCESS_PRESETS.find(p => p.id === id)
  if (!found) throw new Error(`no finger-access preset "${id}"`)
  return found
}
const access = (id: string, side: FingerAccess['side']): FingerAccess =>
  fingerAccessFrom(preset(id), side)

export interface PartPreset {
  id: string
  label: string
  /** What it holds, in the words someone picking it off a palette would use. */
  note: string
  kind: ToolPocketKind
  widthMm: number
  heightMm: number
  steps: PocketStep[]
  /**
   * How the part comes back out. Chosen per part from `FINGER_ACCESS_PRESETS`
   * and placed on a side the hand can actually reach: a long side for anything
   * you lift level, so a fingertip gets under the part rather than beside it.
   *
   * Unlike the footprints above this is not measured -- see the header of
   * `fingerAccess.ts` for why it cannot be. It is here rather than left to the
   * person dropping the preset because a bay measured to fit a part closely is
   * exactly the bay that will not give it back, and knowing that is not their
   * job.
   */
  fingerAccess?: FingerAccess
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
    // 19.4 x 60.9, so left is a long side: reach under the heatsink end.
    fingerAccess: access('thumb', 'left'),
  },
  {
    id: 'bambu-lube-tube',
    label: 'Lubricant tube',
    note: 'A 3 g Bambu oil or grease tube. Three of these hold a full set.',
    kind: 'bin',
    widthMm: 79,
    heightMm: 26,
    steps: [{ shape: { kind: 'rect', widthMm: 79, heightMm: 26, cornerRadiusMm: 3 }, depthMm: 17 }],
    // A cylinder lying along x in a 17 mm bay -- the deepest close fit here.
    fingerAccess: access('thumb', 'bottom'),
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
    // The channels are barely wider than the keys, so pinching one out needs
    // somewhere for a nail to go.
    fingerAccess: access('fingertip', 'bottom'),
  },
  {
    id: 'open-end-wrench',
    label: 'Open-end wrench',
    note: 'The 8 mm service wrench. Lies flat; the scoop is what gets it back out.',
    kind: 'bin',
    // CALIPERED, not derived from an insert like the rest of this file, and the
    // only entry here with that provenance. 70.37 long, 22.07 across the head,
    // 8.09 jaw opening (hence "8 mm"), 1.65 of stamped steel.
    //
    // This is a BOUNDING BOX, and deliberately so. Calipers give extents; they
    // cannot give the U of the jaw, the taper at the neck or the radiused
    // handle end, so the wrench sits in a rectangle that holds it in a known
    // place rather than a profile that holds it snugly. Trace the outline to
    // replace this with the real shape -- that is precisely what tracing is
    // for, and the measurements above are the ground truth to check it against.
    widthMm: 22.07,
    heightMm: 70.37,
    // 1.65 of steel in a 2.4 pocket: seated, with 0.75 of air over it so the
    // tray above cannot pinch it.
    steps: [{
      shape: { kind: 'rect', widthMm: 22.07, heightMm: 70.37, cornerRadiusMm: 2 },
      depthMm: 2.4,
    }],
    // The one access in this file with a depth of its own, because a 1.65 mm
    // part in a 2.4 mm pocket cannot be picked up from beside it -- there is
    // nothing to grip. Cutting the scoop to 8 mm puts a void under the wrench's
    // edge instead, so a fingertip goes UNDER it and lifts.
    //
    // The shape still comes from the library; only the depth is per-part, which
    // is the right split: how wide a scoop is, is a fact about hands, and how
    // deep it cuts is a fact about the thing being freed.
    fingerAccess: { ...access('thumb', 'left'), depthMm: 8 },
  },
  {
    id: 'small-parts-bin',
    label: 'Screws and small parts',
    note: 'Loose hardware, the nozzle blocker, spare grub screws.',
    kind: 'bin',
    widthMm: 46,
    heightMm: 36,
    steps: [{ shape: { kind: 'rect', widthMm: 46, heightMm: 36, cornerRadiusMm: 3 }, depthMm: 19 }],
    // 19 mm deep and it holds loose screws, so it is the one bin you reach
    // into rather than tip.
    fingerAccess: access('lift-slot', 'bottom'),
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
    // Soft and small: one fingertip across all three slots.
    fingerAccess: access('fingertip', 'left'),
  },
  {
    id: 'nozzle-wiper',
    label: 'Nozzle wiper',
    note: 'The wiper block and its clip.',
    kind: 'bin',
    widthMm: 18.5,
    heightMm: 23.5,
    steps: [{ shape: { kind: 'rect', widthMm: 18.5, heightMm: 23.5, cornerRadiusMm: 2 }, depthMm: 13 }],
    // Small and 13 deep -- without this it is a hole you tip the tray to empty.
    fingerAccess: access('fingertip', 'bottom'),
  },
  {
    id: 'long-bay',
    label: 'Long bay',
    note: 'A deep narrow well for blades, tweezers, or anything that will not lie flat.',
    kind: 'bin',
    widthMm: 23,
    heightMm: 72.3,
    steps: [{ shape: { kind: 'rect', widthMm: 23, heightMm: 72.3, cornerRadiusMm: 3 }, depthMm: 19 }],
    // Deepest and narrowest of the lot; left is the long side.
    fingerAccess: access('lift-slot', 'left'),
  },
]

export const getPartPreset = (id: string): PartPreset | undefined =>
  PART_PRESETS.find(p => p.id === id)
