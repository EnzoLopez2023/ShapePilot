import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  cloneObject, createShape2D, createSolid, emptyDocument, findObject, flatten,
  groupObjects, removeObjects, subtreeIds, translateObjects, ungroupObject,
} from './scene.ts'

test('emptyDocument carries the right machine per kind', () => {
  assert.equal(emptyDocument('shaper').machine?.kind, 'cnc')
  assert.equal(emptyDocument('bambu').machine?.kind, 'printer')
  assert.deepEqual(emptyDocument('playground').chat, [])
  assert.equal(emptyDocument('bambu').chat, undefined)
})

test('grouping folds the selection into one object and preserves position', () => {
  const a = createShape2D('circle')
  const b = createShape2D('square')
  const c = createShape2D('triangle')
  const { objects, groupId } = groupObjects([a, b, c], new Set([a.id, c.id]))

  assert.equal(objects.length, 2)
  assert.ok(groupId)
  // The group lands where the first member sat, ahead of the untouched sibling.
  assert.equal(objects[0].id, groupId)
  assert.equal(objects[1].id, b.id)
  assert.deepEqual(flatten(objects).map(o => o.id).sort(), [a.id, b.id, c.id, groupId].sort())
})

test('grouping fewer than two objects is a no-op', () => {
  const a = createShape2D('circle')
  const { objects, groupId } = groupObjects([a], new Set([a.id]))
  assert.equal(groupId, null)
  assert.deepEqual(objects.map(o => o.id), [a.id])
})

test('ungroup is the inverse of group', () => {
  const a = createSolid('box')
  const b = createSolid('cylinder')
  const grouped = groupObjects([a, b], new Set([a.id, b.id]))
  const { objects, childIds } = ungroupObject(grouped.objects, grouped.groupId!)

  assert.deepEqual(objects.map(o => o.id), [a.id, b.id])
  assert.deepEqual(childIds, [a.id, b.id])
})

test('ungroup reaches a nested group', () => {
  const a = createSolid('box')
  const b = createSolid('cylinder')
  const inner = groupObjects([a, b], new Set([a.id, b.id]))
  const c = createSolid('sphere')
  const outer = groupObjects([...inner.objects, c], new Set([inner.groupId!, c.id]))

  const { childIds } = ungroupObject(outer.objects, inner.groupId!)
  assert.deepEqual(childIds, [a.id, b.id])
})

test('removeObjects prunes inside groups', () => {
  const a = createSolid('box')
  const b = createSolid('cylinder')
  const { objects } = groupObjects([a, b], new Set([a.id, b.id]))

  const pruned = removeObjects(objects, new Set([b.id]))
  assert.equal(findObject(pruned, b.id), undefined)
  assert.ok(findObject(pruned, a.id))
})

test('translateObjects moves only the named ids', () => {
  const a = createShape2D('circle', [10, 10, 0])
  const b = createShape2D('circle', [10, 10, 0])
  const moved = translateObjects([a, b], new Set([a.id]), 5, -2, 0)

  assert.deepEqual(moved[0].transform.position, [15, 8, 0])
  assert.deepEqual(moved[1].transform.position, [10, 10, 0])
})

test('cloneObject deep-copies with fresh ids', () => {
  const a = createSolid('box')
  const b = createSolid('cylinder')
  const { objects, groupId } = groupObjects([a, b], new Set([a.id, b.id]))
  const copy = cloneObject(objects[0], 5)

  const originalIds = new Set(subtreeIds(objects, groupId!))
  for (const o of flatten([copy])) assert.ok(!originalIds.has(o.id), 'ids must be regenerated')
  assert.equal(flatten([copy]).length, 3)
  assert.deepEqual(copy.transform.position, [5, 5, 0])
})
