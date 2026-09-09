import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  buildBands, buildFeetMesh, buildNameplateMesh, buildSwitchTrayMesh, nameplateBox, placeGlyphs,
} from './layers.ts'
import { feetRects } from './feet.ts'
import { planFill } from './fill.ts'
import { checkNameplate, checkNameplatePlacement, validateDesign } from './validate.ts'
import { checkManifold } from '../../../geometry/mesh.ts'
import { profileToMulti } from '../../../model/trayProfile.ts'
import { writeBinaryStl } from '../../../export/stl.ts'
import {
  cellKeepoutMm, defaultFeet, defaultFill, defaultPlate, emptyDesign,
} from '../model/defaults.ts'
import { CHOC_V1, MX } from '../model/switches.ts'
import { stackBudget, stackHeightMm } from '../model/stack.ts'
import type {
  NameplateStyle, PresetProfileId, Retention, SwitchProfile, SwitchTrayDesign,
} from '../model/types.ts'
import { readFileSync } from 'node:fs'
import { parse } from 'opentype.js'
import { traceTextPolys } from '../../../text/fonts.ts'

function tray(
  retention: Retention, sw: SwitchProfile, id: PresetProfileId = 'systainer-s76-plain',
): SwitchTrayDesign {
  const plate = defaultPlate(retention, sw)
  return {
    ...emptyDesign(),
    profile: { kind: 'preset', id },
    switch: { ...sw },
    plate,
    fill: defaultFill(plate, sw),
    feet: defaultFeet(plate, sw),
  }
}

function planFor(d: SwitchTrayDesign) {
  return planFill({
    region: profileToMulti(d.profile),
    // The page reserves the name's box too, so the cells give way to it rather
    // than the two overlapping. A helper that skipped it would have every
    // nameplate test running against a layout the app never produces.
    blockers: [...feetRects(d.profile, d.feet), ...nameplateBox(d, d.nameplate ? OUTLINES : null)],
    keepoutMm: cellKeepoutMm(d.plate, d.switch),
    marginMm: d.fill.marginMm,
    pitchXMm: d.fill.pitchXMm,
    pitchYMm: d.fill.pitchYMm,
    stagger: d.fill.stagger,
    origin: d.fill.origin,
    spreadEvenly: d.fill.spreadEvenly,
    skippedCells: d.skippedCells,
  })
}

test('every retention style, switch and outline makes a watertight solid', () => {
  for (const id of ['systainer-s76-plain', 'systainer-s76-notched'] as const) {
    for (const retention of ['shelf', 'clip', 'plain'] as Retention[]) {
      for (const sw of [MX, CHOC_V1]) {
        const d = tray(retention, sw, id)
        const mesh = buildSwitchTrayMesh(d, planFor(d))
        const report = checkManifold(mesh)
        assert.ok(report.ok,
          `${id}/${retention}/${sw.id}: ${report.danglingEdges} unpaired edges`)
        assert.ok(report.volume > 0)
      }
    }
  }
})

test('a clip plate has no recess band; a shelf plate does', () => {
  const clip = tray('clip', MX)
  const clipBands = buildBands(clip, planFor(clip))
  assert.equal(clipBands.plateTopZ, clipBands.shelfTopZ)
  assert.deepEqual(clipBands.ledges, [])

  const shelf = tray('shelf', MX)
  const shelfBands = buildBands(shelf, planFor(shelf))
  assert.ok(shelfBands.plateTopZ > shelfBands.shelfTopZ)
  assert.ok(shelfBands.ledges.length > 0, 'the shelf a switch sits on is missing')
})

test('the solid stands on its feet, and is exactly one tier tall', () => {
  const d = tray('shelf', MX)
  const mesh = buildSwitchTrayMesh(d, planFor(d))
  const budget = stackBudget(d)
  assert.equal(mesh.bbox[2], 0, 'the feet should sit on z = 0')
  // feet + shelf + recess, and by construction that is one switch envelope
  // plus the stacking clearance.
  assert.ok(Math.abs(mesh.bbox[5] - budget.tierPitchMm) < 0.11,
    `tray is ${mesh.bbox[5]} mm tall, tier pitch is ${budget.tierPitchMm}`)
})

test('the tier pitch is the switch, not the plate', () => {
  // Whatever the plate does, a tier costs one switch envelope plus clearance.
  const mx = stackBudget(tray('shelf', MX))
  const choc = stackBudget(tray('shelf', CHOC_V1))
  assert.ok(Math.abs(mx.tierPitchMm - 20.4) < 1e-9)
  assert.ok(Math.abs(choc.tierPitchMm - 15.0) < 1e-9)
  // Half the switch, so Choc buys an extra tray in the same case.
  assert.ok(choc.tiers !== null && mx.tiers !== null && choc.tiers > mx.tiers)
  assert.equal(choc.tiers, 3)
})

test('a third MX tray does not fit the S76 base, and by how much', () => {
  // Worth pinning, because it is the number that decides whether the case
  // holds 2 trays or 3, and because it moved once already: before the bottom
  // tray's posts carried the same 0.5 mm clearance as a stacked one, three
  // came to 62.7 mm and "fitted" only by standing its pins on the floor.
  const mx = tray('shelf', MX)
  assert.equal(stackBudget(mx).tiers, 2)
  const three = stackHeightMm(mx, 3)
  assert.ok(three > 63 && three < 64, `three MX trays came to ${three} mm`)
  // The budget is now the case's *base cavity* -- 48 mm, from Festool's
  // published 258 x 164 x 67 internal less the lid recess -- which replaced a
  // 63 mm estimate derived from the outer height. Three MX trays come to ~63.3,
  // so they miss the base by a wide margin and would need the lid recess, which
  // is inset from the walls and cannot take a full-footprint tray.
  assert.equal(stackBudget({ ...mx, caseClearHeightMm: 63.5 }).tiers, 3)
  // And the answer is still sensitive at its own boundary.
  assert.equal(stackBudget({ ...mx, caseClearHeightMm: 63 }).tiers, 2)
})

test('a bottom tray is built shorter than a stacked one, and is not called short for it', () => {
  const stacked = tray('shelf', MX)
  const bottom = { ...stacked, feet: { ...stacked.feet!, tier: 'bottom' as const } }

  const stackedMesh = buildSwitchTrayMesh(stacked, planFor(stacked))
  const bottomMesh = buildSwitchTrayMesh(bottom, planFor(bottom))
  // The whole point: the export really is the shorter tray.
  assert.ok(bottomMesh.bbox[5] < stackedMesh.bbox[5],
    `bottom tray is ${bottomMesh.bbox[5]} mm, stacked is ${stackedMesh.bbox[5]}`)
  assert.ok(checkManifold(bottomMesh).ok)

  // ...and the posts that would be far too short to stack on are correct here.
  const issues = validateDesign(bottom, planFor(bottom), {
    fittedFeet: feetRects(bottom.profile, bottom.feet).length, mesh: bottomMesh,
  })
  assert.deepEqual(issues, [], JSON.stringify(issues, null, 2))
})

test('a bottom tray whose pins would touch the floor is still an error', () => {
  const bottom = tray('shelf', MX)
  bottom.feet = { ...bottom.feet!, tier: 'bottom', bottomTierHeightMm: 2 }
  const issues = validateDesign(bottom, planFor(bottom), { fittedFeet: 4 })
  const short = issues.find(i => i.code === 'feet-too-short')
  assert.ok(short, 'no feet-too-short issue')
  assert.equal(short.severity, 'error')
  assert.match(short.message, /touching the case floor/)
})

test('the feet can come out as their own body for a second filament', () => {
  const d = tray('shelf', MX)
  d.feet = { ...d.feet!, separate: true }
  const feet = buildFeetMesh(d)
  assert.ok(feet, 'no separate feet body')
  assert.ok(checkManifold(feet).ok)

  const whole = buildSwitchTrayMesh(d, planFor(d))
  const body = buildSwitchTrayMesh(d, planFor(d), { omitSeparateParts: true })
  assert.ok(body.triangleCount < whole.triangleCount, 'the feet were not left out')
  assert.ok(checkManifold(body).ok)
})

test('an STL round-trips the triangle count', () => {
  const d = tray('clip', MX)
  const mesh = buildSwitchTrayMesh(d, planFor(d))
  const stl = writeBinaryStl(mesh, 'switch tray')
  const view = new DataView(stl)
  assert.equal(view.getUint32(80, true), mesh.triangleCount)
  assert.equal(stl.byteLength, 84 + mesh.triangleCount * 50)
})

test('a well-formed tray raises no issues', () => {
  const d = tray('shelf', MX)
  const plan = planFor(d)
  const mesh = buildSwitchTrayMesh(d, plan)
  const issues = validateDesign(d, plan, {
    fittedFeet: feetRects(d.profile, d.feet).length, mesh,
  })
  assert.deepEqual(issues, [], JSON.stringify(issues, null, 2))
})

test('feet too short to stack are an error, not a shrug', () => {
  const d = tray('shelf', MX)
  d.feet = { ...d.feet!, heightMm: 4 }
  const plan = planFor(d)
  const issues = validateDesign(d, plan, { fittedFeet: 4 })
  assert.ok(issues.some(i => i.code === 'feet-too-short' && i.severity === 'error'))
})

test('a pitch that leaves no wall between cells is an error', () => {
  const d = tray('shelf', MX)
  d.fill = { ...d.fill, pitchXMm: 16, pitchYMm: 16, spreadEvenly: false }
  const plan = planFor(d)
  const issues = validateDesign(d, plan, { fittedFeet: 4 })
  assert.ok(issues.some(i => i.code === 'wall-too-thin' && i.severity === 'error'))
})

// -- the name on the plate ----------------------------------------------------

const font = (() => {
  const buf = readFileSync('public/fonts/archivo-medium.ttf')
  return parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
})()

const OUTLINES = traceTextPolys(font as never, 'MX BROWN', 8)

const named = (style: NameplateStyle): SwitchTrayDesign => ({
  ...tray('shelf', MX),
  name: 'MX BROWN',
  nameplate: { style, heightMm: 1.2, depthMm: 0.6, fontSizeMm: 8, x: 124, y: 20 },
})

/**
 * Volumes are summed over tens of thousands of triangles, so they agree to
 * about one part in a billion rather than exactly. A thousandth of a cubic
 * millimetre is orders below anything a nozzle can express, and still four
 * orders tighter than the smallest feature here.
 */
const sameVolume = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3

test('every nameplate style makes a watertight plate', () => {
  for (const style of ['inlay', 'inset', 'raised'] as NameplateStyle[]) {
    const d = named(style)
    for (const omit of [false, true]) {
      const mesh = buildSwitchTrayMesh(d, planFor(d), {
        nameplateOutlines: OUTLINES, omitSeparateParts: omit,
      })
      const report = checkManifold(mesh)
      assert.ok(report.ok, `${style} (omit ${omit}): ${report.danglingEdges} unpaired edges`)
    }
    const body = buildNameplateMesh(d, planFor(d), OUTLINES)
    if (body) assert.ok(checkManifold(body).ok, `${style} name body is not watertight`)
  }
})

test('an inlay and the plate it came out of add up to an uncut plate', () => {
  // The whole point of the flush style: no material added, none lost, just two
  // colours. Held against the *same* layout with the cut absent, so the only
  // difference being measured is the name.
  const d = named('inlay')
  const plan = planFor(d)
  const cut = checkManifold(
    buildSwitchTrayMesh(d, plan, { nameplateOutlines: OUTLINES, omitSeparateParts: true })).volume
  const uncut = checkManifold(buildSwitchTrayMesh(d, plan, {})).volume
  const inlay = buildNameplateMesh(d, plan, OUTLINES)
  assert.ok(inlay)
  const together = cut + checkManifold(inlay).volume
  assert.ok(sameVolume(together, uncut), `inlay + plate = ${together}, uncut plate = ${uncut}`)
})

test('an inset removes material and an inlay gives it back', () => {
  const inset = named('inset')
  const insetPlan = planFor(inset)
  const uncut = checkManifold(buildSwitchTrayMesh(inset, insetPlan, {})).volume
  const grooved = checkManifold(
    buildSwitchTrayMesh(inset, insetPlan, { nameplateOutlines: OUTLINES })).volume
  assert.ok(grooved < uncut, 'the groove removed nothing')

  // Same cut, so the plate side of an inlay is exactly the inset.
  const inlay = named('inlay')
  const inlayPlate = checkManifold(buildSwitchTrayMesh(inlay, planFor(inlay), {
    nameplateOutlines: OUTLINES, omitSeparateParts: true,
  })).volume
  assert.ok(sameVolume(grooved, inlayPlate))
})

test('only a raised name stops the plate lying flat', () => {
  // The reason the flush style exists: this tray prints top-face-down.
  const top = (style: NameplateStyle) =>
    buildSwitchTrayMesh(named(style), planFor(named(style)), { nameplateOutlines: OUTLINES })
      .bbox[5]
  const flat = buildSwitchTrayMesh(named('inlay'), planFor(named('inlay')), {}).bbox[5]
  assert.equal(top('inlay'), flat)
  assert.equal(top('inset'), flat)
  assert.ok(top('raised') > flat, 'a raised name did not stand proud')
})

test('an inset has no second body; an inlay and a boss do', () => {
  assert.equal(buildNameplateMesh(named('inset'), planFor(named('inset')), OUTLINES), null)
  assert.ok(buildNameplateMesh(named('inlay'), planFor(named('inlay')), OUTLINES))
  assert.ok(buildNameplateMesh(named('raised'), planFor(named('raised')), OUTLINES))
  // Nothing to trace, nothing to build.
  assert.equal(buildNameplateMesh(named('inlay'), planFor(named('inlay')), null), null)
})

test('the name reserves its own space, and the cells give way', () => {
  const d = named('inlay')
  const box = nameplateBox(d, OUTLINES)
  assert.equal(box.length, 1)

  const free = planFill({
    region: profileToMulti(d.profile),
    blockers: feetRects(d.profile, d.feet),
    keepoutMm: cellKeepoutMm(d.plate, d.switch),
    marginMm: d.fill.marginMm,
    pitchXMm: d.fill.pitchXMm,
    pitchYMm: d.fill.pitchYMm,
    stagger: d.fill.stagger,
    origin: d.fill.origin,
    spreadEvenly: d.fill.spreadEvenly,
  }).fitted
  const withName = planFill({
    region: profileToMulti(d.profile),
    blockers: [...feetRects(d.profile, d.feet), ...box],
    keepoutMm: cellKeepoutMm(d.plate, d.switch),
    marginMm: d.fill.marginMm,
    pitchXMm: d.fill.pitchXMm,
    pitchYMm: d.fill.pitchYMm,
    stagger: d.fill.stagger,
    origin: d.fill.origin,
    spreadEvenly: d.fill.spreadEvenly,
  }).fitted
  assert.ok(withName < free, 'the name took no cells at all')
  assert.ok(withName >= free - 8, `the name took ${free - withName} cells, expected at most 8`)
})

test('the glyphs land where the anchor says', () => {
  const d = named('inlay')
  const moved = { ...d, nameplate: { ...d.nameplate!, x: d.nameplate!.x + 30 } }
  const at = (t: SwitchTrayDesign) =>
    Math.min(...placeGlyphs(t, OUTLINES).flat().flat().map(([x]) => x))
  assert.ok(Math.abs(at(moved) - at(d) - 30) < 1e-9)
})

const glyphsFor = (d: SwitchTrayDesign, size = 8) =>
  placeGlyphs(d, traceTextPolys(font as never, d.name, size))

test('an inset needs a heavier stroke than an inlay, because shadow is less forgiving', () => {
  // The whole trade in one assertion: an inset is read by the groove's shadow,
  // which first-layer squish closes; an inlay is read by colour, which a single
  // bead still carries.
  const warns = (style: NameplateStyle, size: number) => {
    const d = { ...named(style), nameplate: { ...named(style).nameplate!, fontSizeMm: size } }
    return checkNameplate(d, glyphsFor(d, size)).some(i => i.code === 'nameplate-stroke-thin')
  }
  assert.equal(warns('inset', 6), true, 'a 6 mm inset should be flagged as too fine')
  assert.equal(warns('inset', 8), false, 'an 8 mm inset is the size that comes out crisp')
  assert.equal(warns('inlay', 5), false, 'colour carries a stroke that shadow would not')
  assert.equal(warns('inlay', 4), true, 'below one extrusion even an inlay may drop out')
})

test('a cut deeper than the plate is an error, whatever it would look like', () => {
  const d = named('inlay')
  const deep = { ...d, nameplate: { ...d.nameplate!, depthMm: 4 } }
  const issue = checkNameplate(deep, glyphsFor(deep)).find(i => i.code === 'nameplate-too-deep')
  assert.ok(issue)
  assert.equal(issue.severity, 'error')
  // The plate is 3.6 mm; the message should say so rather than just refusing.
  assert.match(issue.message, /3\.60 mm plate/)
})

test('a name dragged off the plate says so instead of silently vanishing', () => {
  const d = named('inlay')
  const off = { ...d, nameplate: { ...d.nameplate!, x: 40, y: -60 } }
  const glyphs = glyphsFor(off)
  const solid = buildBands(off, planFor(off), glyphs).nameplateSolid
  const issues = checkNameplatePlacement(off, glyphs, solid)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].code, 'nameplate-off-plate')

  // Where it belongs, nothing is said.
  const on = glyphsFor(d)
  assert.deepEqual(
    checkNameplatePlacement(d, on, buildBands(d, planFor(d), on).nameplateSolid), [])
})

test('a name hanging over the edge reports how much of it is lost', () => {
  const d = named('inlay')
  const half = { ...d, nameplate: { ...d.nameplate!, x: -20 } }
  const glyphs = glyphsFor(half)
  const solid = buildBands(half, planFor(half), glyphs).nameplateSolid
  const issue = checkNameplatePlacement(half, glyphs, solid)
    .find(i => i.code === 'nameplate-clipped')
  assert.ok(issue, 'a half-off name was not reported')
  assert.match(issue.message, /% of the name hangs over/)
})

test('a raised name is checked for landing on plate too', () => {
  // A boss with nothing under it is as wrong as an inlay with nothing to fill,
  // so the placement check must not depend on there being a cut.
  const d = named('raised')
  const glyphs = glyphsFor(d)
  assert.ok(buildBands(d, planFor(d), glyphs).nameplateSolid.length > 0)
  assert.deepEqual(
    checkNameplatePlacement(d, glyphs, buildBands(d, planFor(d), glyphs).nameplateSolid), [])
})

test('a well-named tray raises nothing at all', () => {
  const d = named('inlay')
  const glyphs = glyphsFor(d)
  const mesh = buildSwitchTrayMesh(d, planFor(d), { nameplateOutlines: OUTLINES })
  const issues = validateDesign(d, planFor(d), {
    fittedFeet: feetRects(d.profile, d.feet).length,
    mesh,
    nameplateGlyphs: glyphs,
    nameplateSolid: buildBands(d, planFor(d), glyphs).nameplateSolid,
  })
  assert.deepEqual(issues, [], JSON.stringify(issues, null, 2))
})

test('a nameplate configured but not yet traced still builds a solid plate', () => {
  // The font loads asynchronously, so every first paint has a design that wants
  // a 0.6 mm cut and no glyphs to cut with. That must be a plate with no cut at
  // all, not one with a band that nothing fills -- it used to leak 7,496 edges.
  for (const style of ['inlay', 'inset', 'raised'] as NameplateStyle[]) {
    const d = named(style)
    const report = checkManifold(buildSwitchTrayMesh(d, planFor(d), {}))
    assert.ok(report.ok, `${style}: ${report.danglingEdges} unpaired edges before the font loaded`)
  }
})
