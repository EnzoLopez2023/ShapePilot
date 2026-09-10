// @vitest-environment jsdom
//
// The tray design hook: undo/redo, revision and pocket extents.
//
// No page is mounted here, which is why it runs in milliseconds rather than
// seconds -- worth keeping apart from anything that renders the designer.
//
// Split out of what was a single 1,054-line file: vitest parallelises by file
// and cannot overlap a file with itself, so one 160 s suite was the long pole
// of the whole quality job. The stub and render helpers live in
// test/helpers/keycapTrayHarness.tsx so every part still exercises the same
// client stack -- service, HTTP client, state hook, components -- against the
// same fetch boundary.
import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  useTrayDesign, pocketExtent, pocketAABB,
} from '../../src/features/keycap-tray/state/useTrayDesign.ts'
import { PYTHON_SIZING } from '../../src/features/keycap-tray/geometry/shapes.ts'
import { installHarness } from './keycapTrayHarness.tsx'
// No raised timeout here, unlike its three siblings: nothing in this file
// mounts a page, so the whole suite runs in milliseconds and the 30 s default
// is ample. A timeout copied in out of habit would say the opposite.
installHarness()
describe('tray design state', () => {
  test('undo/redo is bounded at 50 steps and restores the previous design', () => {
    const { result } = renderHook(() => useTrayDesign())
    assert.equal(result.current.canUndo, false)

    act(() => { result.current.addPocket(1, 0, 0) })
    assert.equal(result.current.design.pockets.length, 1)
    assert.equal(result.current.canUndo, true)

    act(() => { result.current.undo() })
    assert.equal(result.current.design.pockets.length, 0)
    act(() => { result.current.redo() })
    assert.equal(result.current.design.pockets.length, 1)

    // 60 further edits, then 60 undos: only the last 50 are recoverable.
    for (let i = 0; i < 60; i += 1) act(() => { result.current.addPocket(1, i, 0) })
    assert.equal(result.current.design.pockets.length, 61)
    for (let i = 0; i < 60; i += 1) act(() => { result.current.undo() })
    assert.equal(result.current.design.pockets.length, 11)
    assert.equal(result.current.canUndo, false)
  })

  test('a drag commits one history entry, not one per frame', () => {
    const { result } = renderHook(() => useTrayDesign())
    let id = ''
    act(() => { id = result.current.addPocket(1, 0, 0) })
    act(() => { result.current.movePockets([id], 5, 5) })
    const moved = result.current.design.pockets[0]
    assert.deepEqual([moved.x, moved.y], [5, 5])

    act(() => { result.current.undo() })
    const back = result.current.design.pockets[0]
    assert.deepEqual([back.x, back.y], [0, 0], 'one undo must reverse the whole move')
  })

  test('the revision counter advances on every mutation and resets on load', () => {
    const { result } = renderHook(() => useTrayDesign())
    const start = result.current.design.revision
    act(() => { result.current.addPocket(1, 0, 0) })
    assert.equal(result.current.design.revision, start + 1)
    act(() => { result.current.setDesign({ ...result.current.design, revision: 7 }) })
    assert.equal(result.current.design.revision, 0)
    assert.equal(result.current.canUndo, false, 'loading clears history')
  })

  test('selection is replaced, extended and cleared', () => {
    const { result } = renderHook(() => useTrayDesign())
    let a = '', b = ''
    act(() => { a = result.current.addPocket(1, 0, 0) })
    act(() => { b = result.current.addPocket(1, 30, 0) })

    act(() => { result.current.toggleSelection(a, false) })
    assert.deepEqual([...result.current.selection], [a])

    act(() => { result.current.toggleSelection(b, true) })
    assert.equal(result.current.selection.size, 2)

    act(() => { result.current.toggleSelection(b, true) })
    assert.deepEqual([...result.current.selection], [a])

    act(() => { result.current.removePockets([a]) })
    assert.equal(result.current.selection.size, 0)
    assert.equal(result.current.design.pockets.length, 1)
  })

  test('pocketExtent is the un-rotated footprint (the rotation pivot box)', () => {
    const flat = pocketExtent({ id: 'a', units: 2, x: 0, y: 0 }, PYTHON_SIZING)
    const tilted = pocketExtent({ id: 'a', units: 2, x: 0, y: 0, rotationDeg: 90 }, PYTHON_SIZING)
    assert.deepEqual([tilted.w, tilted.h], [flat.w, flat.h])

    const explicit = pocketExtent(
      { id: 'a', units: 1, x: 0, y: 0, widthMm: 14, heightMm: 14 }, PYTHON_SIZING)
    assert.deepEqual([explicit.w, explicit.h], [14, 14])

    const iso = pocketExtent({ id: 'a', units: 1.5, x: 0, y: 0, shape: 'iso-enter' }, PYTHON_SIZING)
    assert.ok(Math.abs(iso.h - 2 * PYTHON_SIZING.height) < 1e-9)
  })

  test('pocketAABB gives the rotated bounds and a rotation-invariant centre', () => {
    const flat = pocketAABB({ id: 'a', units: 2, x: 0, y: 0 }, PYTHON_SIZING)
    const quarter = pocketAABB({ id: 'a', units: 2, x: 0, y: 0, rotationDeg: 90 }, PYTHON_SIZING)
    const diag = pocketAABB({ id: 'a', units: 2, x: 0, y: 0, rotationDeg: 45 }, PYTHON_SIZING)

    const w = (b: typeof flat) => b.maxX - b.minX
    const h = (b: typeof flat) => b.maxY - b.minY
    const mid = (b: typeof flat) => [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]

    // 90deg swaps the extent; 45deg grows it on both axes.
    assert.ok(Math.abs(w(flat) - h(quarter)) < 1e-6)
    assert.ok(Math.abs(h(flat) - w(quarter)) < 1e-6)
    assert.ok(w(diag) > w(flat) + 1e-6 && h(diag) > h(flat) + 1e-6)

    // The centre never moves -- rotation pivots on it.
    assert.deepEqual(mid(quarter).map(n => Math.round(n * 1e6)), mid(flat).map(n => Math.round(n * 1e6)))
    assert.deepEqual(mid(diag).map(n => Math.round(n * 1e6)), mid(flat).map(n => Math.round(n * 1e6)))
  })
})
