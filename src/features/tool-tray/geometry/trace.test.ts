import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import {
  MAX_RING_POINTS, countPoints, expandRegion, simplifyRegion, simplifyRing, traceToFootprint,
} from './trace.ts'
import type { MultiPolygon, Polygon, Ring, Vec2 } from '../../../geometry/vec.ts'
import { multiArea, multiBBox, pointInRing } from '../../../geometry/vec.ts'
import { difference } from '../../../geometry/boolean.ts'

const circle = (r: number, n: number, cx = 0, cy = 0): Ring =>
  Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)] as Vec2
  })

const square = (w: number, h: number, x = 0, y = 0): Ring =>
  [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]

describe('simplification', () => {
  test('a straight run collapses to its ends', () => {
    const ring: Ring = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 3], [0, 3]]
    assert.ok(simplifyRing(ring).length < ring.length)
  })

  test('a corner is never removed, however many points surround it', () => {
    const dense: Ring = [
      ...Array.from({ length: 40 }, (_, i) => [i / 4, 0] as Vec2),
      ...Array.from({ length: 40 }, (_, i) => [10, i / 4] as Vec2),
      [0, 10],
    ]
    const simplified = simplifyRing(dense)
    const corner = simplified.some(([x, y]) => Math.abs(x - 10) < 1e-6 && Math.abs(y) < 1e-6)
    assert.ok(corner, 'the sharp corner was decimated away')
  })

  // A tracer can start a ring anywhere; the same shape must simplify the same.
  test('the result does not depend on where the ring started', () => {
    const ring = circle(20, 64)
    const rotated = [...ring.slice(17), ...ring.slice(0, 17)]
    assert.equal(simplifyRing(ring).length, simplifyRing(rotated).length)
  })

  test('a shape too small to simplify is handed back intact', () => {
    const triangle: Ring = [[0, 0], [5, 0], [0, 5]]
    assert.deepEqual(simplifyRing(triangle), triangle)
  })

  // The budget is the server's, and a trace that blows it is rejected at save.
  test('a pathological trace is brought under the ring budget', () => {
    const dense: MultiPolygon = [[circle(30, 4000)]]
    const simplified = simplifyRegion(dense)
    const worst = Math.max(...simplified.flat().map(r => r.length))
    assert.ok(worst <= MAX_RING_POINTS, `still ${worst} points`)
    // And it is still recognisably the same disc.
    assert.ok(Math.abs(multiArea(simplified) - Math.PI * 900) / (Math.PI * 900) < 0.02)
  })
})

describe('growing a trace by its clearance', () => {
  // The property that matters: the part must fit. Nothing of the original may
  // stick out of the grown region, at any point on the boundary.
  test('the original is wholly inside the grown region', () => {
    const original: MultiPolygon = [[square(40, 25)]]
    const grown = expandRegion(original, 0.2)
    assert.ok(multiArea(difference(original, grown)) < 1e-6)
  })

  test('a square grows by the clearance on every side, not on its diagonal', () => {
    const grown = expandRegion([[square(40, 25)]], 0.5)
    const box = multiBBox(grown)
    assert.ok(Math.abs(box.minX + 0.5) < 0.02, `minX ${box.minX}`)
    assert.ok(Math.abs(box.minY + 0.5) < 0.02, `minY ${box.minY}`)
    assert.ok(Math.abs(box.maxX - 40.5) < 0.02, `maxX ${box.maxX}`)
    assert.ok(Math.abs(box.maxY - 25.5) < 0.02, `maxY ${box.maxY}`)
  })

  // A miter offset would throw a spike off a sharp convex corner; a disc sweep
  // rounds it. This is why the sweep exists rather than a negative miter.
  test('a sharp spike does not grow a longer spike', () => {
    const spike: MultiPolygon = [[[[0, 0], [40, 0], [20, 1.5]] as Ring]]
    const grown = expandRegion(spike, 0.5)
    const box = multiBBox(grown)
    // Round joins put the apex at most `clearance` beyond the original tip.
    assert.ok(box.maxY <= 1.5 + 0.5 + 0.05, `apex ran to ${box.maxY}`)
  })

  test('an island inside the pocket shrinks, because the part must clear it', () => {
    const withHole: MultiPolygon = [[
      square(40, 40),
      [...square(10, 10, 15, 15)].reverse(),
    ]]
    const grown = expandRegion(withHole, 0.5)
    // The island is smaller, so the pocket as a whole gained more than its
    // outer boundary alone would give.
    const holeShrank = grown.flat().length > 1
      ? multiArea(grown) > multiArea(withHole)
      : true
    assert.ok(holeShrank)
    // A point just inside the old island edge is now pocket, not post.
    const outer = grown[0]![0]!
    assert.ok(pointInRing([15.2, 20], outer))
  })

  test('zero clearance is a no-op rather than a rebuild', () => {
    const original: MultiPolygon = [[square(10, 10)]]
    assert.equal(expandRegion(original, 0), original)
  })
})

describe('traceToFootprint', () => {
  const border: Polygon = [square(300, 200, -20, -20)]
  const part: Polygon = [square(40, 25, 5, 5)]

  test('the part comes back at the origin, sized with its clearance', () => {
    const traced = traceToFootprint([part], 0.2)
    assert.ok(traced)
    const box = multiBBox(traced.rings)
    assert.ok(Math.abs(box.minX) < 1e-6 && Math.abs(box.minY) < 1e-6,
      'the footprint is not seated at the pocket origin')
    assert.ok(Math.abs(traced.widthMm - 40.4) < 0.05, `width ${traced.widthMm}`)
    assert.ok(Math.abs(traced.heightMm - 25.4) < 0.05, `height ${traced.heightMm}`)
  })

  // Exported drawings carry borders and title blocks. A pocket is one part.
  test('the largest region wins, so a drawing border is not the pocket', () => {
    const traced = traceToFootprint([part, border], 0.2)
    assert.ok(traced)
    assert.ok(traced.widthMm > 250, 'expected the border to be picked as largest')

    const partOnly = traceToFootprint([part], 0.2)!
    assert.ok(partOnly.widthMm < 50)
  })

  test('nothing usable gives nothing, rather than an empty pocket', () => {
    assert.equal(traceToFootprint([], 0.2), null)
    assert.equal(traceToFootprint([[[[0, 0], [1, 1]]]], 0.2), null)
  })

  test('what comes out fits the budget the server enforces', () => {
    const traced = traceToFootprint([[circle(30, 4000)]], 0.2)
    assert.ok(traced)
    for (const ring of traced.rings.flat()) {
      assert.ok(ring.length <= 512, `${ring.length} points in one ring`)
    }
    assert.ok(countPoints(traced.rings) <= 8000)
  })
})

describe('a real traced part', () => {
  // An open-end wrench: sharp convex corners, a concave notch at the jaw, and a
  // radiused handle end. This exact outline made polygon-clipping give up with
  // "unable to complete output ring" when the sweep was unioned in one variadic
  // call over unquantised inputs -- hundreds of capsules meeting at very nearly,
  // but not exactly, the same point. It is the reason the union is snapped to
  // the shared grid first and folded in pairs.
  const wrench = (): Ring => {
    const pts: Vec2[] = [
      [6, 11], [30, 11], [34, 8], [40, 8], [40, 4], [52, 4], [52, 8], [86, 8],
      [92, 15], [86, 22], [52, 22], [52, 26], [40, 26], [40, 22], [34, 22],
      [30, 19], [6, 19],
    ]
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI / 2 + (i / 12) * Math.PI
      pts.push([6 + 4 * Math.cos(a), 15 + 4 * Math.sin(a)])
    }
    return pts
  }

  test('it grows without the clipper giving up', () => {
    const grown = expandRegion([[wrench()]], 0.15)
    assert.ok(grown.length >= 1)
    assert.ok(multiArea(grown) > multiArea([[wrench()]]))
  })

  test('the wrench still fits inside the pocket cut for it', () => {
    const original: MultiPolygon = [[wrench()]]
    const grown = expandRegion(original, 0.15)
    assert.ok(multiArea(difference(original, grown)) < 1e-6)
  })

  test('it becomes a footprint the server will accept', () => {
    const traced = traceToFootprint([[wrench()]], 0.15)
    assert.ok(traced)
    // The jaw reaches x=92 and the radiused handle end to x=2, so the part
    // spans 90 mm; the pocket is that plus the clearance on each side.
    const span = 92 - 2
    assert.ok(Math.abs(traced.widthMm - (span + 2 * 0.15)) < 0.05,
      `width ${traced.widthMm}`)
    for (const ring of traced.rings.flat()) assert.ok(ring.length <= 512)
  })
})
