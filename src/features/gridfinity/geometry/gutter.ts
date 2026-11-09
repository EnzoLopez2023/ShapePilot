// The gutter: one long bin filling the strip a wide S76 plate leaves behind
// its grid, for things longer than a cell -- pencils, rules, hex keys, bits.
//
// It is not a Gridfinity bin. It has no feet and stands straight on the case
// floor, so it gets the plate's 4.65 mm of depth back, and its footprint is
// the case outline behind the plate: the hinge corners and the hinge lobes
// carried up the full height. (The back bracket slots are gone: the wide
// plate is for a case with every divider bracket cut off.)
//
// Coordinates are the plate's (x across, y front to back, z up from the case
// floor), so it previews in place beside the tiles. Export moves it to the
// origin.
import type { Manifold } from 'manifold-3d'
import { loadManifold } from '../../../csg/manifold.ts'
import { toAppMesh } from '../../../csg/evaluate.ts'
import type { Mesh } from '../../../geometry/mesh.ts'
import {
  DEFAULT_GUTTER_UNITS, HEIGHT_UNIT_MM, type GridfinityBaseplateParams,
} from '../../../../lib/contracts/gridfinity.ts'
import { DIVIDER_MM, LIP_HEIGHT_MM, WALL_MM } from './bin.ts'
import type { BaseplatePlan } from './baseplate.ts'
import { finish } from './shapes.ts'

export const GUTTER_FLOOR_MM = 1.2
/** Rounds the footprint's outside corners so none prints as a knife edge. */
const CORNER_ROUND_MM = 0.5
/** Pockets of cavity narrower than twice this (the ears' slivers) fill in. */
const SLIVER_MM = 0.8
const MAX_SCOOP_MM = 8

/** Level with the stacking lip of a bin `units` tall, so case-lid foam bears on both. */
export const gutterHeightMm = (p: Pick<GridfinityBaseplateParams, 'gutterHeightUnits'>): number =>
  HEIGHT_UNIT_MM * (p.gutterHeightUnits ?? DEFAULT_GUTTER_UNITS) + LIP_HEIGHT_MM

/** The gutter in plate coordinates, or null when the plan has none. */
export async function buildGutter(
  plan: BaseplatePlan, p: GridfinityBaseplateParams,
): Promise<Mesh | null> {
  if (!plan.gutterOutline || plan.problem) return null
  const wasm = await loadManifold()
  const H = gutterHeightMm(p)
  const F = GUTTER_FLOOR_MM
  const outer = new wasm.CrossSection(plan.gutterOutline, 'EvenOdd')
    .offset(-CORNER_ROUND_MM, 'Round', 2, 16)
    .offset(CORNER_ROUND_MM, 'Round', 2, 16)
  const inner = outer
    .offset(-WALL_MM, 'Round', 2, 16)
    .offset(-SLIVER_MM, 'Round', 2, 16)
    .offset(SLIVER_MM, 'Round', 2, 16)
  const cavity = inner.extrude(H + 1).translate([0, 0, F])
  const { min, max } = inner.bounds()
  const parts: Manifold[] = []

  // A finger scoop along the straight front wall.
  const R = Math.min(MAX_SCOOP_MM, (max[1] - min[1]) * 0.4, H - F - 4)
  if (R >= 2) {
    const len = max[0] - min[0]
    const box = wasm.Manifold.cube([len, R + 0.01, R + 0.01]).translate([min[0], min[1] - 0.01, F - 0.01])
    const cyl = wasm.Manifold.cylinder(len + 2, R, R, 96)
      .rotate([0, 90, 0])
      .translate([min[0] - 1, min[1] + R, F + R])
    parts.push(box.subtract(cyl))
  }

  // Thin walls splitting it along its length.
  const n = p.gutterCompartments ?? 1
  for (let k = 1; k < n; k++) {
    const x = min[0] + (k * (max[0] - min[0])) / n
    parts.push(wasm.Manifold.cube([DIVIDER_MM, max[1] - min[1] + 2, H]).translate([x - DIVIDER_MM / 2, min[1] - 1, 0]))
  }

  const fill = parts.length ? wasm.Manifold.union(parts).intersect(cavity) : null
  let solid = outer.extrude(H).subtract(cavity)
  if (fill) solid = solid.add(fill)
  return toAppMesh(finish(solid, 'The gutter'))
}
