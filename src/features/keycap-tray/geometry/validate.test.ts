import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  checkWallThickness, checkPrintability, checkPlate, checkLocatingPosts, validateDesign, issuesFor,
} from './validate.ts'
import { buildTrayMesh } from './layers.ts'
import { DEFAULT_FABRICATION } from '../model/defaults.ts'
import { emptyDesign } from '../model/presets.ts'
import type { Pocket, TrayDesign } from '../model/types.ts'

const fab = DEFAULT_FABRICATION // minWallMm = 1.8

const design = (pockets: Pocket[]): TrayDesign => ({
  ...emptyDesign(),
  profile: { kind: 'rect', widthMm: 220, heightMm: 220 },
  pockets,
})

const thinIssue = (d: TrayDesign) =>
  checkWallThickness(d, fab).find(i => i.code === 'wall-too-thin')

test('a rotated neighbour whose AABB overlaps is not a false wall-too-thin', () => {
  // `a` at the origin corner; `b` a 1u pocket diagonally up-right, rotated 45deg
  // so a flat face (set ~9 mm back from its bbox corner) points at `a`. The
  // AABBs overlap, but the true edge gap is ~9 mm -- no warning.
  const d = design([
    { id: 'a', units: 1, x: 60, y: 60 },
    { id: 'b', units: 1, x: 82.6, y: 82.6, rotationDeg: 45 },
  ])
  assert.equal(thinIssue(d), undefined)
})

test('a genuinely thin gap between two rotated pockets is still flagged', () => {
  // Two 1u pockets stacked vertically, both rotated 45deg; the facing vertices
  // land ~0.5 mm apart -- under the 1.8 mm wall.
  const d = design([
    { id: 'a', units: 1, x: 60, y: 60, rotationDeg: 45 },
    { id: 'b', units: 1, x: 60, y: 87.08, rotationDeg: 45 },
  ])
  const issue = thinIssue(d)
  assert.ok(issue, 'expected a wall-too-thin warning')
  assert.deepEqual(new Set(issue?.pocketIds), new Set(['a', 'b']))
})

test('an unrotated thin wall is still caught by the exact distance path', () => {
  const d = design([
    { id: 'a', units: 2, x: 60, y: 60 },
    { id: 'b', units: 2, x: 60 + 37.85 + 0.5, y: 60 },
  ])
  assert.ok(thinIssue(d), 'expected a wall-too-thin warning')
})

test('a freely rotated single pocket produces no manifold error', () => {
  const d = design([{ id: 'a', units: 2, x: 100, y: 100, rotationDeg: 33 }])
  const issues = validateDesign(d, fab, buildTrayMesh(d))
  assert.equal(issues.some(i => i.code === 'non-manifold'), false)
})

const codes = (d: TrayDesign) => new Set(checkPrintability(d).map(i => i.code))

test('the default tray (2.4 mm floor, 10 mm pocket) raises no print warning', () => {
  assert.equal(checkPrintability(emptyDesign()).length, 0)
})

test('a floor that is not a whole number of layers is flagged for print only', () => {
  const d = { ...emptyDesign(), floorThicknessMm: 1.5 } // 7.5 layers at 0.2
  const issue = checkPrintability(d).find(i => i.code === 'floor-not-whole-layers')
  assert.ok(issue)
  assert.deepEqual(issue?.targets, ['print'])
  assert.equal(issuesFor(checkPrintability(d), 'cnc').length, 0)
})

test('common non-0.2 layer heights (0.12, 0.16) do not trip the whole-layer check', () => {
  assert.ok(!codes({ ...emptyDesign(), floorThicknessMm: 1.44 }).has('floor-not-whole-layers')) // 12 x 0.12
  assert.ok(!codes({ ...emptyDesign(), floorThicknessMm: 1.6 }).has('floor-not-whole-layers'))  // 8 x 0.2 / 10 x 0.16
})

test('a sub-0.8 mm floor is a stiffness warning, not a whole-layer one', () => {
  const c = codes({ ...emptyDesign(), floorThicknessMm: 0.6 })
  assert.ok(c.has('floor-too-thin-fdm'))
  assert.ok(!c.has('floor-not-whole-layers'))
})

test('a barely-there pocket depth is flagged', () => {
  assert.ok(codes({ ...emptyDesign(), pocketDepthMm: 0.8 }).has('pocket-too-shallow-fdm'))
})

const plateIssue = (w: number, h: number) =>
  checkPlate(emptyDesign(), fab, {
    positions: new Float32Array(), indices: new Uint32Array(), triangleCount: 0,
    bbox: [0, 0, 0, w, h, 12.4],
  })

test('checkPlate: comfortably-sized, snug, and oversized trays', () => {
  assert.equal(plateIssue(200, 150).length, 0)                        // 256 plate, room to spare
  assert.equal(plateIssue(254, 150)[0]?.code, 'plate-margin-tight')   // within 5 mm on one axis
  assert.equal(plateIssue(300, 150)[0]?.code, 'exceeds-plate')        // over the edge
})

test('the material floor threshold raises the bar: 1.2 mm is fine for PLA, thin for PETG', () => {
  const d = { ...emptyDesign(), floorThicknessMm: 1.2 } // 6 whole layers at 0.2
  assert.equal(checkPrintability(d).length, 0)                          // generic 0.8
  assert.equal(checkPrintability(d, { minFloorMm: 1.0 }).length, 0)     // PLA Matte
  const petg = checkPrintability(d, { minFloorMm: 1.4 })                // PETG
  assert.equal(petg[0]?.code, 'floor-too-thin-fdm')
  assert.deepEqual(petg[0]?.targets, ['print'])
})

const withPosts = (over: Partial<NonNullable<Pocket['locatingPosts']>> = {}, pocketOver: Partial<Pocket> = {}) =>
  design([{
    id: 'a', units: 5, x: 10, y: 10,
    locatingPosts: { heightMm: 3, outerDiameterMm: 6, boreDiameterMm: 4, ...over },
    ...pocketOver,
  }])

test('a well-formed locating post on a normal pocket raises nothing', () => {
  assert.equal(checkLocatingPosts(withPosts()).length, 0)
})

test('a post at or above the pocket depth is an error', () => {
  const issue = checkLocatingPosts(withPosts({ heightMm: 10 }))[0] // default pocketDepthMm is 10
  assert.equal(issue?.code, 'locating-post-too-tall')
  assert.equal(issue?.severity, 'error')
  assert.deepEqual(issue?.targets, ['print'])
})

test('a bore that is not smaller than the post is an error', () => {
  assert.equal(
    checkLocatingPosts(withPosts({ outerDiameterMm: 5, boreDiameterMm: 5 }))[0]?.code,
    'locating-post-bore-too-wide')
})

test('a thin post wall is a warning, not an error', () => {
  const issue = checkLocatingPosts(withPosts({ outerDiameterMm: 5, boreDiameterMm: 4.5 }))[0]
  assert.equal(issue?.code, 'locating-post-wall-too-thin')
  assert.equal(issue?.severity, 'warning')
})

test('posts wider than the slot pitch are flagged as touching', () => {
  // 5 slots across a 5u pocket (~95 mm wide, Python sizing) -> ~19 mm pitch.
  const issue = checkLocatingPosts(withPosts({ outerDiameterMm: 19 }))[0]
  assert.equal(issue?.code, 'locating-posts-too-close')
})

test('a single-slot (1u) pocket is never flagged for posts touching', () => {
  const d = design([{
    id: 'a', units: 1, x: 10, y: 10,
    locatingPosts: { heightMm: 3, outerDiameterMm: 15, boreDiameterMm: 4 },
  }])
  assert.equal(checkLocatingPosts(d).some(i => i.code === 'locating-posts-too-close'), false)
})

test('locating posts on a through-cut pocket are a warning, not silently ignored', () => {
  const issue = checkLocatingPosts(withPosts({}, { isThrough: true }))[0]
  assert.equal(issue?.code, 'locating-posts-on-through-pocket')
  assert.equal(issue?.severity, 'warning')
})

test('a pocket with no locatingPosts raises nothing', () => {
  assert.equal(checkLocatingPosts(design([{ id: 'a', units: 5, x: 10, y: 10 }])).length, 0)
})
