// The whole solid as an ordered list of z-bands, generalised to N of them.
//
// The keycap tray does this with exactly two bands against one global pocket
// depth. A tool tray cannot: the reference kit needs 8, 9, 11, 12, 13, 17 and
// 19 mm deep pockets in one tray. So the band count is data, derived from the
// pocket depths, and the two meshing rules generalise over it.
//
// Everything else is deliberately unchanged from the keycap tray. Still pure
// 2D-region -> z-band extrusion with no 3D boolean anywhere; still
// `insertTJunctions` before meshing and `repairTJunctions` inside
// `MeshBuilder.finish()`. That is where the hard-won watertightness lives and
// none of it needed touching.
//
// THE ONE RULE WORTH READING TWICE. Each band is derived from the band *below*
// it, subtracting only the rings whose floor is exactly at that level:
//
//     bands[0] = profile - through-cuts
//     bands[i] = bands[i-1] - ringsAtLevel(levels[i])
//
// and each horizontal face is then a *difference of the two bands that meet at
// that z*, never a pocket ring. That is what keeps a floor's boundary built out
// of its neighbours' own vertices, so it welds against their walls instead of
// leaving a crack. The keycap tray says the same thing about `base - top`; this
// is that property, N times.
import type { MultiPolygon, Polygon } from '../../../geometry/vec.ts'
import {
  difference, intersection, punchDisjointFast, union, unionDisjointFast,
} from '../../../geometry/boolean.ts'
import { insertTJunctions } from '../../../geometry/tjunction.ts'
import type { Mesh } from '../../../geometry/mesh.ts'
import { MeshBuilder } from '../../../geometry/mesh.ts'
import { profileToMulti, profileUndersideReliefs } from '../../../model/trayProfile.ts'
import { cornerSeats, edgeMidSeats, findSeats } from '../../../geometry/seats.ts'
import { multiArea, multiBBox } from '../../../geometry/vec.ts'
import type { ToolPocket, ToolTrayDesign } from '../model/types.ts'
import { snapDown, THRESHOLDS } from '../model/thresholds.ts'
import { deepestStepMm, fingerAccessRings, stepRings } from './shapes.ts'

/** How far feet dip up into the tray, so a slicer welds the two solids. */
const FOOT_WELD_MM = 0.05

export interface Band {
  z0: number
  z1: number
  region: MultiPolygon
}

export interface ToolTrayRegions {
  profile: MultiPolygon
  /** Contiguous and ascending: `bands[i].z1 === bands[i+1].z0`, `bands[0].z0 === 0`. */
  bands: Band[]
  /** Interface heights, ascending. `levels.length === bands.length + 1`. */
  levels: number[]
  /** Upward face at `levels[i]`: material that ENDS there. Index 0 unused. */
  floorsUp: MultiPolygon[]
  /**
   * Downward face at `levels[i]`: material that STARTS there. Empty everywhere
   * unless the tray generates underside relief, which is the only thing that
   * makes a band wider than the one below it.
   */
  ceilingsDown: MultiPolygon[]
}

/** union() but skipping the clipper when nothing overlaps, which is the norm. */
const unionAll = (polys: Polygon[]): MultiPolygon => {
  if (!polys.length) return []
  return unionDisjointFast(polys) ?? union(...polys.map(p => [p]))
}

const punch = (outer: MultiPolygon, holes: MultiPolygon): MultiPolygon => {
  if (!holes.length) return outer
  return punchDisjointFast(outer, holes) ?? difference(outer, holes)
}

/** Where a depth measured down from the rim puts a floor. */
export const levelOf = (depthMm: number | null, design: ToolTrayDesign): number =>
  depthMm === null ? 0 : Math.max(0, snapDown(design.heightMm - depthMm, design.layerHeightMm))

/** The tallest underside relief, or 0 when the case has none. */
/** The tallest underside relief, or 0 when the case has none. */
const reliefHeight = (design: ToolTrayDesign): number => {
  let h = 0
  for (const r of profileUndersideReliefs(design.profile)) if (r.heightMm > h) h = r.heightMm
  return h
}

/**
 * The height a lifted floor sits at: the relief roof, snapped to a whole layer.
 *
 * A step that opts into `liftOverKeepOut` keeps its own floor everywhere except
 * over a lift recess, where it is held up to here so a thin roof bridges the
 * recess instead of opening into it.
 */
export const liftedFloorMm = (design: ToolTrayDesign): number =>
  snapDown(reliefHeight(design) + THRESHOLDS.reliefRoofMm, design.layerHeightMm)

/** One region a pocket removes, and the height its floor sits at. */
interface Contribution { level: number; polys: Polygon[] }

/**
 * Everything one pocket removes, split by the height each part's floor sits at.
 *
 * The only thing that splits a single step across two levels is
 * `liftOverKeepOut`: the part of it over a lift recess is held up to the relief
 * roof and the rest keeps its own floor. Doing that here rather than in the
 * band loop is what makes the flag real -- it was declared, and honoured by the
 * validator, while the mesher ignored it, so setting it silenced the warning
 * and left the hole.
 */
function contributionsFor(design: ToolTrayDesign, pocket: ToolPocket): Contribution[] {
  const deepest = deepestStepMm(pocket) ?? design.heightMm
  const lifting = design.undersideReliefs !== 'ignore' && reliefHeight(design) > 0
  const keepOuts = lifting ? reliefKeepOuts(design) : []
  const roof = liftedFloorMm(design)
  const out: Contribution[] = []

  for (const step of pocket.steps) {
    const level = levelOf(step.depthMm, design)
    const rings = stepRings(pocket, step)
    if (!rings.length) continue

    if (!step.liftOverKeepOut || !keepOuts.length || level >= roof) {
      out.push({ level, polys: rings })
      continue
    }
    // Split it: clear of the recesses at its own floor, over them at the roof.
    const mp = unionAll(rings)
    const ko = unionAll(keepOuts)
    const below = difference(mp, ko)
    const over = intersection(mp, ko)
    if (multiArea(below) > 1e-9) out.push({ level, polys: below })
    if (multiArea(over) > 1e-9) out.push({ level: roof, polys: over })
  }

  const fa = pocket.fingerAccess
  if (fa) {
    const rings = fingerAccessRings(pocket, fa)
    if (rings.length) out.push({ level: levelOf(fa.depthMm ?? deepest, design), polys: rings })
  }
  return out
}

/** Every contribution in the tray. Builds every ring, so it is not cheap. */
const allContributions = (design: ToolTrayDesign): Contribution[] =>
  design.pockets.flatMap(pocket => contributionsFor(design, pocket))

/**
 * Every distinct floor height in the tray, ascending, including 0 and the rim.
 *
 * Deliberately ARITHMETIC ONLY -- no rings, no booleans. It is called on every
 * render for the readout as well as by `buildRegions`, and an earlier version
 * derived it from the contributions, which meant building every channel union
 * three times per frame. That was slow enough to hang the page.
 *
 * The cost of staying cheap: a lifted step adds the roof level whether or not
 * its ring really overlaps a recess. A level nothing contributes to leaves a
 * band identical to the one below it -- redundant, not wrong.
 *
 * Depths snap DOWN onto whole layers, so a snapped floor is never shallower
 * than asked for. A through-cut lands at 0 and so shares the bottom level.
 */
export function resolveLevels(design: ToolTrayDesign): number[] {
  const top = design.heightMm
  const set = new Set<number>([0, top])

  if (design.undersideReliefs === 'generate') {
    for (const r of profileUndersideReliefs(design.profile)) {
      if (r.heightMm > 0 && r.heightMm < top) set.add(r.heightMm)
    }
  }

  const lifting = design.undersideReliefs !== 'ignore' && reliefHeight(design) > 0
  const roof = liftedFloorMm(design)
  for (const pocket of design.pockets) {
    const deepest = deepestStepMm(pocket) ?? top
    for (const step of pocket.steps) {
      const level = levelOf(step.depthMm, design)
      set.add(level)
      if (lifting && step.liftOverKeepOut && level < roof) set.add(roof)
    }
    const fa = pocket.fingerAccess
    if (fa) set.add(levelOf(fa.depthMm ?? deepest, design))
  }

  return [...set].filter(z => z >= 0 && z <= top).sort((a, b) => a - b)
}

export function buildRegions(design: ToolTrayDesign): ToolTrayRegions {
  const profile = profileToMulti(design.profile)
  const levels = resolveLevels(design)
  const contributions = allContributions(design)
  const ringsAtLevel = (level: number): MultiPolygon =>
    unionAll(contributions.filter(c => c.level === level).flatMap(c => c.polys))
  const generating = design.undersideReliefs === 'generate'
  const reliefs = generating
    ? unionAll(profileUndersideReliefs(design.profile).map(r => [r.ring]))
    : []

  // Band i spans levels[i] .. levels[i+1].
  //
  // TWO derivations, deliberately, and the reason is the whole point of
  // `ceilingsDown`. Pockets only ever remove MORE material going up, so their
  // chain is monotone and each band is punched out of the band below it -- that
  // is what keeps a floor built from its neighbours' own vertices.
  //
  // The relief is the opposite: it is cut from the BOTTOM up and stops at its
  // own height, so it must be applied per band against that band's z rather
  // than inherited. Folding it into the chain instead propagated it through
  // every band above and removed the relief over the tray's whole height --
  // 21 mm of it instead of 5, four times too much material.
  const reliefTop = reliefHeight(design)
  const chain: MultiPolygon[] = []
  const raw: MultiPolygon[] = []
  for (let i = 0; i + 1 < levels.length; i++) {
    const below = i === 0 ? profile : chain[i - 1]!
    const pocketed = punch(below, ringsAtLevel(levels[i]!))
    chain.push(pocketed)
    raw.push(generating && reliefs.length && levels[i]! < reliefTop
      ? punch(pocketed, reliefs)
      : pocketed)
  }

  const rawFloorsUp: MultiPolygon[] = [[]]
  const rawCeilingsDown: MultiPolygon[] = [[]]
  for (let i = 1; i < raw.length; i++) {
    rawFloorsUp.push(difference(raw[i - 1]!, raw[i]!))
    // Skipped entirely when nothing can widen a band; pure cost otherwise.
    rawCeilingsDown.push(generating ? difference(raw[i]!, raw[i - 1]!) : [])
  }

  // ONE global pass. Bands i and i+1 share the outer silhouette wherever no
  // pocket touches it, and their walls stack vertically -- they must agree
  // vertex-for-vertex at that interface or the mesh leaks there. A pocket that
  // breaches the outline at one level splits the silhouette in the bands above
  // but not below, and that boundary is exactly where it would leak.
  const flat = insertTJunctions([...raw, ...rawFloorsUp, ...rawCeilingsDown])
  const n = raw.length
  const bands: Band[] = flat.slice(0, n).map((region, i) => ({
    z0: levels[i]!, z1: levels[i + 1]!, region,
  }))

  return {
    profile,
    bands,
    levels,
    floorsUp: flat.slice(n, 2 * n),
    ceilingsDown: flat.slice(2 * n, 3 * n),
  }
}

export interface ToolTrayMeshOptions {
  /** Leave out anything flagged for a second filament or a separate print. */
  omitSeparateParts?: boolean
}

export function buildToolTrayMesh(design: ToolTrayDesign, opts?: ToolTrayMeshOptions): Mesh {
  const { bands, levels, floorsUp, ceilingsDown } = buildRegions(design)
  const b = new MeshBuilder()
  if (!bands.length) return b.finish()

  // Rule A -- horizontal faces at each interface.
  b.addHorizontal(bands[0]!.region, levels[0]!, 'down')
  for (let i = 1; i < bands.length; i++) {
    b.addHorizontal(floorsUp[i] ?? [], levels[i]!, 'up')
    b.addHorizontal(ceilingsDown[i] ?? [], levels[i]!, 'down')
  }
  b.addHorizontal(bands[bands.length - 1]!.region, levels[levels.length - 1]!, 'up')

  // Rule B -- side walls per band.
  for (const band of bands) b.addWalls(band.region, band.z0, band.z1)

  if (!opts?.omitSeparateParts) addFeet(b, design, bands[0]!.region)
  return b.finish()
}

/**
 * Posts under the tray, welded up into it. Searched against the *bottom* band,
 * because that is the material a post actually has to meet -- a post under a
 * through-cut would have nothing to stand on.
 */
function addFeet(b: MeshBuilder, design: ToolTrayDesign, bottom: MultiPolygon): void {
  const rects = feetRects(design, bottom)
  if (!rects.length) return
  const h = design.feet!.heightMm
  for (const rect of rects) {
    b.addHorizontal([rect], -h, 'down')
    b.addHorizontal([rect], FOOT_WELD_MM, 'up')
    b.addWalls([rect], -h, FOOT_WELD_MM)
  }
}

export function feetRects(design: ToolTrayDesign, bottom?: MultiPolygon): Polygon[] {
  const feet = design.feet
  if (!feet || !(feet.heightMm > 0) || !(feet.sizeMm > 0)) return []
  const region = bottom ?? buildRegions(design).bands[0]?.region ?? []
  const bb = multiBBox(profileToMulti(design.profile))
  const seats = feet.pattern === 'corners+edges'
    ? [...cornerSeats(bb, feet.sizeMm), ...edgeMidSeats(bb, feet.sizeMm)]
    : cornerSeats(bb, feet.sizeMm)
  return findSeats(region, feet.sizeMm, seats)
}

/**
 * The keep-out around each underside lift recess: its bounding box grown by the
 * dam. Derived from the bbox rather than a polygon buffer because there is no
 * buffer in this codebase, and the reliefs are rectangles, so the two agree.
 */
export function reliefKeepOuts(design: ToolTrayDesign): Polygon[] {
  const dam = THRESHOLDS.reliefDamMm
  return profileUndersideReliefs(design.profile).map(r => {
    const bb = multiBBox([[r.ring]])
    return [[
      [bb.minX - dam, bb.minY - dam], [bb.maxX + dam, bb.minY - dam],
      [bb.maxX + dam, bb.maxY + dam], [bb.minX - dam, bb.maxY + dam],
    ]] as Polygon
  })
}
