// The numbers here are the MFT/3's, not our own output's: a top whose holes are
// a millimetre off the 96 mm grid takes no Festool dogs or clamps.
import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  MFT, MFT_DEFAULT_DEPTH_MM, MFT_DEFAULT_WIDTH_MM, SHAPER_SCREWS,
  mftCounterboreRings, mftDogCentres, mftGridSize, mftHoleCentres, mftRings, mftScrewCentres,
  resolveMftGrid,
} from './mft.ts'
import type { MftParams } from './mft.ts'
import type { MultiPolygon } from './vec.ts'
import { signedArea } from './vec.ts'
import { difference } from './boolean.ts'
import { compileObject } from './sceneShapes.ts'
import { createShape2D } from '../model/scene.ts'
import type { DesignDocument } from '../model/document.ts'
import { sceneCutDrawing } from '../features/shaper-designer/cutDrawing.ts'
import { DOG_GRID } from '../features/shaper-designer/templates/shop.ts'

const DEFAULT_GRID = resolveMftGrid({})

test('defaults are the Festool MFT/3: 20 mm holes, 96 mm grid, 1152 x 772 top', () => {
  assert.deepEqual(DEFAULT_GRID, { holeDiameterMm: 20, pitchMm: 96, edgeMarginMm: 48 })
  assert.equal(MFT_DEFAULT_WIDTH_MM, 1152)
  assert.equal(MFT_DEFAULT_DEPTH_MM, 772)
  // The dog-hole template shares the constants rather than restating them.
  assert.equal(DOG_GRID.holeMm, MFT.holeDiameterMm)
  assert.equal(DOG_GRID.pitchMm, MFT.pitchMm)
})

test('holes sit on the pitch, and the grid is centred on the top', () => {
  const w = 1000, h = 600
  const centres = mftHoleCentres(w, h, DEFAULT_GRID)
  const xs = [...new Set(centres.map(([x]) => x))].sort((a, b) => a - b)
  const ys = [...new Set(centres.map(([, y]) => y))].sort((a, b) => a - b)
  assert.equal(centres.length, xs.length * ys.length)
  for (let i = 1; i < xs.length; i++) assert.ok(Math.abs(xs[i] - xs[i - 1] - 96) < 1e-9)
  for (let i = 1; i < ys.length; i++) assert.ok(Math.abs(ys[i] - ys[i - 1] - 96) < 1e-9)
  // Centred: the same gap at both edges.
  assert.ok(Math.abs(xs[0] - (w - xs.at(-1)!)) < 1e-9)
  assert.ok(Math.abs(ys[0] - (h - ys.at(-1)!)) < 1e-9)
  // And never inside the margin.
  assert.ok(xs[0] >= 48 && ys[0] >= 48)
})

test('a whole number of pitches puts every edge hole half a pitch in', () => {
  const centres = mftHoleCentres(1152, 768, DEFAULT_GRID)
  assert.deepEqual(mftGridSize(1152, 768, DEFAULT_GRID), [12, 8])
  assert.equal(centres.length, 96)
  assert.equal(Math.min(...centres.map(c => c[0])), 48)
  assert.equal(Math.max(...centres.map(c => c[0])), 1152 - 48)
  assert.equal(Math.min(...centres.map(c => c[1])), 48)
  assert.equal(Math.max(...centres.map(c => c[1])), 768 - 48)
})

test('parameters change the grid', () => {
  const grid = resolveMftGrid({ holeDiameterMm: 19, pitchMm: 100, edgeMarginMm: 60 })
  assert.deepEqual(grid, { holeDiameterMm: 19, pitchMm: 100, edgeMarginMm: 60 })
  // 520 wide: (520 - 120) / 100 = 4 whole pitches -> 5 holes, 60 mm in.
  const xs = mftHoleCentres(520, 120, grid).map(c => c[0])
  assert.deepEqual(xs, [60, 160, 260, 360, 460])
})

test('an unbuildable pitch or margin is pulled back rather than drawn', () => {
  // A pitch under the hole would merge holes; a margin under the radius would
  // hang them off the edge.
  const grid = resolveMftGrid({ holeDiameterMm: 20, pitchMm: 5, edgeMarginMm: 0 })
  assert.ok(grid.pitchMm > grid.holeDiameterMm)
  assert.ok(grid.edgeMarginMm > grid.holeDiameterMm / 2)
})

test('a top too small for one hole is a plain panel', () => {
  assert.deepEqual(mftHoleCentres(80, 80, DEFAULT_GRID), [])
  assert.equal(mftRings({ widthMm: 80, heightMm: 80 }).length, 1)
  // Exactly twice the margin holds exactly one hole, in the middle.
  assert.deepEqual(mftHoleCentres(96, 96, DEFAULT_GRID), [[48, 48]])
})

test('the default top compiles as one panel with real dog holes', () => {
  const top = createShape2D('mft')
  const mp = compileObject(top)
  const [cols, rows] = mftGridSize(MFT_DEFAULT_WIDTH_MM, MFT_DEFAULT_DEPTH_MM, DEFAULT_GRID)
  assert.deepEqual([cols, rows], [12, 8])
  assert.equal(mp.length, 1)
  assert.equal(mp[0].length, 1 + cols * rows)
  const [outer, ...holes] = mp[0]
  assert.ok(signedArea(outer) > 0)
  for (const hole of holes) assert.ok(signedArea(hole) < 0)
  // A 64-gon of r 10 is within half a percent of the true circle.
  const area = Math.abs(signedArea(holes[0]))
  assert.ok(Math.abs(area - Math.PI * 100) / (Math.PI * 100) < 0.005)
})

test('every hole lies inside the panel', () => {
  const [outline, ...holes] = mftRings({ widthMm: 700, heightMm: 450, cornerRadiusMm: 20 })
  const panel = [[outline]] as MultiPolygon
  for (const hole of holes) {
    assert.equal(difference([[hole]] as MultiPolygon, panel).length, 0, 'a hole hangs off the panel')
  }
})

test('an MFT top cuts as an outline plus through-holes, on separate layers', () => {
  const top = { ...createShape2D('mft'), cut: { type: 'exterior' as const } }
  const doc = {
    id: 'd', name: 'MFT', kind: 'shaper', objects: [top], revision: 0,
  } as unknown as DesignDocument
  const byId = new Map(sceneCutDrawing(doc).layers.map(l => [l.id, l]))

  const exterior = byId.get('exterior-profile')
  assert.ok(exterior)
  assert.equal(exterior.polygons.length, 1)
  assert.equal(exterior.polygons[0].length, 1, 'the outline should carry no holes')

  const interior = byId.get('interior-cuts')
  assert.ok(interior)
  assert.equal(interior.polygons.length, 96)
})

// Shaper's "Shelf Upgrade Kit - Large Shelf Top" cut file: a 410 x 280 mm top
// with both screw patterns. Centres below are that file's, moved to a
// lower-left origin (its SVG y runs down; ours runs up).
const SHELF_TOP: MftParams = { widthMm: 410, heightMm: 280, workstationScrews: 1, legScrews: 1 }
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

test('both screw patterns land where Shaper\'s shelf-top file puts them', () => {
  const got = mftScrewCentres(410, 280, SHELF_TOP).map(([x, y]) => [+(x - 205).toFixed(3), +y.toFixed(3)])
  const want = [
    // Workstation: 240 x 89, 11.5 mm in from the top edge.
    [-120, 268.5], [120, 268.5], [-120, 179.5], [120, 179.5],
    // Support leg: 87.9 x 29.2, 20 mm in from the bottom edge.
    [-43.95, 20], [43.95, 20], [-43.95, 49.2], [43.95, 49.2],
  ]
  assert.deepEqual(got, want)
})

test('each pattern switches on alone, and nothing is cut with both off', () => {
  assert.equal(mftScrewCentres(410, 280, { workstationScrews: 1 }).length, 4)
  assert.equal(mftScrewCentres(410, 280, { legScrews: 1 }).length, 4)
  assert.deepEqual(mftScrewCentres(410, 280, {}), [])
  assert.equal(mftRings({ widthMm: 410, heightMm: 280 }).length,
    1 + mftHoleCentres(410, 280, DEFAULT_GRID).length)
})

test('dog holes that would reach a counterbore are left out', () => {
  const p = { ...SHELF_TOP, widthMm: 1152, heightMm: 772 }
  const dogs = mftDogCentres(1152, 772, p)
  const screws = mftScrewCentres(1152, 772, p)
  assert.ok(dogs.length < 96, 'some dog holes should give way to the screws')
  const seat = SHAPER_SCREWS.counterboreDiameterMm / 2
  for (const [x, y] of dogs) {
    for (const [sx, sy] of screws) assert.ok(Math.hypot(x - sx, y - sy) > 10 + seat)
  }
})

test('a screw that would fall off a small panel is dropped, not cut through the edge', () => {
  // 200 wide cannot hold the Workstation's 240 mm pattern.
  assert.deepEqual(mftScrewCentres(200, 280, { workstationScrews: 1 }), [])
})

test('screws cut through and their counterbores pocket, on their own layers', () => {
  const top = { ...createShape2D('mft', [0, 0, 0], SHELF_TOP), cut: { type: 'exterior' as const } }
  const doc = { id: 'd', name: 'Shelf', kind: 'shaper', objects: [top], revision: 0 } as unknown as DesignDocument
  const byId = new Map(sceneCutDrawing(doc).layers.map(l => [l.id, l]))

  const dogs = mftDogCentres(410, 280, SHELF_TOP).length
  assert.equal(byId.get('interior-cuts')?.polygons.length, dogs + 8)

  const pockets = byId.get('pockets')
  assert.ok(pockets)
  assert.equal(pockets.polygons.length, 8)
  assert.equal(pockets.depthMm, 12)
  // Each counterbore is the drawing's 12.7 mm.
  const area = Math.abs(signedArea(pockets.polygons[0][0]))
  assert.ok(near(+(2 * Math.sqrt(area / Math.PI)).toFixed(1), 12.7))
})

test('a counterbore depth of 0 cuts the holes with no pockets', () => {
  const p = { ...SHELF_TOP, counterboreDepthMm: 0 }
  assert.deepEqual(mftCounterboreRings(p), [])
  const top = createShape2D('mft', [0, 0, 0], p)
  const doc = { id: 'd', name: 'Shelf', kind: 'shaper', objects: [top], revision: 0 } as unknown as DesignDocument
  assert.ok(!sceneCutDrawing(doc).layers.some(l => l.id === 'pockets'))
})

test('support leg alone: centred at the front, and the dog holes it hits are removed', () => {
  // The leg's upper row (49.2 mm in) lands on the MFT/3's front dog row (50 mm
  // in), 4 mm off the two middle columns -- those two dogs go, the rest stay.
  const p = { widthMm: 1152, heightMm: 772, legScrews: 1 }
  const legs = mftScrewCentres(1152, 772, p)
  assert.deepEqual(legs.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]),
    [[532.05, 20], [619.95, 20], [532.05, 49.2], [619.95, 49.2]])
  const frontRow = mftDogCentres(1152, 772, p).filter(([, y]) => y === 50).map(([x]) => x)
  assert.deepEqual(frontRow, [48, 144, 240, 336, 432, 720, 816, 912, 1008, 1104])
  assert.equal(mftDogCentres(1152, 772, p).length, 94)
})
