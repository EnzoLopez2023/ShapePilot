// The outline a tray is cut from, shared by every tray-shaped designer.
//
// This started life inside the keycap tray and moved out when the switch tray
// needed the same Systainer outlines. Nothing here knows what goes *in* a tray
// -- pockets, switch cells and their sizing stay in their own features.
import type { MultiPolygon, Ring } from '../geometry/vec.ts'
import { normalizePolygon, ringBBox, rotateRing, translateRing } from '../geometry/vec.ts'
import { rectRing } from '../geometry/primitives.ts'
import { PRESET_PROFILE_DATA } from './trayProfileData.ts'

export type { PresetProfileData } from './trayProfileData.ts'
export { PRESET_PROFILE_DATA }

export type TrayProfile =
  | { kind: 'rect'; widthMm: number; heightMm: number; cornerRadiusMm?: number }
  | { kind: 'preset'; id: PresetProfileId }
  | { kind: 'custom'; rings: MultiPolygon; sourceName?: string }

export type PresetProfileId = 'systainer-s76-plain' | 'systainer-s76-notched'

/**
 * Material the *case* wants left out of a tray's underside.
 *
 * The Systainer S 76's inlays carry four hex-key lift recesses: cut into the
 * bottom face at the left and right edges, you slide a hex key in, twist, and
 * the tray comes up. Harmless on a thick blank, but on a thin tray they reach
 * far enough inboard to break through the wall into any pocket placed near
 * those edges -- so every tray designer needs to know where they are, whether
 * or not it generates them.
 */
export interface UndersideRelief {
  label: string
  /** Same frame and orientation rules as `ring`: stored raw, turned by
   *  `orientRing` along with the outline. */
  ring: Ring
  /** How far up from z = 0 the relief cuts. */
  heightMm: number
}

export interface ProfilePreset {
  id: PresetProfileId
  label: string
  description: string
  widthMm: number
  heightMm: number
  ring: Ring
  /**
   * Floor of the base cavity to the case lip, mm -- what a stack of trays has
   * to fit within with the lid off, and the honest budget for a tray that runs
   * to the full footprint.
   *
   * Festool's published figures for the SYS3 S 76: external 265 x 171 x 71,
   * internal 258 x 164 x 67. The 67 is floor-to-lid with the case shut; the
   * base cavity alone is about 48, the rest being the lid's own recess. See
   * `lidRecessHeightMm`.
   *
   * This replaced an estimate of 63 mm derived from the outer height. It is
   * still a retailer's figure rather than a caliper reading, so every designer
   * that uses it lets the user override it.
   */
  baseCavityHeightMm: number
  /**
   * The lid's recess, mm. Usable only by a tray that does not run to the full
   * footprint, because the recess is inset from the case walls -- which is why
   * it is kept separate from the base cavity rather than added into it.
   */
  lidRecessHeightMm: number
  /**
   * Clear height a stack of trays has. The conservative answer: the base
   * cavity, ignoring the lid recess. `profileTotalClearHeight` adds the recess
   * for a designer that wants to report both.
   */
  internalClearHeightMm: number
  undersideReliefs?: readonly UndersideRelief[]
}

/** An axis-aligned relief, from opposite corners. */
const reliefRect = (x0: number, y0: number, x1: number, y1: number): Ring =>
  translateRing(rectRing(x1 - x0, y1 - y0), x0, y0)

/**
 * The S 76's four hex-key lift recesses, 18.5 mm inboard and 5 mm tall.
 *
 * In the RAW frame, so `orientRing` turns them with the outline. After that
 * turn they land at x 0..18.5 and 230.5..249.0, y 37.242..57.242 and
 * 110.742..130.742 -- which is what a keep-out check compares against, and
 * what `trayProfile.test.ts` pins. The y bands are genuinely NOT symmetric
 * about the tray centre; that was measured off the community 3MF template, not
 * inferred from the outline's own near-symmetry.
 *
 * Rectangles rather than the template's lens shapes: the keep-out is derived
 * from the bounding box anyway (there is no polygon buffer in this codebase),
 * a rectangle is strictly the larger cut so a hex key still fits, and it
 * prints no worse.
 */
const S76_LIFT_RECESSES: readonly UndersideRelief[] = [
  // Labels describe where each one ends up AFTER the turn, which is the frame
  // anyone reading a validation message is looking at.
  { label: 'lift recess, front left', ring: reliefRect(230.5, 108.2417, 249.0, 128.2417), heightMm: 5 },
  { label: 'lift recess, front right', ring: reliefRect(0.0, 108.2417, 18.5, 128.2417), heightMm: 5 },
  { label: 'lift recess, rear left', ring: reliefRect(230.5, 34.7417, 249.0, 54.7417), heightMm: 5 },
  { label: 'lift recess, rear right', ring: reliefRect(0.0, 34.7417, 18.5, 54.7417), heightMm: 5 },
]

const LABELS: Record<PresetProfileId, {
  label: string
  description: string
  baseCavityHeightMm: number
  lidRecessHeightMm: number
  undersideReliefs?: readonly UndersideRelief[]
}> = {
  'systainer-s76-plain': {
    label: 'Systainer SYS3 S 76 — plain',
    description: 'Rectangular insert, 248 × 156 mm. Matches systainer_tray_1.',
    baseCavityHeightMm: 48,
    lidRecessHeightMm: 19,
  },
  'systainer-s76-notched': {
    label: 'Systainer SYS3 S 76 — notched',
    description: 'Notched and filleted insert, 249 × 165.5 mm. Matches TRAY3 upper.',
    baseCavityHeightMm: 48,
    lidRecessHeightMm: 19,
    undersideReliefs: S76_LIFT_RECESSES,
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

/**
 * The point the correction turns about: the centre of the outline's own bounds.
 *
 * Taken once from the outline and passed to everything that has to stay in
 * step with it. A relief turned about its *own* centre would be a no-op for a
 * rectangle and would silently leave the keep-out in the wrong corner, which
 * nothing downstream would catch.
 */
const turnPivot = (outline: Ring): [number, number] => {
  const b = ringBBox(outline)
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]
}

const orientRing = (id: PresetProfileId, ring: Ring, pivot: [number, number]): Ring =>
  TURN_180.has(id) ? rotateRing(ring, 180, pivot[0], pivot[1]) : ring

export const PROFILE_PRESETS: ProfilePreset[] = PRESET_PROFILE_DATA.map(d => {
  const id = d.id as PresetProfileId
  const labels = LABELS[id]
  const pivot = turnPivot(d.ring)
  return {
    id,
    ...labels,
    widthMm: d.widthMm,
    heightMm: d.heightMm,
    ring: orientRing(id, d.ring, pivot),
    // The conservative budget: the base cavity, not the lid recess as well.
    internalClearHeightMm: labels.baseCavityHeightMm,
    // Turned about the outline's pivot, so the two stay in step.
    ...(labels.undersideReliefs
      ? {
          undersideReliefs: labels.undersideReliefs.map(r => ({
            ...r, ring: orientRing(id, r.ring, pivot),
          })),
        }
      : {}),
  }
})

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

/**
 * The lid's own recess, on top of the base cavity. Separate because a tray that
 * runs to the full footprint cannot use it -- the recess is inset from the case
 * walls -- so adding it into the clear height would promise room that a
 * full-size tray does not have.
 */
export function profileLidRecessHeight(profile: TrayProfile): number | null {
  return profile.kind === 'preset' ? getPreset(profile.id).lidRecessHeightMm : null
}

/** Base cavity plus lid recess: the absolute ceiling, for a tray narrow enough
 *  to sit inside the recess. Festool quote 67 mm for the SYS3 S 76. */
export function profileTotalClearHeight(profile: TrayProfile): number | null {
  if (profile.kind !== 'preset') return null
  const p = getPreset(profile.id)
  return p.baseCavityHeightMm + p.lidRecessHeightMm
}

/**
 * Relief the case wants left out of the tray's underside, in the same frame and
 * orientation as `profileToMulti`. Empty for a bare rectangle or an imported
 * outline -- those have no case to speak of.
 */
export function profileUndersideReliefs(profile: TrayProfile): readonly UndersideRelief[] {
  return profile.kind === 'preset' ? getPreset(profile.id).undersideReliefs ?? [] : []
}
