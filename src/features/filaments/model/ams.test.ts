import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { AmsStock, LoadedSlot } from '../../../../lib/contracts/filamentStock.ts'
import { amsUnits, trayName } from './ams.ts'

const slot = (amsId: string, slotId: string): LoadedSlot => ({
  amsId, slotId, key: null, material: 'PLA', subBrand: 'PLA Basic', color: '#FF0000', remainingPercent: 50,
})

const stock = (slots: LoadedSlot[]): AmsStock => ({ receivedAt: '2026-09-18T10:00:00Z', slots })

test('trays are named the way Bambu Studio names them', () => {
  assert.equal(trayName(slot('0', '0')), 'A1')
  assert.equal(trayName(slot('1', '3')), 'B4')
  assert.equal(trayName(slot('128', '0')), 'HT1')
  assert.equal(trayName(slot('external', '0')), 'Ext')
})

test('a standard unit is drawn with all four bays, gaps included', () => {
  const [unit] = amsUnits(stock([slot('0', '0'), slot('0', '2')]))
  assert.equal(unit.name, 'AMS 1')
  assert.deepEqual(unit.bays.map(bay => bay.label), ['A1', 'A2', 'A3', 'A4'])
  assert.deepEqual(unit.bays.map(bay => bay.slot !== null), [true, false, true, false])
})

test('units come in the printer\'s order, the external spool last', () => {
  const units = amsUnits(stock([slot('external', '0'), slot('1', '0'), slot('0', '0')]))
  assert.deepEqual(units.map(unit => unit.name), ['AMS 1', 'AMS 2', 'External spool'])
})

test('no report is no units', () => {
  assert.deepEqual(amsUnits(null), [])
})
