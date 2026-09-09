import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import {
  checkCase, checkFeet, checkFloors, checkLevels, checkLiftRecesses, checkMesh, checkPlate,
  checkWall, checkWebs, hasErrors, validateDesign,
} from './validate.ts'
import { buildToolTrayMesh } from './bands.ts'
import { emptyDesign } from '../model/defaults.ts'
import { THRESHOLDS } from '../model/thresholds.ts'
import type { PocketStep, ToolPocket, ToolTrayDesign } from '../model/types.ts'
import { getPreset } from '../../../model/trayProfile.ts'

let seq = 0
const bin = (
  x: number, y: number, w: number, h: number, depthMm: number | null,
  extra: Partial<ToolPocket> = {},
): ToolPocket => ({
  id: `p${++seq}`, kind: 'bin', x, y, widthMm: w, heightMm: h,
  steps: [{ shape: { kind: 'rect', widthMm: w, heightMm: h }, depthMm }],
  ...extra,
})

const tray = (pockets: ToolPocket[], over: Partial<ToolTrayDesign> = {}): ToolTrayDesign =>
  ({ ...emptyDesign(), pockets, ...over })

const codes = (issues: { code: string }[]): string[] => issues.map(i => i.code)

// The notched S76 is 249 x 165.483, and its lift recesses sit at x 0..18.5 and
// 230.5..249.0 in that frame.
const W = getPreset('systainer-s76-notched').widthMm
const H = getPreset('systainer-s76-notched').heightMm

describe('the wall to the outside', () => {
  test('a pocket well inside is fine', () => {
    assert.deepEqual(codes(checkWall(tray([bin(60, 60, 40, 30, 10)]))), [])
  })

  test('a pocket hanging off the tray is an error, and says how far', () => {
    const issues = checkWall(tray([bin(-30, 60, 40, 30, 10)]))
    assert.deepEqual(codes(issues), ['pocket-off-tray'])
    assert.match(issues[0]!.message, /mm² off the edge/)
  })

  test('just inside the wall passes and just outside fails', () => {
    // The outline's left edge is x = 0 over the middle of its height.
    const ok = checkWall(tray([bin(THRESHOLDS.wallMm + 0.05, 70, 30, 20, 10)]))
    assert.deepEqual(codes(ok), [])
    const bad = checkWall(tray([bin(THRESHOLDS.wallMm - 0.3, 70, 30, 20, 10)]))
    assert.deepEqual(codes(bad), ['wall-too-thin'])
  })
})

describe('the web between pockets', () => {
  const at = (gap: number) =>
    checkWebs(tray([bin(40, 60, 30, 20, 10), bin(40 + 30 + gap, 60, 30, 20, 10)]))

  test('a comfortable web is silent', () => {
    assert.deepEqual(codes(at(THRESHOLDS.targetWebMm + 0.5)), [])
  })

  test('between the minimum and the target it warns', () => {
    const issues = at((THRESHOLDS.minWebMm + THRESHOLDS.targetWebMm) / 2)
    assert.deepEqual(codes(issues), ['web-tight'])
    assert.equal(issues[0]!.severity, 'warning')
  })

  test('below the minimum it errors', () => {
    const issues = at(THRESHOLDS.minWebMm - 0.5)
    assert.deepEqual(codes(issues), ['web-too-thin'])
    assert.equal(issues[0]!.severity, 'error')
  })

  test('overlapping pockets are called overlapping, not thin', () => {
    const issues = checkWebs(tray([bin(40, 60, 40, 30, 10), bin(60, 60, 40, 30, 14)]))
    assert.deepEqual(codes(issues), ['pockets-overlap'])
  })

  test('both pockets are named, so the canvas can highlight them', () => {
    const issues = at(1)
    assert.equal(issues[0]!.pocketIds?.length, 2)
  })
})

describe('the underside lift recesses', () => {
  /**
   * The frame conversion, pinned in the terms the plan states it: in a frame
   * centred on the tray, a pocket edge at |x| = 104 fouls a recess and one at
   * |x| = 103 does not, once the 2.5 mm dam is allowed for. Here in the
   * preset's own 0-based frame, where the recess runs x 0..18.5 and the dam
   * puts the keep-out edge at 21.
   */
  const recessMidY = 47.24 // between 37.242 and 57.242

  test('a deep pocket over a recess is an error', () => {
    const d = tray([bin(6, recessMidY - 10, 30, 20, 19)], { undersideReliefs: 'avoid' })
    assert.deepEqual(codes(checkLiftRecesses(d)), ['pocket-over-lift-recess'])
  })

  test('the same pocket moved inboard of the dam is fine', () => {
    const d = tray([bin(22, recessMidY - 10, 30, 20, 19)], { undersideReliefs: 'avoid' })
    assert.deepEqual(codes(checkLiftRecesses(d)), [])
  })

  test('a pocket at the same x but clear of the recess bands is fine', () => {
    // y = 80 sits between the two bands (57.242 .. 110.742).
    const d = tray([bin(6, 80, 30, 20, 19)], { undersideReliefs: 'avoid' })
    assert.deepEqual(codes(checkLiftRecesses(d)), [])
  })

  test('a shallow pocket over a recess is fine -- its floor is above the roof', () => {
    // Floor must sit at or above 5 + 1.2. A 2 mm deep pocket in a 21 mm tray
    // has its floor at 19, well clear.
    const d = tray([bin(6, recessMidY - 10, 30, 20, 2)], { undersideReliefs: 'avoid' })
    assert.deepEqual(codes(checkLiftRecesses(d)), [])
  })

  test('a step that opts into holding its floor up is not an error', () => {
    const steps: PocketStep[] = [{
      shape: { kind: 'rect', widthMm: 30, heightMm: 20 }, depthMm: 19, liftOverKeepOut: true,
    }]
    const d = tray([{ ...bin(6, recessMidY - 10, 30, 20, 19), steps }],
      { undersideReliefs: 'avoid' })
    assert.deepEqual(codes(checkLiftRecesses(d)), [])
  })

  test("'ignore' means ignore, even right over a recess", () => {
    const d = tray([bin(6, recessMidY - 10, 30, 20, 19)], { undersideReliefs: 'ignore' })
    assert.deepEqual(codes(checkLiftRecesses(d)), [])
  })

  test('an outline with no recesses cannot foul one', () => {
    const d = tray([bin(6, 20, 30, 20, 19)], {
      profile: { kind: 'rect', widthMm: 200, heightMm: 140 }, undersideReliefs: 'avoid',
    })
    assert.deepEqual(codes(checkLiftRecesses(d)), [])
  })

  test('one message per pocket, however many of its steps foul the recess', () => {
    const steps: PocketStep[] = [
      { shape: { kind: 'rect', widthMm: 30, heightMm: 8 }, offset: [0, 0], depthMm: 19 },
      { shape: { kind: 'rect', widthMm: 30, heightMm: 8 }, offset: [0, 10], depthMm: 18 },
    ]
    const d = tray([{ ...bin(6, recessMidY - 10, 30, 20, 19), steps }],
      { undersideReliefs: 'avoid' })
    assert.equal(checkLiftRecesses(d).length, 1)
  })
})

describe('floors', () => {
  test('a pocket that leaves too little floor warns', () => {
    const d = tray([bin(60, 60, 30, 20, 20)], { heightMm: 21, minFloorMm: 1.6 })
    assert.ok(codes(checkFloors(d, 'generic')).includes('floor-too-thin'))
  })

  test('a sound floor is silent', () => {
    const d = tray([bin(60, 60, 30, 20, 19)], { heightMm: 21, minFloorMm: 1.6 })
    assert.deepEqual(codes(checkFloors(d, 'generic')), [])
  })

  test('a depth that is not a whole number of layers says what it became', () => {
    const d = tray([bin(60, 60, 30, 20, 10.37)], { heightMm: 21, layerHeightMm: 0.2 })
    const issues = checkFloors(d, 'generic')
    assert.deepEqual(codes(issues), ['depth-snapped'])
    assert.match(issues[0]!.message, /10\.40 mm is the nearest whole layer/)
  })

  test('a through-cut has no floor to be thin', () => {
    assert.deepEqual(codes(checkFloors(tray([bin(60, 60, 30, 20, null)]), 'generic')), [])
  })
})

describe('the case and the plate', () => {
  test('a stack budget is reported against the base cavity', () => {
    const issues = checkCase(tray([], { heightMm: 21 }))
    assert.deepEqual(codes(issues), ['stack-budget'])
    // 48 / 21 -> 2.
    assert.match(issues[0]!.message, /^2 of these stack in the 48 mm base cavity/)
  })

  test('a tray taller than the base cavity says the lid recess cannot help', () => {
    const issues = checkCase(tray([], { heightMm: 55 }))
    assert.deepEqual(codes(issues), ['taller-than-case'])
    assert.match(issues[0]!.message, /67 mm to the closed lid/)
    assert.match(issues[0]!.message, /inset\s+from the case walls/)
  })

  test('an override beats the profile', () => {
    const issues = checkCase(tray([], { heightMm: 21, caseClearHeightMm: 63 }))
    assert.match(issues[0]!.message, /3 of these stack in the 63 mm/)
  })

  test('the notched outline fits the X2D plate, but only just', () => {
    const issues = checkPlate(tray([]), { plateWidthMm: 256, plateDepthMm: 256, material: 'generic' })
    assert.deepEqual(codes(issues), ['plate-margin-tight'])
    assert.match(issues[0]!.message, /3\.5 mm spare per side/)
  })

  test('an outline bigger than the plate is an error', () => {
    const d = tray([], { profile: { kind: 'rect', widthMm: 400, heightMm: 300 } })
    assert.deepEqual(
      codes(checkPlate(d, { plateWidthMm: 256, plateDepthMm: 256, material: 'generic' })),
      ['exceeds-plate'])
  })

  test('a tray that fits with room is silent', () => {
    const d = tray([], { profile: { kind: 'rect', widthMm: 200, heightMm: 140 } })
    assert.deepEqual(
      codes(checkPlate(d, { plateWidthMm: 256, plateDepthMm: 256, material: 'generic' })), [])
  })
})

describe('level count', () => {
  test('a sane tray is silent', () => {
    assert.deepEqual(codes(checkLevels(tray([bin(60, 60, 30, 20, 10)]))), [])
  })

  test('more depths than the mesher will build is an error', () => {
    const pockets = Array.from({ length: THRESHOLDS.maxDistinctLevels + 4 }, (_, i) =>
      bin(4 + i * 8, 60, 6, 6, 2 + i * 0.4))
    const issues = checkLevels(tray(pockets))
    assert.deepEqual(codes(issues), ['too-many-levels'])
    assert.equal(issues[0]!.severity, 'error')
  })
})

describe('feet', () => {
  test('four posts that all find material are silent', () => {
    const d = tray([], { feet: { heightMm: 6, sizeMm: 8, pattern: 'corners' } })
    assert.deepEqual(codes(checkFeet(d)), [])
  })

  test('a post that cannot be seated is reported with a count', () => {
    // A post far bigger than the tray cannot be seated anywhere.
    const d = tray([], {
      profile: { kind: 'rect', widthMm: 40, heightMm: 40 },
      feet: { heightMm: 6, sizeMm: 60, pattern: 'corners' },
    })
    const issues = checkFeet(d)
    assert.deepEqual(codes(issues), ['feet-do-not-fit'])
    assert.match(issues[0]!.message, /0 of 4 posts/)
  })
})

describe('the mesh', () => {
  test('a real tray closes, so checkMesh is silent', () => {
    const d = tray([bin(30, 30, 40, 30, 12), bin(90, 30, 40, 30, 19)])
    assert.deepEqual(codes(checkMesh(buildToolTrayMesh(d))), [])
  })
})

describe('validateDesign', () => {
  test('a clean tray on the real outline reports only the plate margin', () => {
    // 249 mm on a 256 mm plate is genuinely tight; that warning is correct and
    // is the one thing a good tray still says.
    const d = tray([bin(40, 60, 40, 30, 12), bin(100, 60, 40, 30, 19)])
    const issues = validateDesign(d, { mesh: buildToolTrayMesh(d) })
    assert.equal(hasErrors(issues), false)
    assert.deepEqual(codes(issues).filter(c => c !== 'stack-budget'), ['plate-margin-tight'])
  })

  test('errors are surfaced together, not one at a time', () => {
    const d = tray([
      bin(6, 47, 30, 20, 19),        // over a lift recess
      bin(37, 47, 30, 20, 19),       // and too close to the one before
    ], { undersideReliefs: 'avoid' })
    const found = codes(validateDesign(d))
    assert.ok(found.includes('pocket-over-lift-recess'))
    assert.ok(found.includes('web-too-thin') || found.includes('web-tight'))
    assert.equal(hasErrors(validateDesign(d)), true)
  })

  test('the outline it was all measured for is the right size', () => {
    assert.ok(Math.abs(W - 249) < 1e-6)
    assert.ok(Math.abs(H - 165.4826) < 1e-3)
  })
})
