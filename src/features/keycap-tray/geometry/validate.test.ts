import assert from 'node:assert/strict'
import { test } from 'vitest'
import { checkWallThickness, validateDesign } from './validate.ts'
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
