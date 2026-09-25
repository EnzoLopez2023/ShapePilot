// @vitest-environment jsdom
//
// The properties panel. The case that prompted this file: an imported outline
// in a 3D designer had no editable dimension at all, so the one number about it
// a person actually sets -- how thick it extrudes -- could only be reached by
// asking the assistant.
import assert from 'node:assert/strict'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeModeProvider } from '../../src/theme/ThemeModeProvider.tsx'
import Inspector from '../../src/components/designer/Inspector.tsx'
import type { SceneObject, Triple } from '../../src/model/document.ts'
import { IDENTITY_TRANSFORM } from '../../src/model/scene.ts'

afterEach(() => cleanup())

const base = {
  transform: IDENTITY_TRANSFORM,
  mode: 'solid' as const,
  visible: true,
  locked: false,
}

const importedOutline: SceneObject = {
  ...base,
  id: 'holder',
  name: 'Keyboard Holder.svg',
  type: 'path',
  rings: [[[0, 0], [100, 0], [100, 60], [0, 60]]],
  thicknessMm: 5,
}

const renderInspector = (
  object: SceneObject,
  onPatch: (patch: Partial<SceneObject>) => void,
  props: {
    showZ?: boolean; showCut?: boolean; measuredMm?: Triple
    keepProportions?: boolean; onKeepProportions?: (keep: boolean) => void
  } = {},
) => render(
  <ThemeModeProvider initialPreference="light">
    <Inspector
      object={object}
      selectionCount={1}
      imperial={false}
      onPatch={onPatch}
      {...props}
    />
  </ThemeModeProvider>,
)

test('an imported outline can be given a thickness in a 3D designer', async () => {
  const user = userEvent.setup()
  const onPatch = vi.fn()
  renderInspector(importedOutline, onPatch)

  const field = screen.getByLabelText('Thickness') as HTMLInputElement
  assert.equal(field.value, '5')

  await user.clear(field)
  await user.type(field, '10')
  await user.tab()

  expect(onPatch).toHaveBeenCalledWith({ thicknessMm: 10 })
})

test('the Shaper page does not offer a thickness; it cuts sheet stock', () => {
  renderInspector(importedOutline, vi.fn(), { showZ: false, showCut: true })
  assert.equal(screen.queryByLabelText('Thickness'), null)
  // The cut block is what belongs to that page, and it is still there.
  assert.ok(screen.getByLabelText('Cut type'))
})

test('a drawn shape keeps its size fields and gains a thickness', () => {
  renderInspector({
    ...base, id: 'r', name: 'Rect', type: 'shape2d', shape: 'rect',
    params: { widthMm: 40, heightMm: 20 }, thicknessMm: 3,
  }, vi.fn())

  assert.equal((screen.getByLabelText('Width') as HTMLInputElement).value, '40')
  assert.equal((screen.getByLabelText('Thickness') as HTMLInputElement).value, '3')
})

test('text has both a glyph size and an extrusion thickness', () => {
  renderInspector({
    ...base, id: 't', name: 'Hello', type: 'text', text: 'Hello',
    fontId: 'archivo-medium', sizeMm: 12, thicknessMm: 2,
  }, vi.fn())

  assert.equal((screen.getByLabelText('Size') as HTMLInputElement).value, '12')
  assert.equal((screen.getByLabelText('Thickness') as HTMLInputElement).value, '2')
})

test('a mesh import still has nothing to size; it arrives at its own scale', () => {
  renderInspector({
    ...base, id: 'm', name: 'part.stl', type: 'imported', format: 'stl',
    asset: { hash: 'a'.repeat(64), filename: 'part.stl', byteLength: 10 },
  }, vi.fn())
  assert.equal(screen.queryByLabelText('Thickness'), null)
})

test('a mesh says how big it came out, since it has no dimensions to type', () => {
  renderInspector({
    ...base, id: 'm', name: 'part.stl', type: 'imported', format: 'stl',
    asset: { hash: 'a'.repeat(64), filename: 'part.stl', byteLength: 10 },
  }, vi.fn(), { measuredMm: [45.5, 30, 6] })

  assert.ok(screen.getByText(/45\.5 × 30 × 6 mm measured/))
  assert.ok(screen.getByText(/arrives at the size its file says/))
})

test('a scaled shape says its dimensions are the ones before scaling', () => {
  renderInspector({
    ...base, id: 'b', name: 'Box', type: 'solid', primitive: 'box',
    params: { widthMm: 20, depthMm: 20, heightMm: 20 },
    transform: { ...IDENTITY_TRANSFORM, scale: [2, 1, 1] },
  }, vi.fn(), { measuredMm: [40, 20, 20] })

  // The width field still reads 20, which on its own would be a lie.
  assert.equal((screen.getByLabelText('Width') as HTMLInputElement).value, '20')
  assert.ok(screen.getByText(/40 × 20 × 20 mm measured/))
  assert.ok(screen.getByText(/before scaling/))
})

test('an unscaled shape states its size once, not twice', () => {
  renderInspector({
    ...base, id: 'b', name: 'Box', type: 'solid', primitive: 'box',
    params: { widthMm: 20, depthMm: 20, heightMm: 20 },
  }, vi.fn(), { measuredMm: [20, 20, 20] })

  assert.equal(screen.queryByText(/measured/), null)
})

const importedMesh: SceneObject = {
  ...base,
  id: 'cover',
  name: 'cover.stl',
  type: 'imported',
  format: 'stl',
  asset: { hash: 'a'.repeat(64), filename: 'cover.stl', byteLength: 1 },
}

test('typing a size with proportions kept scales every axis by the same factor', async () => {
  const user = userEvent.setup()
  const onPatch = vi.fn()
  renderInspector(importedMesh, onPatch, {
    measuredMm: [80, 40, 20], keepProportions: true, onKeepProportions: vi.fn(),
  })
  const width = screen.getByLabelText('Size X') as HTMLInputElement
  assert.equal(width.value, '80')
  await user.clear(width)
  await user.type(width, '40')
  await user.tab()
  expect(onPatch).toHaveBeenCalledWith({ transform: { ...IDENTITY_TRANSFORM, scale: [0.5, 0.5, 0.5] } })
})

test('with proportions off, only the typed axis stretches', async () => {
  const user = userEvent.setup()
  const onPatch = vi.fn()
  const onKeep = vi.fn()
  renderInspector(importedMesh, onPatch, {
    measuredMm: [80, 40, 20], keepProportions: false, onKeepProportions: onKeep,
  })
  const height = screen.getByLabelText('Size Z') as HTMLInputElement
  await user.clear(height)
  await user.type(height, '30')
  await user.tab()
  expect(onPatch).toHaveBeenCalledWith({ transform: { ...IDENTITY_TRANSFORM, scale: [1, 1, 1.5] } })

  await user.click(screen.getByLabelText('Keep proportions'))
  expect(onKeep).toHaveBeenCalledWith(true)
})

test('an import starts at 100%, and a typed percentage scales it', async () => {
  const user = userEvent.setup()
  const onPatch = vi.fn()
  renderInspector(importedMesh, onPatch, {
    measuredMm: [80, 40, 20], keepProportions: true, onKeepProportions: vi.fn(),
  })
  const scaleX = screen.getByLabelText('Scale X percent') as HTMLInputElement
  expect(scaleX.value).toBe('100')
  await user.clear(scaleX)
  await user.type(scaleX, '103')
  await user.tab()
  expect(onPatch).toHaveBeenCalledWith({ transform: { ...IDENTITY_TRANSFORM, scale: [1.03, 1.03, 1.03] } })
})

test('with proportions off, a percentage scales only its own axis', async () => {
  const user = userEvent.setup()
  const onPatch = vi.fn()
  renderInspector(importedMesh, onPatch, {
    measuredMm: [80, 40, 20], keepProportions: false, onKeepProportions: vi.fn(),
  })
  const scaleZ = screen.getByLabelText('Scale Z percent') as HTMLInputElement
  await user.clear(scaleZ)
  await user.type(scaleZ, '50')
  await user.tab()
  expect(onPatch).toHaveBeenCalledWith({ transform: { ...IDENTITY_TRANSFORM, scale: [1, 1, 0.5] } })
})
