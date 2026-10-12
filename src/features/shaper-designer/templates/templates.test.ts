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

test('a cutting board opens as profile, groove and handles, each its own cut', () => {
  for (const template of SHAPER_TEMPLATES.filter(t => t.id.startsWith('cutting-board'))) {
    const doc = template.build()
    assert.equal(doc.kind, 'shaper')
    const drawing = sceneCutDrawing(doc)
    // Profile underneath: drawn last, its white fill would hide the rest.
    assert.equal(drawing.layers[0]!.cutType, 'exterior', template.id)
    const byType = new Map(drawing.layers.map(l => [l.cutType, l]))
    assert.deepEqual([...byType.keys()].sort(), ['exterior', 'interior', 'online'], template.id)
    assert.equal(byType.get('exterior')!.polygons.length, 1)
    assert.equal(byType.get('online')!.polygons.length, 1)
    const board = cuttingBoards().find(b => b.id === template.id)!
    assert.equal(byType.get('interior')!.polygons.length, board.handles.length)
  }
})

/** What each template must arrive at Origin as: cut type -> separate outlines. */
const EXPECTED: Record<string, Partial<Record<string, number>>> = {
  'cutting-board-small': { exterior: 1, online: 1, interior: 1 },
  'cutting-board-large': { exterior: 1, online: 1, interior: 2 },
  'serving-board': { exterior: 1, interior: 1 },
  'cheese-board': { exterior: 1, online: 1 },
  'trivet': { exterior: 1, interior: 5 },
  'coasters': { exterior: 4, pocket: 4 },
  'dog-hole-grid': { exterior: 1, interior: 40 },
  'cup-hinge': { pocket: 1, guide: 3 },
  'systainer-insert': { exterior: 1, interior: 2, guide: 1 },
  'monitor-riser': { exterior: 3, pocket: 2 },
}

test('every template exports the cuts it promises, profile underneath', () => {
  assert.deepEqual(SHAPER_TEMPLATES.map(t => t.id).sort(), Object.keys(EXPECTED).sort())
  for (const template of SHAPER_TEMPLATES) {
    const drawing = sceneCutDrawing(template.build())
    const counts = Object.fromEntries(drawing.layers.map(l => [l.cutType, l.polygons.length]))
    assert.deepEqual(counts, EXPECTED[template.id], template.id)
    if (counts.exterior) assert.equal(drawing.layers[0]!.cutType, 'exterior', template.id)
  }
})

test('everything cut inside a part stays inside it, with wood to spare', () => {
  for (const template of SHAPER_TEMPLATES) {
    const drawing = sceneCutDrawing(template.build())
    const profiles = drawing.layers.find(l => l.cutType === 'exterior')?.polygons ?? []
    if (!profiles.length) continue
    for (const layer of drawing.layers) {
      if (layer.cutType === 'exterior' || layer.cutType === 'guide') continue
      for (const poly of layer.polygons) {
        const home = profiles.find(p => poly[0]!.every(v => pointInRing(v, p[0]!)))
        assert.ok(home, `${template.id}: a ${layer.cutType} cut leaves its part`)
        // The thinnest web in any template is the coaster's 1/4 in rim.
        assert.ok(gap(poly[0]!, home[0]!) > 6, `${template.id}: ${layer.cutType} too near the edge`)
      }
    }
  }
})

test('pocket depths ride on the layer', () => {
  const depth = (id: string) => sceneCutDrawing(SHAPER_TEMPLATES.find(t => t.id === id)!.build())
    .layers.find(l => l.cutType === 'pocket')?.depthMm
  assert.equal(depth('cup-hinge'), 13)
  assert.ok(Math.abs(depth('coasters')! - 3.175) < 1e-9)
})

test('the S76 keep-out is a clean 6 mm in from the outline everywhere', () => {
  const doc = SHAPER_TEMPLATES.find(t => t.id === 'systainer-insert')!.build()
  const [profile, , keepOut] = doc.objects
  assert.ok(profile?.type === 'path' && keepOut?.type === 'path')
  const outer = profile.rings[0] as Ring, inner = keepOut.rings[0] as Ring
  assert.ok(inner.every(v => pointInRing(v, outer)))
  // To the nearest edge, not vertex: the outline's straight runs are long.
  const nearest = (v: Vec2) => Math.min(...outer.map((a, i) => {
    const b = outer[(i + 1) % outer.length]!
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const t = Math.max(0, Math.min(1, ((v[0] - a[0]) * dx + (v[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    return Math.hypot(a[0] + t * dx - v[0], a[1] + t * dy - v[1])
  }))
  for (const v of inner) {
    const d = nearest(v)
    // A mitre spike would sit well under 6 mm from the outline.
    assert.ok(d > 5.9 && d < 6.6, `keep-out vertex ${d.toFixed(2)} mm from the outline`)
  }
})

test('the riser legs fit their dadoes', () => {
  const doc = SHAPER_TEMPLATES.find(t => t.id === 'monitor-riser')!.build()
  const box = (name: string) => {
    const g = doc.objects.find(o => o.name === name)
    assert.ok(g?.type === 'group')
    return g.children.map(c => {
      assert.ok(c.type === 'path')
      const xs = c.rings[0]!.map(v => v[0]), ys = c.rings[0]!.map(v => v[1])
      return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
    })
  }
  const [dado] = box('Leg dadoes'), [leg] = box('Legs')
  // The leg's top edge runs the dado's length; its thickness is the stock's.
  assert.ok(Math.abs(leg!.w - dado!.h) < 0.01)
  assert.ok(Math.abs(dado!.w - 18.5) < 0.01)
})
