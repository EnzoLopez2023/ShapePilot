import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { AmsStock, LoadedSlot } from '../../../lib/contracts/filamentStock.ts'
import type { SceneObject } from '../../model/document.ts'
import { createSolid } from '../../model/scene.ts'
import { amsTrays, assignExtruders, filamentWarnings, trayLabel } from './amsTrays.ts'

const loaded = (
  amsId: string, slotId: string, color = '#FF0000', key: string | null = null,
): LoadedSlot => ({
  amsId, slotId, key, material: 'PLA', subBrand: 'PLA Basic', color, remainingPercent: 80,
})

const stock = (slots: LoadedSlot[]): AmsStock => ({ receivedAt: '2026-09-17T10:00:00Z', slots })

const part = (name: string, over: Partial<SceneObject> = {}): SceneObject =>
  ({ ...createSolid('box'), name, ...over } as SceneObject)

test('trays are numbered the way Bambu Studio numbers a synced filament list', () => {
  const trays = amsTrays(stock([loaded('1', '2'), loaded('0', '0'), loaded('0', '3')]))
  assert.deepEqual(trays.map(t => [t.slot, t.label]), [[1, 'A1'], [4, 'A4'], [7, 'B3']])
})

test('the external spool and AMS HT units have no number and are left out', () => {
  assert.deepEqual(amsTrays(stock([loaded('external', '0'), loaded('128', '0')])), [])
  assert.deepEqual(amsTrays(null), [])
})

test('tray labels run A1 to D4', () => {
  assert.deepEqual([1, 4, 5, 16].map(trayLabel), ['A1', 'A4', 'B1', 'D4'])
})

test('auto parts take the lowest numbers nobody chose, in order', () => {
  assert.deepEqual(
    assignExtruders([{}, { filamentSlot: 1 }, {}, {}], 4),
    [2, 1, 3, 4])
})

test('auto parts past the last slot share it rather than naming a missing one', () => {
  assert.deepEqual(assignExtruders([{}, {}, {}, {}, {}], 4), [1, 2, 3, 4, 4])
})

test('two different colours on one tray are called out', () => {
  const warnings = filamentWarnings(
    [part('Base', { filamentSlot: 2, color: '#ff0000' }), part('Logo', { filamentSlot: 2, color: '#FFFFFF' })],
    amsTrays(stock([loaded('0', '1')])))
  assert.equal(warnings.length, 1)
  assert.match(warnings[0].message, /Base and Logo .* tray A2/)
})

test('the same colour on one tray is fine', () => {
  const warnings = filamentWarnings(
    [part('Base', { filamentSlot: 2, color: '#FF0000' }), part('Foot', { filamentSlot: 2, color: '#ff0000' })],
    amsTrays(stock([loaded('0', '1')])))
  assert.deepEqual(warnings, [])
})

test('a chosen tray that is empty is called out, but only with a report to check', () => {
  const objects = [part('Base', { filamentSlot: 3 })]
  assert.match(filamentWarnings(objects, [])[0].message, /Tray A3 is empty/)
  assert.deepEqual(filamentWarnings(objects, null), [])
})

test('holes and hidden parts print nothing, so they warn about nothing', () => {
  const objects = [
    part('Cutter', { filamentSlot: 3, mode: 'hole' }),
    part('Ghost', { filamentSlot: 3, visible: false }),
  ]
  assert.deepEqual(filamentWarnings(objects, []), [])
})

test('a tray carries the catalogue colour it matched, which is what prices it', () => {
  const [tray] = amsTrays(stock([loaded('0', '0', '#FFFFFF', 'bambu-lab/pla/basic/jade-white-10100')]))
  assert.equal(tray.key, 'bambu-lab/pla/basic/jade-white-10100')
})
