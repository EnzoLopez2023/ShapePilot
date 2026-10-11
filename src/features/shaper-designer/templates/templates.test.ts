// The cutting board templates have to arrive at Origin as three cuts -- a
// profile, a groove and the handles -- with the groove inside the board and
// clear of every handle by the wood the README promises.
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { pointInRing, signedArea } from '../../../geometry/vec.ts'
import type { Ring, Vec2 } from '../../../geometry/vec.ts'
import { sceneCutDrawing } from '../cutDrawing.ts'
import { cuttingBoards, groove, wall } from './cuttingBoards.ts'
import { SHAPER_TEMPLATES } from './index.ts'

/** Shortest distance between two polylines, by their vertices: the rings are
 *  sampled at 0.2 mm, so this is within a hair of the true distance. */
function gap(a: Ring, b: Ring): number {
  let best = Infinity
  for (const p of a) for (const q of b) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]))
  return best
}

test('every board is anticlockwise, with the groove inside the profile', () => {
  for (const board of cuttingBoards()) {
    for (const ring of [board.profile, board.groove, ...board.handles]) {
      assert.ok(signedArea(ring) > 0, `${board.id}: a ring is clockwise`)
    }
    assert.ok(board.groove.every((p: Vec2) => pointInRing(p, board.profile)), board.id)
    // Groove edge to board edge: the inset less half the bit.
    assert.ok(gap(board.groove, board.profile) > groove.inset - groove.half - 0.05, board.id)
  }
})

test('the groove keeps the promised wall to every handle', () => {
  for (const board of cuttingBoards()) {
    for (const handle of board.handles) {
      const wood = gap(board.groove, handle) - groove.half
      assert.ok(wood > wall - 0.05, `${board.id}: ${wood.toFixed(2)} mm of wood to a handle`)
    }
  }
})

test('a template opens as profile, groove and handles, each its own cut', () => {
  for (const template of SHAPER_TEMPLATES) {
    const doc = template.build()
    assert.equal(doc.kind, 'shaper')
    const drawing = sceneCutDrawing(doc)
    const byType = new Map(drawing.layers.map(l => [l.cutType, l]))
    assert.deepEqual([...byType.keys()].sort(), ['exterior', 'interior', 'online'], template.id)
    assert.equal(byType.get('exterior')!.polygons.length, 1)
    assert.equal(byType.get('online')!.polygons.length, 1)
    const board = cuttingBoards().find(b => b.id === template.id)!
    assert.equal(byType.get('interior')!.polygons.length, board.handles.length)
  }
})
