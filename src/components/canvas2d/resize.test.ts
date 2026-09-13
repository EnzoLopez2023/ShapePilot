// Handle-drag arithmetic. The properties that matter are the ones a user would
// notice going wrong: the edge you are not holding does not move, the numbers
// the inspector then shows are the ones you dragged to, and a shape with rules
// of its own (a pegboard's slot grid, a circle's single radius) keeps them.
import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  framePoint, handleCursor, localFrame, resizeEdit, resizerFor,
} from './resize.ts'
import type { LocalFrame } from './resize.ts'
import { compileObject } from '../../geometry/sceneShapes.ts'
import type { PathObject, SceneObject, Shape2DObject } from '../../model/document.ts'
import { createShape2D, IDENTITY_TRANSFORM } from '../../model/scene.ts'

const close = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  )

const frameOf = (object: SceneObject): LocalFrame => {
  const frame = localFrame(object, compileObject(object))
  assert.ok(frame, 'object should have a frame')
  return frame
}

const rect = (widthMm: number, heightMm: number, at: [number, number] = [0, 0]) =>
  createShape2D('rect', [at[0], at[1], 0], { widthMm, heightMm })

test('a frame is the object\'s own box, not an upright box around it', () => {
  const upright = frameOf(rect(40, 20))
  close(upright.box.maxX - upright.box.minX, 40)
  close(upright.box.maxY - upright.box.minY, 20)

  const turned: SceneObject = {
    ...rect(40, 20),
    transform: { ...IDENTITY_TRANSFORM, rotationDeg: [0, 0, 45] },
  }
  const frame = frameOf(turned)
  // A 45-degree rectangle spans ~42 mm across the page; its own box is still
  // 40 by 20, which is what the dimension labels have to read.
  close(frame.box.maxX - frame.box.minX, 40, 1e-3)
  close(frame.box.maxY - frame.box.minY, 20, 1e-3)
  assert.equal(frame.rotationDeg, 45)
})

test('dragging the east edge widens the rectangle and leaves the west edge put', () => {
  const object = rect(40, 20)
  const frame = frameOf(object)
  const westBefore = framePoint(frame, 0, 0.5)

  const edit = resizeEdit(object, frame, 'e', [30, 0])
  assert.ok(edit)
  close(edit.widthMm, 50)
  close(edit.heightMm, 20)
  assert.equal((edit.patch as Shape2DObject).params.widthMm, 50)

  const westAfter = framePoint(edit.frame, 0, 0.5)
  close(westAfter[0], westBefore[0])
  close(westAfter[1], westBefore[1])
  // It grew eastward, so its centre moved half the growth that way.
  close(edit.position[0], 5)
})

test('a corner holds the opposite corner, whatever the shape is turned to', () => {
  const object: SceneObject = {
    ...rect(40, 20, [10, 5]),
    transform: { ...IDENTITY_TRANSFORM, position: [10, 5, 0], rotationDeg: [0, 0, 37] },
  }
  const frame = frameOf(object)
  const heldBefore = framePoint(frame, 0, 0)

  // Pointer given in the object's own frame: the north-east corner pulled out
  // to (30, 15), which is 50 by 25 away from the south-west corner it holds.
  const edit = resizeEdit(object, frame, 'ne', [30, 15])
  assert.ok(edit)
  // Loose by a quantum: the frame is read back off polygons the compiler has
  // already snapped to its 1e-4 mm grid.
  close(edit.widthMm, 50, 1e-3)
  close(edit.heightMm, 25, 1e-3)

  const heldAfter = framePoint(edit.frame, 0, 0)
  close(heldAfter[0], heldBefore[0], 1e-9)
  close(heldAfter[1], heldBefore[1], 1e-9)
})

test('Option grows both ways, so the centre is what stays put', () => {
  const object = rect(40, 20)
  const frame = frameOf(object)
  const edit = resizeEdit(object, frame, 'e', [30, 0], { fromCentre: true })
  assert.ok(edit)
  close(edit.widthMm, 60)
  close(edit.position[0], 0)
  close(edit.position[1], 0)
})

test('Shift holds the ratio; a circle holds it with or without', () => {
  const boxy = rect(40, 20)
  const kept = resizeEdit(boxy, frameOf(boxy), 'ne', [30, 2], { keepAspect: true })
  assert.ok(kept)
  close(kept.widthMm / kept.heightMm, 2)

  const circle = createShape2D('circle', [0, 0, 0], { radiusMm: 10 })
  const edit = resizeEdit(circle, frameOf(circle), 'e', [20, 0])
  assert.ok(edit)
  // Held at the west edge (-10), so the pointer at 20 asks for 30 mm across --
  // and one radius means the height follows the width unasked.
  close(edit.widthMm, 30)
  close(edit.heightMm, 30)
  close((edit.patch as Shape2DObject).params.radiusMm ?? 0, 15)
})

test('snap rounds the dimension, not the pointer', () => {
  const object = rect(40, 20)
  const edit = resizeEdit(object, frameOf(object), 'e', [26.3, 0], {
    snap: mm => Math.round(mm / 5) * 5,
  })
  assert.ok(edit)
  close(edit.widthMm, 45)
})

test('a pegboard lands on its slot grid rather than between two rows', () => {
  const board = createShape2D('skadis')
  const frame = frameOf(board)
  // The default board is 360 wide, so a pointer 205.5 mm east of its held edge
  // asks for 385.5. 400 is the nearest width that keeps the edge slots 20 mm
  // in, and the frame reports what was actually built rather than what was asked.
  const edit = resizeEdit(board, frame, 'e', [205.5, 0])
  assert.ok(edit)
  close(edit.widthMm, 400)
  assert.equal((edit.patch as Shape2DObject).params.widthMm, 400)
})

test('nothing can be dragged away to nothing', () => {
  const object = rect(40, 20)
  const edit = resizeEdit(object, frameOf(object), 'e', [-20, 0])
  assert.ok(edit)
  assert.ok(edit.widthMm > 0)
  assert.ok(edit.widthMm < 1)
})

test('an imported outline has no dimensions of its own, so it scales', () => {
  const path: PathObject = {
    id: 'outline', name: 'Bracket.svg', type: 'path',
    rings: [[[0, 0], [20, 0], [20, 10], [0, 10]]],
    transform: IDENTITY_TRANSFORM, mode: 'solid', visible: true, locked: false,
  }
  const frame = frameOf(path)
  const edit = resizeEdit(path, frame, 'e', [40, 0])
  assert.ok(edit)
  close(edit.widthMm, 40)
  assert.deepEqual((edit.patch as PathObject).transform.scale, [2, 1, 1])
  // Its local box starts at the origin rather than around it, so holding the
  // west edge means moving nothing: scaling already pins that edge.
  close(edit.position[0], 0)
})

test('a mesh and a 3D primitive have no 2D size to drag', () => {
  assert.equal(resizerFor({
    id: 'm', name: 'Part.stl', type: 'imported', format: 'stl',
    asset: { hash: 'a', filename: 'Part.stl', byteLength: 1 },
    transform: IDENTITY_TRANSFORM, mode: 'solid', visible: true, locked: false,
  }), null)
  assert.equal(resizerFor({
    id: 'b', name: 'Box', type: 'solid', primitive: 'box', params: { widthMm: 10 },
    transform: IDENTITY_TRANSFORM, mode: 'solid', visible: true, locked: false,
  }), null)
})

test('the cursor points the way the grip actually faces', () => {
  assert.equal(handleCursor('e', 0), 'ew-resize')
  assert.equal(handleCursor('n', 0), 'ns-resize')
  assert.equal(handleCursor('ne', 0), 'nesw-resize')
  assert.equal(handleCursor('nw', 0), 'nwse-resize')
  // Turn the shape a quarter and the east grip now points up the page.
  assert.equal(handleCursor('e', 90), 'ns-resize')
})
