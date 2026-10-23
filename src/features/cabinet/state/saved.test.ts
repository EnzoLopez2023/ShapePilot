// @vitest-environment jsdom
import assert from 'node:assert/strict'
import { beforeEach, test } from 'vitest'
import { DEFAULT_CABINET_SETTINGS } from './params.ts'
import { deleteCabinet, loadCabinet, saveCabinet, savedCabinetNames } from './saved.ts'

beforeEach(() => localStorage.clear())

test('a saved cabinet comes back under its name, label included', () => {
  assert.ok(saveCabinet('Left wall', { ...DEFAULT_CABINET_SETTINGS, trayCount: 7 }))
  const back = loadCabinet('Left wall', DEFAULT_CABINET_SETTINGS)
  assert.equal(back?.trayCount, 7)
  assert.equal(back?.label, 'Left wall')
})

test('names are listed sorted, and a deleted one is gone', () => {
  saveCabinet('b', DEFAULT_CABINET_SETTINGS)
  saveCabinet('a', DEFAULT_CABINET_SETTINGS)
  assert.deepEqual(savedCabinetNames(), ['a', 'b'])
  deleteCabinet('a')
  assert.deepEqual(savedCabinetNames(), ['b'])
  assert.equal(loadCabinet('a', DEFAULT_CABINET_SETTINGS), null)
})
