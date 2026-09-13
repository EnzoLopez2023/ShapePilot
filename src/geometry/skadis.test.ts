// The numbers here come off the SKADIS technical drawing, not off our own
// output: a board that is a millimetre out takes no hooks at all.
import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  SKADIS, SKADIS_DEFAULT_HEIGHT_MM, SKADIS_DEFAULT_WIDTH_MM,
  skadisRings, skadisSlotCentres, snapSkadisHeightMm, snapSkadisWidthMm,
} from './skadis.ts'
import type { MultiPolygon } from './vec.ts'
import { ringBBox, signedArea } from './vec.ts'
import { difference } from './boolean.ts'
import { compileObject } from './sceneShapes.ts'
import { createShape2D } from '../model/scene.ts'
import type { DesignDocument } from '../model/document.ts'
import { sceneCutDrawing } from '../features/shaper-designer/cutDrawing.ts'

const W = SKADIS_DEFAULT_WIDTH_MM
const H = SKADIS_DEFAULT_HEIGHT_MM

test('the stock board is the 36 x 56 cm sold as 14 1/4" x 22"', () => {
  assert.equal(W, 360)
  assert.equal(H, 560)
  assert.equal(+(W / 25.4).toFixed(2), 14.17)   // 14 1/4" nominal
  assert.equal(+(H / 25.4).toFixed(2), 22.05)   // 22" nominal
})

test('every edge slot centre sits exactly 20 mm from its edge', () => {
  const centres = skadisSlotCentres(W, H)
  const xs = centres.map(([x]) => x)
  const ys = centres.map(([, y]) => y)
  assert.equal(Math.min(...xs), SKADIS.edgeMarginMm)
  assert.equal(Math.max(...xs), W - SKADIS.edgeMarginMm)
  assert.equal(Math.min(...ys), SKADIS.edgeMarginMm)
  assert.equal(Math.max(...ys), H - SKADIS.edgeMarginMm)
})

test('rows step 20 mm and alternate rows stagger by half a column', () => {
  const centres = skadisSlotCentres(W, H)
  const rows = [...new Set(centres.map(([, y]) => y))].sort((a, b) => a - b)
  assert.equal(rows.length, 27)
  rows.forEach((y, i) => assert.equal(y, 20 + i * SKADIS.rowPitchMm))

  const xsAt = (y: number) => centres.filter(c => c[1] === y).map(c => c[0]).sort((a, b) => a - b)
  const even = xsAt(rows[0])
  const odd = xsAt(rows[1])
  // 9 slots at 20..340, then 8 at 40..320 -- the drawing's 40 mm pitch with the
  // odd row pushed half a pitch across.
  assert.deepEqual(even, [20, 60, 100, 140, 180, 220, 260, 300, 340])
  assert.deepEqual(odd, [40, 80, 120, 160, 200, 240, 280, 320])
  assert.equal(odd[0] - even[0], SKADIS.columnPitchMm / 2)
  assert.equal(even[1] - even[0], SKADIS.columnPitchMm)
  // Top and bottom rows match, so the board reads the same either way up.
  assert.deepEqual(xsAt(rows[rows.length - 1]), even)
  assert.equal(centres.length, 230)
})

test('a slot is a 5 x 15 mm obround', () => {
  const [, firstSlot] = skadisRings(W, H)
  const b = ringBBox(firstSlot)
  assert.equal(+(b.maxX - b.minX).toFixed(3), SKADIS.slotWidthMm)
  assert.equal(+(b.maxY - b.minY).toFixed(3), SKADIS.slotHeightMm)
  // Fully rounded ends: the radius is exactly half the width.
  assert.equal(SKADIS.slotRadiusMm * 2, SKADIS.slotWidthMm)
})

test('the outline is the board size, centred, with an R8 corner', () => {
  const [outline] = skadisRings(W, H)
  const b = ringBBox(outline)
  assert.deepEqual([b.minX, b.minY, b.maxX, b.maxY], [-W / 2, -H / 2, W / 2, H / 2])
  // A square corner would reach the full area; R8 rounds four of them off.
  const rounded = W * H - (4 - Math.PI) * SKADIS.cornerRadiusMm ** 2
  assert.ok(Math.abs(Math.abs(signedArea(outline)) - rounded) < 1)
})

test('sizes snap to the grid the 20 mm margin implies', () => {
  assert.equal(snapSkadisWidthMm(350), 360)
  assert.equal(snapSkadisWidthMm(361), 360)
  assert.equal(snapSkadisWidthMm(385), 400)
  assert.equal(snapSkadisHeightMm(555), 560)
  assert.equal(snapSkadisHeightMm(571), 580)
  // Snapped sizes are already on the grid, so snapping twice changes nothing.
  for (const mm of [137, 360, 401, 999]) {
    assert.equal(snapSkadisWidthMm(snapSkadisWidthMm(mm)), snapSkadisWidthMm(mm))
    assert.equal(snapSkadisHeightMm(snapSkadisHeightMm(mm)), snapSkadisHeightMm(mm))
  }
})

test('a snapped size of any shape keeps its edge slots 20 mm in', () => {
  for (const [rawW, rawH] of [[350, 555], [83, 41], [1000, 300], [40, 40]]) {
    const w = snapSkadisWidthMm(rawW)
    const h = snapSkadisHeightMm(rawH)
    const centres = skadisSlotCentres(w, h)
    assert.ok(centres.length > 0, `${w}x${h} has no slots`)
    assert.equal(Math.min(...centres.map(c => c[0])), SKADIS.edgeMarginMm)
    assert.equal(Math.max(...centres.map(c => c[0])), w - SKADIS.edgeMarginMm)
    assert.equal(Math.min(...centres.map(c => c[1])), SKADIS.edgeMarginMm)
    assert.equal(Math.max(...centres.map(c => c[1])), h - SKADIS.edgeMarginMm)
  }
})

test('the slots compile as real holes, not solid islands', () => {
  const board = createShape2D('skadis')
  const mp = compileObject(board)
  // One polygon carrying the outline plus 230 holes. Emitted as separate
  // polygons the slots would be solid, and the cut export unions them away.
  assert.equal(mp.length, 1)
  assert.equal(mp[0].length, 1 + 230)

  const [outer, ...holes] = mp[0]
  // normalizePolygon's invariant: outer CCW, holes CW.
  assert.ok(signedArea(outer) > 0)
  for (const hole of holes) assert.ok(signedArea(hole) < 0)

  // Net area is the board less every slot, so no slot fell outside the outline
  // or overlapped its neighbour.
  const net = holes.reduce((a, h) => a - Math.abs(signedArea(h)), Math.abs(signedArea(outer)))
  const slotArea = Math.abs(signedArea(holes[0]))
  assert.ok(Math.abs(net - (Math.abs(signedArea(outer)) - 230 * slotArea)) < 1e-6)
  assert.ok(net > 0)
})

test('every slot lies inside the board, corners included', () => {
  const [outline, ...slots] = skadisRings(W, H)
  // Containment by subtraction rather than by bbox: the R8 corners cut material
  // away, so a slot can sit inside the bounding box and still hang off the arc.
  const board = [[outline]] as MultiPolygon
  for (const slot of slots) {
    const outside = difference([[slot]] as MultiPolygon, board)
    assert.equal(outside.length, 0, 'a slot hangs off the board outline')
  }
})

test('a one-row, one-column board is still legal', () => {
  const w = snapSkadisWidthMm(1)
  const h = snapSkadisHeightMm(1)
  assert.deepEqual([w, h], [40, 40])
  const [outline, ...slots] = skadisRings(w, h)
  assert.equal(slots.length, 1)
  assert.deepEqual(skadisSlotCentres(w, h), [[20, 20]])
  assert.equal(difference([[slots[0]]] as MultiPolygon, [[outline]] as MultiPolygon).length, 0)
})

test('a pegboard cuts as an outline plus through-slots, on separate layers', () => {
  const board = { ...createShape2D('skadis'), cut: { type: 'exterior' as const } }
  const doc = {
    id: 'd', name: 'Pegboard', kind: 'shaper', objects: [board], revision: 0,
  } as unknown as DesignDocument
  const layers = sceneCutDrawing(doc).layers
  const byId = new Map(layers.map(l => [l.id, l]))

  // Origin picks the bit's behaviour from a path's colour, so slots sharing the
  // outline's layer would be profiled round, not drilled through.
  const exterior = byId.get('exterior-profile')
  assert.ok(exterior)
  assert.equal(exterior.polygons.length, 1)
  assert.equal(exterior.polygons[0].length, 1, 'the outline should carry no holes')

  const interior = byId.get('interior-cuts')
  assert.ok(interior)
  assert.equal(interior.polygons.length, 230)
  for (const poly of interior.polygons) {
    assert.equal(poly.length, 1)
    // Standalone now, so each slot must read as solid material to remove.
    assert.ok(signedArea(poly[0]) > 0)
  }
})
