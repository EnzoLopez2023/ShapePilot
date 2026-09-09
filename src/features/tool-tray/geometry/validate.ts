// Placement and manufacturability checks for a tool tray. Nothing is
// auto-corrected -- the panel shows what applies and the user decides.
//
// The checks here are the ones a real tray needed. Every threshold came out of
// hand-building an S 76 insert for an X2D kit before this designer existed, and
// the lift-recess check in particular exists because that tray shipped a hole
// in its wall that was only found by rendering the mesh and looking at it. A
// validator is the right place to find that, not a render.
import type { BBox, MultiPolygon } from '../../../geometry/vec.ts'
import { bboxOverlaps, multiArea, multiBBox, ringBBox } from '../../../geometry/vec.ts'
import { difference, intersection } from '../../../geometry/boolean.ts'
import type { Mesh } from '../../../geometry/mesh.ts'
import { checkManifold } from '../../../geometry/mesh.ts'
import {
  profileInternalClearHeight, profileToMulti, profileTotalClearHeight,
  profileUndersideReliefs,
} from '../../../model/trayProfile.ts'
import { MATERIALS, type MaterialId } from '../../keycap-tray/model/materials.ts'
import type { ToolPocket, ToolTrayDesign } from '../model/types.ts'
import { THRESHOLDS } from '../model/thresholds.ts'
import { feetRects, levelOf, reliefKeepOuts, resolveLevels } from './bands.ts'
import { pocketFootprint } from './shapes.ts'

export type Severity = 'error' | 'warning'

export interface Issue {
  code: string
  severity: Severity
  message: string
  /** Pockets the issue is about, so the canvas can highlight them. */
  pocketIds?: string[]
}

export interface ToolTrayFabrication {
  plateWidthMm: number
  plateDepthMm: number
  /** Filament the floor-thickness rule is held to. */
  material: MaterialId
}

export const DEFAULT_TOOL_FABRICATION: ToolTrayFabrication = {
  plateWidthMm: 256,
  plateDepthMm: 256,
  material: 'generic',
}

/** Room a brim and the nozzle skirt want around the part. */
const PLATE_MARGIN_MM = 5

const name = (p: ToolPocket): string => p.label ?? p.presetId ?? p.id

/** Every pocket's footprint, computed once -- the checks below all want it. */
const footprints = (d: ToolTrayDesign): { pocket: ToolPocket; mp: MultiPolygon }[] =>
  d.pockets.map(pocket => ({ pocket, mp: pocketFootprint(pocket) }))

/**
 * Does every pocket leave the wall standing?
 *
 * Measured against the outline shrunk by nothing -- the pocket must simply sit
 * inside the profile, and separately far enough in that `wallMm` of material
 * survives. Broad-phased on bounding boxes first, as the keycap tray's own wall
 * check does.
 */
export function checkWall(d: ToolTrayDesign): Issue[] {
  const profile = profileToMulti(d.profile)
  const bb = multiBBox(profile)
  const out: Issue[] = []

  for (const { pocket, mp } of footprints(d)) {
    if (!mp.length) continue
    const outside = multiArea(difference(mp, profile))
    if (outside > 1e-6) {
      out.push({
        code: 'pocket-off-tray',
        severity: 'error',
        message: `${name(pocket)} hangs ${outside.toFixed(0)} mm² off the edge of the tray.`,
        pocketIds: [pocket.id],
      })
      continue
    }
    // Distance to the outline, from the pocket's own boundary.
    const pb = multiBBox(mp)
    if (!bboxOverlaps(pb, bb)) continue
    const gap = Math.min(
      ...profile.map(poly => Math.min(...mp.map(pp => ringDistance(pp[0]!, poly[0]!)))),
    )
    if (gap < THRESHOLDS.wallMm - 1e-6) {
      out.push({
        code: 'wall-too-thin',
        severity: 'error',
        message: `${name(pocket)} leaves ${gap.toFixed(2)} mm of wall; `
          + `${THRESHOLDS.wallMm} mm is the minimum.`,
        pocketIds: [pocket.id],
      })
    }
  }
  return out
}

/** Least distance between two closed rings, sampled at their vertices. */
function ringDistance(a: readonly (readonly [number, number])[],
                      b: readonly (readonly [number, number])[]): number {
  let best = Infinity
  for (const [px, py] of a) {
    for (let i = 0; i < b.length; i++) {
      const [x1, y1] = b[i]!
      const [x2, y2] = b[(i + 1) % b.length]!
      const dx = x2 - x1, dy = y2 - y1
      const len2 = dx * dx + dy * dy
      const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2))
      const d = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
      if (d < best) best = d
    }
  }
  return best
}

/** A bbox grown on every side, for a broad phase that has to catch near misses. */
const inflate = (b: BBox, by: number): BBox =>
  ({ minX: b.minX - by, minY: b.minY - by, maxX: b.maxX + by, maxY: b.maxY + by })

/** Is there printable material between neighbouring pockets? */
export function checkWebs(d: ToolTrayDesign): Issue[] {
  const fps = footprints(d).filter(f => f.mp.length)
  const out: Issue[] = []

  for (let i = 0; i < fps.length; i++) {
    for (let j = i + 1; j < fps.length; j++) {
      const a = fps[i]!, b = fps[j]!
      // Grown by the target web, because a pocket pair separated by a THIN web
      // has adjacent bounding boxes, not overlapping ones -- a plain overlap
      // test would skip exactly the pairs this check exists to find.
      if (!bboxOverlaps(inflate(multiBBox(a.mp), THRESHOLDS.targetWebMm), multiBBox(b.mp))) continue

      if (multiArea(intersection(a.mp, b.mp)) > 1e-6) {
        out.push({
          code: 'pockets-overlap',
          severity: 'error',
          message: `${name(a.pocket)} and ${name(b.pocket)} overlap.`,
          pocketIds: [a.pocket.id, b.pocket.id],
        })
        continue
      }
      const gap = Math.min(
        ...a.mp.map(pa => Math.min(...b.mp.map(pb => ringDistance(pa[0]!, pb[0]!)))),
      )
      if (gap < THRESHOLDS.minWebMm - 1e-6) {
        out.push({
          code: 'web-too-thin',
          severity: 'error',
          message: `${name(a.pocket)} and ${name(b.pocket)} leave ${gap.toFixed(2)} mm between them; `
            + `${THRESHOLDS.minWebMm} mm is the minimum.`,
          pocketIds: [a.pocket.id, b.pocket.id],
        })
      } else if (gap < THRESHOLDS.targetWebMm - 1e-6) {
        out.push({
          code: 'web-tight',
          severity: 'warning',
          message: `${name(a.pocket)} and ${name(b.pocket)} are ${gap.toFixed(2)} mm apart. `
            + `${THRESHOLDS.targetWebMm} mm prints more reliably.`,
          pocketIds: [a.pocket.id, b.pocket.id],
        })
      }
    }
  }
  return out
}

/**
 * Does any pocket break into one of the case's underside lift recesses?
 *
 * This is the check that exists because a hand-built tray shipped a hole. The
 * recesses reach 18.5 mm inboard from the left and right edges and are cut from
 * the underside, so a pocket placed near those edges whose floor sits below the
 * recess roof opens straight into it. `liftOverKeepOut` on a step is the
 * opt-out: hold that step's floor above the recess and leave a roof.
 */
export function checkLiftRecesses(d: ToolTrayDesign): Issue[] {
  if (d.undersideReliefs === 'ignore') return []
  const keepOuts = reliefKeepOuts(d)
  if (!keepOuts.length) return []

  const roofLevel = maxReliefHeight(d) + THRESHOLDS.reliefRoofMm
  const out: Issue[] = []

  for (const pocket of d.pockets) {
    for (const step of pocket.steps) {
      if (step.liftOverKeepOut) continue
      const floor = levelOf(step.depthMm, d)
      // A step whose floor is above the roof cannot reach the recess.
      if (floor >= roofLevel - 1e-9) continue
      const rings = pocketFootprint({ ...pocket, steps: [step], fingerAccess: undefined })
      if (!rings.length) continue
      for (const ko of keepOuts) {
        if (!bboxOverlaps(multiBBox(rings), ringBBox(ko[0]!))) continue
        if (multiArea(intersection(rings, [ko])) > 1e-6) {
          out.push({
            code: 'pocket-over-lift-recess',
            severity: 'error',
            message: `${name(pocket)} reaches into a hex-key lift recess in the tray's `
              + 'underside, which would open a hole in the wall. Move it inboard, or set '
              + 'the step to hold its floor above the recess.',
            pocketIds: [pocket.id],
          })
          break
        }
      }
    }
  }
  // One message per pocket is enough, however many steps foul it.
  return dedupe(out)
}

/** The tallest relief, since a step above all of them cannot reach any. */
const maxReliefHeight = (d: ToolTrayDesign): number => {
  let h = 0
  for (const r of profileUndersideReliefs(d.profile)) if (r.heightMm > h) h = r.heightMm
  return h
}

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>()
  return issues.filter(i => {
    const k = `${i.code}:${(i.pocketIds ?? []).join(',')}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Is there enough material, in whole layers, under each pocket floor? */
export function checkFloors(d: ToolTrayDesign, material: MaterialId): Issue[] {
  const minFloor = Math.max(d.minFloorMm, MATERIALS[material]?.minFloorMm ?? 0)
  const out: Issue[] = []

  for (const pocket of d.pockets) {
    for (const step of pocket.steps) {
      if (step.depthMm === null) continue
      const floor = levelOf(step.depthMm, d)
      if (floor < minFloor - 1e-9) {
        out.push({
          code: 'floor-too-thin',
          severity: 'warning',
          message: `${name(pocket)} leaves ${floor.toFixed(2)} mm of floor; `
            + `${minFloor.toFixed(2)} mm is the minimum for this filament.`,
          pocketIds: [pocket.id],
        })
      }
      const asked = d.heightMm - step.depthMm
      if (Math.abs(asked - floor) > 1e-9) {
        out.push({
          code: 'depth-snapped',
          severity: 'warning',
          message: `${name(pocket)} asked for ${step.depthMm.toFixed(2)} mm; `
            + `${(d.heightMm - floor).toFixed(2)} mm is the nearest whole layer.`,
          pocketIds: [pocket.id],
        })
      }
    }
  }
  return dedupe(out)
}

/**
 * Does the tray fit the case at all?
 *
 * Only the failure. How many stack is information, not a warning, and the panel
 * says it beside the case fields where it belongs -- reporting it here as well
 * put the same sentence on screen twice.
 */
export function checkCase(d: ToolTrayDesign): Issue[] {
  const clear = d.caseClearHeightMm ?? profileInternalClearHeight(d.profile)
  if (clear === null || d.heightMm <= clear) return []
  const total = profileTotalClearHeight(d.profile)
  return [{
    code: 'taller-than-case',
    severity: 'warning',
    message: `The tray is ${d.heightMm} mm and the case's base cavity is ${clear} mm.`
      + (total !== null && d.heightMm <= total
        ? ` It would fit the ${total} mm to the closed lid, but the lid's recess is inset`
          + ' from the case walls, so a full-width tray cannot use it.'
        : ''),
  }]
}

/** Does it fit the printer, with room for a brim? */
export function checkPlate(d: ToolTrayDesign, fab: ToolTrayFabrication): Issue[] {
  const bb = multiBBox(profileToMulti(d.profile))
  const w = bb.maxX - bb.minX
  const h = bb.maxY - bb.minY
  const fits = (a: number, b: number) => a <= fab.plateWidthMm && b <= fab.plateDepthMm
  if (!fits(w, h) && !fits(h, w)) {
    return [{
      code: 'exceeds-plate',
      severity: 'error',
      message: `The tray is ${w.toFixed(1)} × ${h.toFixed(1)} mm and the plate is `
        + `${fab.plateWidthMm} × ${fab.plateDepthMm} mm.`,
    }]
  }
  const margin = Math.min(fab.plateWidthMm - w, fab.plateDepthMm - h) / 2
  if (margin < PLATE_MARGIN_MM) {
    return [{
      code: 'plate-margin-tight',
      severity: 'warning',
      message: `Only ${margin.toFixed(1)} mm spare per side on the plate — print with the brim off.`,
    }]
  }
  return []
}

/** Are there more distinct floor levels than the mesher is willing to build? */
export function checkLevels(d: ToolTrayDesign): Issue[] {
  const n = resolveLevels(d).length
  if (n <= THRESHOLDS.maxDistinctLevels) return []
  return [{
    code: 'too-many-levels',
    severity: 'error',
    message: `${n} distinct pocket depths. ${THRESHOLDS.maxDistinctLevels} is the limit; `
      + 'round some depths to share a floor.',
  }]
}

/** Did every foot find somewhere solid to stand? */
export function checkFeet(d: ToolTrayDesign): Issue[] {
  const feet = d.feet
  if (!feet || !(feet.heightMm > 0) || !(feet.sizeMm > 0)) return []
  const wanted = feet.pattern === 'corners+edges' ? 8 : 4
  const got = feetRects(d).length
  if (got === wanted) return []
  return [{
    code: 'feet-do-not-fit',
    severity: 'warning',
    message: `${got} of ${wanted} posts found solid material. `
      + 'The others sit over a notch or a pocket.',
  }]
}

/** The mesh really is closed. The last word, and the cheapest to trust. */
export function checkMesh(mesh: Mesh): Issue[] {
  const report = checkManifold(mesh)
  if (report.ok) return []
  return [{
    code: 'mesh-not-closed',
    severity: 'error',
    message: `The solid has ${report.danglingEdges} unpaired edges. This is a bug — `
      + 'please report the design that produced it.',
  }]
}

export interface ValidateOptions {
  fabrication?: ToolTrayFabrication
  /** Pass a mesh already built for the preview to avoid building a second one. */
  mesh?: Mesh
}

export function validateDesign(d: ToolTrayDesign, opts: ValidateOptions = {}): Issue[] {
  const fab = opts.fabrication ?? DEFAULT_TOOL_FABRICATION
  return [
    ...checkLevels(d),
    ...checkWall(d),
    ...checkWebs(d),
    ...checkLiftRecesses(d),
    ...checkFloors(d, fab.material),
    ...checkFeet(d),
    ...checkPlate(d, fab),
    ...checkCase(d),
    ...(opts.mesh ? checkMesh(opts.mesh) : []),
  ]
}

/** Handy for a panel: does anything block a print? */
export const hasErrors = (issues: Issue[]): boolean => issues.some(i => i.severity === 'error')
