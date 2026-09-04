// Rigid transforms of a whole tray. So far just the 180-degree turn -- the
// notched Systainer profile is easy to lay out the wrong way up, and the fix is
// to rotate the outline *and* every pocket together so the layout stays intact.
import type { Pocket, TrayDesign } from './types.ts'
import type { PocketSizing } from '../geometry/shapes.ts'
import { multiBBox, rotateRing } from '../../../geometry/vec.ts'
import { pocketWidth, pocketHeight } from '../geometry/shapes.ts'
import { profileToMulti } from './presets.ts'

const footprint = (p: Pocket, s: PocketSizing): { w: number; h: number } =>
  p.shape === 'iso-enter'
    ? { w: p.widthMm ?? pocketWidth(1.5, s), h: 2 * (p.heightMm ?? pocketHeight(1, s)) }
    : { w: p.widthMm ?? pocketWidth(p.units, s), h: p.heightMm ?? pocketHeight(p.heightUnits ?? 1, s) }

/**
 * Turn the tray 180 degrees about its outline centre -- profile and pockets
 * together. A rectangle is symmetric under the turn, so its `kind` is kept; a
 * preset or custom outline is materialised and rotated (its `kind` becomes
 * `custom`, since the notches no longer sit where the preset puts them).
 * Applying it twice returns to the original layout.
 */
export function rotateDesign180(d: TrayDesign): TrayDesign {
  const bb = multiBBox(profileToMulti(d.profile))
  const cx = (bb.minX + bb.maxX) / 2
  const cy = (bb.minY + bb.maxY) / 2

  const pockets = d.pockets.map(p => {
    const { w, h } = footprint(p, d.sizing)
    const centreX = p.x + w / 2
    const centreY = p.y + h / 2
    return {
      ...p,
      x: 2 * cx - centreX - w / 2,
      y: 2 * cy - centreY - h / 2,
      rotationDeg: ((p.rotationDeg ?? 0) + 180) % 360,
    }
  })

  const profile: TrayDesign['profile'] = d.profile.kind === 'rect'
    ? d.profile
    : {
        kind: 'custom',
        rings: profileToMulti(d.profile).map(poly => poly.map(ring => rotateRing(ring, 180, cx, cy))),
        sourceName: d.profile.kind === 'preset'
          ? `${d.profile.id} (rotated)`
          : d.profile.sourceName ?? 'rotated',
      }

  return { ...d, profile, pockets }
}
