import assert from 'node:assert/strict'
import { test } from 'vitest'
import { difference, intersection, punchDisjointFast, union, unionDisjointFast } from './boolean.ts'
import { LIBRARY_SIZING, PYTHON_SIZING, isoEnterRing, pocketRing, pocketWidth, pocketHeight, roundedRectRing } from './shapes.ts'
import type { Ring } from './vec.ts'
import { multiArea, normalizePolygon, pointInRing, signedArea } from './vec.ts'

const rect = (x: number, y: number, w: number, h: number): Ring =>
  [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]

test('signedArea is positive for CCW and negative for CW', () => {
  assert.equal(signedArea(rect(0, 0, 2, 3)), 6)
  assert.equal(signedArea([...rect(0, 0, 2, 3)].reverse()), -6)
})

test('normalizePolygon forces outer CCW and holes CW', () => {
  const poly = normalizePolygon([[...rect(0, 0, 10, 10)].reverse(), rect(2, 2, 2, 2)])
  assert.ok(signedArea(poly[0]) > 0, 'outer must be CCW')
  assert.ok(signedArea(poly[1]) < 0, 'hole must be CW')
})

test('pocket width formulas match both reference libraries', () => {
  // keycap_pocket_library README: 1u = 18.60, 4u = 75.75, 13u = 247.20
  assert.equal(+pocketWidth(1, LIBRARY_SIZING).toFixed(3), 18.6)
  assert.equal(+pocketWidth(4, LIBRARY_SIZING).toFixed(3), 75.75)
  assert.equal(+pocketWidth(13, LIBRARY_SIZING).toFixed(3), 247.2)
  // stackable_trays_SOURCE.py: pw(1) = 19.05 - 1.05 + 0.80 = 18.80
  assert.equal(+pocketWidth(1, PYTHON_SIZING).toFixed(3), 18.8)
  // systainer_tray_1_SHAPER.svg measures 18.80 x 18.80 for all 75 pockets
  assert.equal(+PYTHON_SIZING.height.toFixed(3), 18.8)
})

test('roundedRectRing is CCW, closes on itself, and respects the radius', () => {
  const r = roundedRectRing(0, 0, 20, 10, 2, 8)
  assert.ok(signedArea(r) > 0, 'must be CCW')
  const xs = r.map(p => p[0]), ys = r.map(p => p[1])
  assert.equal(+Math.min(...xs).toFixed(6), 0)
  assert.equal(+Math.max(...xs).toFixed(6), 20)
  assert.equal(+Math.min(...ys).toFixed(6), 0)
  assert.equal(+Math.max(...ys).toFixed(6), 10)
  // corner is cut: no vertex sits in the square corner inside the fillet
  assert.ok(!r.some(([x, y]) => x < 2 && y < 2 && Math.hypot(x - 2, y - 2) > 2.0001))
  // Faceting always undershoots the true area, and must converge as segments rise.
  const exact = 20 * 10 - (4 - Math.PI) * 4
  const coarse = signedArea(roundedRectRing(0, 0, 20, 10, 2, 4))
  const fine = signedArea(roundedRectRing(0, 0, 20, 10, 2, 64))
  assert.ok(coarse < fine && fine < exact, 'area must increase toward the exact value')
  assert.ok(exact - fine < 5e-3, `64-segment area ${fine} should approach ${exact}`)
})

test('radius clamps to half the shorter side', () => {
  const r = roundedRectRing(0, 0, 10, 10, 999, 12)
  // degenerates to a circle of radius 5
  assert.ok(Math.abs(signedArea(r) - Math.PI * 25) < 0.5)
})

test('difference punches a hole and preserves area', () => {
  const out = difference([[rect(0, 0, 10, 10)]], [[rect(2, 2, 2, 2)]])
  assert.equal(out.length, 1)
  assert.equal(out[0].length, 2, 'outer + one hole')
  assert.ok(Math.abs(multiArea(out) - 96) < 1e-6)
})

test('union merges touching squares into one polygon', () => {
  const out = union([[rect(0, 0, 10, 10)]], [[rect(10, 0, 10, 10)]])
  assert.equal(out.length, 1)
  assert.ok(Math.abs(multiArea(out) - 200) < 1e-6)
})

test('intersection clips a pocket that hangs off the tray edge', () => {
  const out = intersection([[rect(0, 0, 10, 10)]], [[rect(5, 5, 10, 10)]])
  assert.ok(Math.abs(multiArea(out) - 25) < 1e-6)
})

test('unionDisjointFast accepts a separated grid and rejects overlaps', () => {
  const grid = [[rect(0, 0, 5, 5)], [rect(10, 0, 5, 5)], [rect(0, 10, 5, 5)]]
  const fast = unionDisjointFast(grid)
  assert.ok(fast, 'separated pockets must take the fast path')
  assert.equal(fast!.length, 3)
  assert.equal(unionDisjointFast([[rect(0, 0, 5, 5)], [rect(2, 2, 5, 5)]]), null)
})

test('punchDisjointFast matches the general difference', () => {
  const outer = [[rect(0, 0, 100, 100)]]
  const holes = [[rect(10, 10, 5, 5)], [rect(30, 30, 5, 5)]]
  const fast = punchDisjointFast(outer, holes)
  assert.ok(fast, 'disjoint interior holes must take the fast path')
  const slow = difference(outer, ...holes.map(h => [h]))
  assert.ok(Math.abs(multiArea(fast!) - multiArea(slow)) < 1e-6)
  assert.equal(fast![0].length, 3, 'outer + two holes')
  // a hole crossing the boundary must fall back
  assert.equal(punchDisjointFast(outer, [[rect(-5, -5, 20, 20)]]), null)
})

test('pocketRing places a 6.25u spacebar at the requested origin', () => {
  const poly = pocketRing({ units: 6.25, x: 12, y: 30 }, PYTHON_SIZING)
  const xs = poly[0].map(p => p[0]), ys = poly[0].map(p => p[1])
  assert.equal(+Math.min(...xs).toFixed(4), 12)
  assert.equal(+Math.min(...ys).toFixed(4), 30)
  assert.equal(+(Math.max(...xs) - Math.min(...xs)).toFixed(3), +pocketWidth(6.25, PYTHON_SIZING).toFixed(3))
  assert.ok(pointInRing([12 + 5, 30 + 5], poly[0]))
})

test('rotating a pocket 90 degrees swaps its extents', () => {
  const flat = pocketRing({ units: 2, x: 0, y: 0 }, PYTHON_SIZING)[0]
  const tall = pocketRing({ units: 2, x: 0, y: 0, rotationDeg: 90 }, PYTHON_SIZING)[0]
  const w = (r: Ring) => Math.max(...r.map(p => p[0])) - Math.min(...r.map(p => p[0]))
  const h = (r: Ring) => Math.max(...r.map(p => p[1])) - Math.min(...r.map(p => p[1]))
  assert.ok(Math.abs(w(flat) - h(tall)) < 1e-9)
  assert.ok(Math.abs(h(flat) - w(tall)) < 1e-9)
})

test('isoEnterRing is CCW, closes on itself, and its bbox matches the two-row footprint', () => {
  const p = { units: 1.5, x: 10, y: 5 }
  const ring = isoEnterRing(p, LIBRARY_SIZING)
  assert.ok(signedArea(ring) > 0, 'must be CCW')

  const bottomW = pocketWidth(1.5, LIBRARY_SIZING)
  const rowH = pocketHeight(1, LIBRARY_SIZING)
  const xs = ring.map(v => v[0]), ys = ring.map(v => v[1])
  assert.equal(+Math.min(...xs).toFixed(6), p.x)
  assert.equal(+Math.max(...xs).toFixed(6), +(p.x + bottomW).toFixed(6))
  assert.equal(+Math.min(...ys).toFixed(6), p.y)
  assert.equal(+Math.max(...ys).toFixed(6), +(p.y + 2 * rowH).toFixed(6))
})

test('isoEnterRing keeps its reflex notch corner sharp regardless of radius', () => {
  const p = { units: 1.5, x: 0, y: 0 }
  const ring = isoEnterRing(p, LIBRARY_SIZING)
  const bottomW = pocketWidth(1.5, LIBRARY_SIZING)
  const topW = pocketWidth(1.25, LIBRARY_SIZING)
  const rowH = pocketHeight(1, LIBRARY_SIZING)
  const notchX = bottomW - topW
  const hasExactNotch = ring.some(([x, y]) => Math.abs(x - notchX) < 1e-9 && Math.abs(y - rowH) < 1e-9)
  assert.ok(hasExactNotch, 'the concave corner must land exactly on the notch vertex, unrounded')
})

test('pocketRing dispatches shape: iso-enter to isoEnterRing', () => {
  const p = { units: 1.5, x: 3, y: 4, shape: 'iso-enter' as const }
  const viaRing = pocketRing(p, PYTHON_SIZING)
  const viaDirect = isoEnterRing(p, PYTHON_SIZING)
  assert.deepEqual(viaRing, [viaDirect])
})
