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

export function freeSpotFor(
  design: ToolTrayDesign, preset: Placeable,
): { x: number; y: number } {
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
  const pad = {
    left: fa?.side === 'left' ? reach : 0,
    right: fa?.side === 'right' ? reach : 0,
    bottom: fa?.side === 'bottom' ? reach : 0,
    top: fa?.side === 'top' ? reach : 0,
  }

  const mask = buildSolidMask(region, blockers, RASTER_MM)
  for (let y = bb.minY + pad.bottom; y + preset.heightMm + pad.top <= bb.maxY; y += STEP_MM) {
    for (let x = bb.minX + pad.left; x + preset.widthMm + pad.right <= bb.maxX; x += STEP_MM) {
      if (allSolid(mask, x - wall - pad.left, y - wall - pad.bottom,
        x + preset.widthMm + wall + pad.right, y + preset.heightMm + wall + pad.top)) {
        return { x, y }
      }
    }
  }

  // Nowhere clear. Put it in the middle and let the validator say so, rather
  // than silently refusing a drop the user asked for.
  return {
    x: (bb.minX + bb.maxX) / 2 - preset.widthMm / 2,
    y: (bb.minY + bb.maxY) / 2 - preset.heightMm / 2,
  }
}
