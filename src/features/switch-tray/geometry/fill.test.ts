import assert from 'node:assert/strict'
import { test } from 'vitest'
import { buildSolidMask, cellKey, planFill, type FillRequest } from './fill.ts'
import { cornerRects } from './feet.ts'
import { profileToMulti } from '../../../model/trayProfile.ts'
import { multiArea, translateRing } from '../../../geometry/vec.ts'
import { difference } from '../../../geometry/boolean.ts'
import { rectRing } from '../../../geometry/primitives.ts'
import type { MultiPolygon, Polygon } from '../../../geometry/vec.ts'
import type { TrayProfile } from '../model/types.ts'

const req = (region: MultiPolygon, over: Partial<FillRequest> = {}): FillRequest => ({
  region,
  blockers: [],
  keepoutMm: 14.2,
  marginMm: 3,
  pitchXMm: 16,
  pitchYMm: 16,
  stagger: 'none',
  origin: 'maximised',
  spreadEvenly: false,
  ...over,
})

const preset = (id: 'systainer-s76-plain' | 'systainer-s76-notched'): MultiPolygon =>
  profileToMulti({ kind: 'preset', id } as TrayProfile)

/** The slow, obviously-correct answer: is the square wholly on the outline? */
const reallyFits = (region: MultiPolygon, cx: number, cy: number, size: number): boolean => {
  const rect: Polygon = [translateRing(rectRing(size, size), cx - size / 2, cy - size / 2)]
  return multiArea(difference([rect], region)) < 1e-6
}

test('a plain rectangle packs exactly as many cells as the arithmetic says', () => {
  // 248 x 156, 3 mm margin, 14.2 mm cells: 15 x 9 at a 16 mm pitch, and the
  // count falls in steps as the pitch opens up.
  const region = preset('systainer-s76-plain')
  const mask = buildSolidMask(region, [])
  const at = (pitch: number) =>
    planFill(req(region, { pitchXMm: pitch, pitchYMm: pitch }), mask).fitted
  assert.equal(at(16), 135)
  assert.equal(at(17), 112)
  assert.equal(at(18), 104)
  assert.equal(at(19.05), 96)
})

test('a drop-in shelf packs fewer, because the recess is what has to clear', () => {
  const region = preset('systainer-s76-plain')
  const mask = buildSolidMask(region, [])
  const at = (pitch: number) =>
    planFill(req(region, { keepoutMm: 15.9, pitchXMm: pitch, pitchYMm: pitch }), mask).fitted
  assert.equal(at(17.1), 112)
  assert.equal(at(17.5), 104)
})

test('every planned cell really does sit on solid material', () => {
  // The mask is conservative, so it may reject a cell that would just fit; it
  // must never accept one that would not.
  for (const id of ['systainer-s76-plain', 'systainer-s76-notched'] as const) {
    const region = preset(id)
    const plan = planFill(req(region))
    assert.ok(plan.fitted > 100, `${id} planned ${plan.fitted} cells`)
    for (const c of plan.cells) {
      assert.ok(
        reallyFits(region, c.cx, c.cy, 14.2 + 2 * 3),
        `${id} cell at ${c.cx.toFixed(2)},${c.cy.toFixed(2)} hangs off the outline`)
    }
  }
})

test('the notched outline costs cells the bounding box would promise', () => {
  // 249 x 165.5 looks like room for ten rows; the notches along the bottom edge
  // mean only nine fit. This is the number the panel reports.
  const plan = planFill(req(preset('systainer-s76-notched')))
  assert.equal(plan.rows, 9)
  assert.equal(plan.fitted, 128)
})

test('searching the origin never does worse than centring it', () => {
  for (const id of ['systainer-s76-plain', 'systainer-s76-notched'] as const) {
    const region = preset(id)
    const mask = buildSolidMask(region, [])
    const best = planFill(req(region, { origin: 'maximised' }), mask).fitted
    const centred = planFill(req(region, { origin: 'centred' }), mask).fitted
    assert.ok(best >= centred, `${id}: maximised ${best} < centred ${centred}`)
  }
})

test('spreading opens the pitch up without losing a cell', () => {
  const region = preset('systainer-s76-plain')
  const mask = buildSolidMask(region, [])
  const tight = planFill(req(region), mask)
  const spread = planFill(req(region, { spreadEvenly: true }), mask)
  assert.equal(spread.fitted, tight.fitted)
  assert.ok(spread.pitchXMm > tight.pitchXMm, 'X pitch did not open up')
  assert.ok(spread.pitchYMm > tight.pitchYMm, 'Y pitch did not open up')
  for (const c of spread.cells) {
    assert.ok(reallyFits(region, c.cx, c.cy, 14.2 + 2 * 3))
  }
})

test('a post takes the cells that would have stood on it', () => {
  const profile: TrayProfile = { kind: 'preset', id: 'systainer-s76-plain' }
  const region = profileToMulti(profile)
  const blockers = cornerRects(profile, { heightMm: 17, sizeMm: 12, pattern: 'corners' })
  assert.equal(blockers.length, 4)
  const free = planFill(req(region)).fitted
  const blocked = planFill(req(region, { blockers })).fitted
  assert.ok(blocked < free, 'posts took no cells at all')
  assert.ok(blocked >= free - 8, `posts took ${free - blocked} cells, expected at most 8`)
})

test('a skipped cell is dropped, and only that one', () => {
  const region = preset('systainer-s76-plain')
  const mask = buildSolidMask(region, [])
  const all = planFill(req(region), mask)
  const one = all.cells[10]
  const some = planFill(
    { ...req(region), skippedCells: [cellKey(one.col, one.row)] }, mask)
  assert.equal(some.skipped, 1)
  assert.equal(some.cells.length, all.cells.length - 1)
  assert.ok(!some.cells.some(c => c.col === one.col && c.row === one.row))
})

test('a margin wider than the tray plans nothing rather than throwing', () => {
  const plan = planFill(req(preset('systainer-s76-plain'), { marginMm: 200 }))
  assert.equal(plan.fitted, 0)
  assert.deepEqual(plan.cells, [])
})
