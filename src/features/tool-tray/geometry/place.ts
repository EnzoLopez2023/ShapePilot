// Where to put a newly dropped part.
//
// Pure, and a function of the WHOLE design rather than of a component's props,
// because it has to run inside the state mutator. Computing it at click time
// instead looked fine until several parts were dropped in one React batch: each
// call saw the same closed-over pocket list and every part landed on the same
// spot. Correctness here is about *when* it is evaluated, so it lives outside
// the page.
import type { Polygon } from '../../../geometry/vec.ts'
import { multiBBox } from '../../../geometry/vec.ts'
import { allSolid, buildSolidMask } from '../../../geometry/solidMask.ts'
import { profileToMulti, profileUndersideReliefs } from '../../../model/trayProfile.ts'
import type { FingerAccess, PocketStep, ToolTrayDesign } from '../model/types.ts'
import { THRESHOLDS } from '../model/thresholds.ts'
import { fingerAccessReach, pocketFootprint } from './shapes.ts'
import { reliefKeepOuts } from './bands.ts'

/** Rasterisation step for the search. Finer than this buys nothing visible. */
const RASTER_MM = 0.5
const STEP_MM = 1

/**
 * The first spot the part fits, scanning rows from the bottom left.
 *
 * Scanned against the rasterised OUTLINE, not its bounding box: the notched
 * preset's bbox edges and corners are not material, so a box scan drops parts
 * off the tray and the validator then -- correctly -- complains about the
 * placement the app itself chose.
 *
 * The candidate is padded by the wall for the outline test, the pockets already
 * placed are grown so the remaining gap comes to the target web, and the lift
 * recesses join the blockers when this part is deep enough to reach one. So a
 * spot this returns satisfies the same checks the validator applies.
 */
/**
 * Everything the search reads. Narrowed from `PartPreset` so a traced outline,
 * which has no catalogue entry, can be placed by the same code -- the search
 * only ever wanted a box, its depths and its finger access.
 */
export interface Placeable {
  widthMm: number
  heightMm: number
  steps: readonly PocketStep[]
  fingerAccess?: FingerAccess
}

/**
 * Where a `Placeable` fits, or null when nothing does.
 *
 * `quarterTurn` turns the part a quarter turn before looking, which is what
 * lets a packer fit a 136 mm channel block across a 165 mm tray. The rotation
 * is real -- the pocket carries `rotationDeg: 90` -- and because
 * `applyPocketTransform` turns about the box CENTRE, the rotated body spills
 * outside its own w x h box. The seat returned is already corrected for that,
 * so the caller sets x/y from it directly.
 */
export function spotFor(
  design: ToolTrayDesign, preset: Placeable, quarterTurn = false,
): { x: number; y: number } | null {
  const region = profileToMulti(design.profile)
  const bb = multiBBox(region)
  const wall = THRESHOLDS.wallMm
  const grow = Math.max(0, THRESHOLDS.targetWebMm - wall)

  const deepest = Math.max(0, ...preset.steps.map(step => step.depthMm ?? design.heightMm))
  const floor = design.heightMm - deepest
  const reliefTop = Math.max(0, ...profileUndersideReliefs(design.profile).map(r => r.heightMm))
  const reachesRecess = design.undersideReliefs !== 'ignore'
    && floor < reliefTop + THRESHOLDS.reliefRoofMm

  const box = (b: { minX: number; minY: number; maxX: number; maxY: number }): Polygon => [[
    [b.minX - grow, b.minY - grow], [b.maxX + grow, b.minY - grow],
    [b.maxX + grow, b.maxY + grow], [b.minX - grow, b.maxY + grow],
  ]]

  const blockers: Polygon[] = [
    ...(reachesRecess ? reliefKeepOuts(design) : []),
    ...design.pockets.flatMap(pocket => {
      const mp = pocketFootprint(pocket)
      return mp.length ? [box(multiBBox(mp))] : []
    }),
  ]

  // A preset that brings its own finger access needs room for it too. The box
  // is not the footprint: the scoop reaches into the web on one side, and a
  // spot chosen without it puts the scoop through a neighbour or the outline.
  const fa = preset.fingerAccess
  const reach = fa ? fingerAccessReach(fa) : 0
  // A quarter turn carries the scoop round with the body: rotating a point on
  // the box's left by +90 degrees about the centre puts it below the centre.
  const TURNED: Record<FingerAccess['side'], FingerAccess['side']> = {
    left: 'bottom', bottom: 'right', right: 'top', top: 'left',
  }
  const side = fa ? (quarterTurn ? TURNED[fa.side] : fa.side) : undefined
  const pad = {
    left: side === 'left' ? reach : 0,
    right: side === 'right' ? reach : 0,
    bottom: side === 'bottom' ? reach : 0,
    top: side === 'top' ? reach : 0,
  }

  // What the part occupies once turned.
  const boxW = quarterTurn ? preset.heightMm : preset.widthMm
  const boxH = quarterTurn ? preset.widthMm : preset.heightMm

  const mask = buildSolidMask(region, blockers, RASTER_MM)
  for (let y = bb.minY + pad.bottom; y + boxH + pad.top <= bb.maxY; y += STEP_MM) {
    for (let x = bb.minX + pad.left; x + boxW + pad.right <= bb.maxX; x += STEP_MM) {
      if (allSolid(mask, x - wall - pad.left, y - wall - pad.bottom,
        x + boxW + wall + pad.right, y + boxH + wall + pad.top)) {
        // (x, y) is where the OCCUPIED box goes. Undo the centre-rotation
        // spill so the pocket's own x/y put it there.
        return quarterTurn
          ? {
            x: x - preset.widthMm / 2 + preset.heightMm / 2,
            y: y - preset.heightMm / 2 + preset.widthMm / 2,
          }
          : { x, y }
      }
    }
  }
  return null
}

/**
 * Where to drop one part. Unlike `spotFor` this always answers: nowhere clear
 * puts it in the middle and lets the validator say so, rather than silently
 * refusing a drop the user asked for.
 */
export function freeSpotFor(
  design: ToolTrayDesign, preset: Placeable,
): { x: number; y: number } {
  const found = spotFor(design, preset)
  if (found) return found
  const bb = multiBBox(profileToMulti(design.profile))
  return {
    x: (bb.minX + bb.maxX) / 2 - preset.widthMm / 2,
    y: (bb.minY + bb.maxY) / 2 - preset.heightMm / 2,
  }
}
