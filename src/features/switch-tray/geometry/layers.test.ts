import assert from 'node:assert/strict'
import { test } from 'vitest'
import { buildBands, buildFeetMesh, buildSwitchTrayMesh } from './layers.ts'
import { feetRects } from './feet.ts'
import { planFill } from './fill.ts'
import { validateDesign } from './validate.ts'
import { checkManifold } from '../../../geometry/mesh.ts'
import { profileToMulti } from '../../../model/trayProfile.ts'
import { writeBinaryStl } from '../../../export/stl.ts'
import {
  cellKeepoutMm, defaultFeet, defaultFill, defaultPlate, emptyDesign,
} from '../model/defaults.ts'
import { CHOC_V1, MX } from '../model/switches.ts'
import { stackBudget, stackHeightMm } from '../model/stack.ts'
import type { PresetProfileId, Retention, SwitchProfile, SwitchTrayDesign } from '../model/types.ts'

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
    blockers: feetRects(d.profile, d.feet),
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
  // Half the switch, so Choc buys two extra trays in the same case.
  assert.ok(choc.tiers !== null && mx.tiers !== null && choc.tiers > mx.tiers)
  assert.equal(choc.tiers, 4)
})

test('a third MX tray misses the S76 by a third of a millimetre', () => {
  // Worth pinning, because it is the number that decides whether the case
  // holds 2 trays or 3, and because it moved once already: before the bottom
  // tray's posts carried the same 0.5 mm clearance as a stacked one, three
  // came to 62.7 mm and "fitted" only by standing its pins on the floor.
  const mx = tray('shelf', MX)
  assert.equal(stackBudget(mx).tiers, 2)
  const three = stackHeightMm(mx, 3)
  assert.ok(three > 63 && three < 64, `three MX trays came to ${three} mm`)
  // The 63 mm is an estimate, not a measurement, so the answer is sensitive to
  // it: a case half a millimetre taller holds the third tray.
  assert.equal(stackBudget({ ...mx, caseClearHeightMm: 63.5 }).tiers, 3)
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
