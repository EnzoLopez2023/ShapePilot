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
import type { SceneObject } from '../../src/model/document.ts'
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
  props: { showZ?: boolean; showCut?: boolean } = {},
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
