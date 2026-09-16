// Reorder warnings, from the AMS the printer actually reported.
//
// The slot fixtures are the four spools production reported on 2026-09-16 --
// PLA Basic Cocoa Brown, Gray, Pumpkin Orange and Jade White -- with the
// percentages moved where a test needs them lower.
import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import {
  LOW_PERCENT, amsStockOf, matchAmsSlot, slotLabel, stockOf,
} from './filamentStock.ts'
import type { AmsStock } from './filamentStock.ts'
import type { ElementAmsSlot, ElementSnapshot } from './elementStatistics.ts'

const COCOA = 'bambu-lab/pla/basic/cocoa-brown-10802'
const GRAY = 'bambu-lab/pla/basic/gray-10103'
const PUMPKIN = 'bambu-lab/pla/basic/pumpkin-orange-10301'
const JADE = 'bambu-lab/pla/basic/jade-white-10100'

const slot = (slotId: string, color: string, remainingPercent: number | null,
  extra: Partial<ElementAmsSlot> = {}): ElementAmsSlot => ({
  amsId: '0', slotId, material: 'PLA', subBrand: 'PLA Basic', color,
  remainingPercent, empty: false, ...extra,
})

const snapshot = (ams: ElementAmsSlot[] | null): ElementSnapshot => ({
  receivedAt: '2026-09-16T14:01:19.896Z', state: 'RUNNING', jobId: null, jobName: null,
  progressPercent: null, remainingMinutes: null, currentLayer: null, totalLayers: null,
  nozzleActualC: null, nozzleTargetC: null, bedActualC: null, bedTargetC: null,
  wifiSignalDbm: null, printError: null, hms: [], ams,
  fieldUpdatedAt: { ams: '2026-09-16T13:59:19.874Z' },
})

const production = () => amsStockOf(snapshot([
  slot('0', '#6F5034FF', 55),
  slot('1', '#8E9089FF', 62),
  slot('2', '#FF9016FF', 98),
  slot('3', '#FFFFFFFF', 66),
])) as AmsStock

const owning = (counts: Record<string, number>) => (key: string) => counts[key] ?? 0

describe('matching a slot', () => {
  test('the product name names the line, and the colour picks within it', () => {
    const stock = production()
    assert.deepEqual(stock.slots.map(entry => entry.key), [COCOA, GRAY, PUMPKIN, JADE])
    // White is white in every line; "PLA Basic" is what makes it Jade White.
    assert.equal(matchAmsSlot({ subBrand: 'PLA Matte', color: '#FFFFFFFF' }),
      'bambu-lab/pla/matte/ivory-white-11100')
  })

  test('an unknown product or a colour the line does not sell is not a catalogue colour', () => {
    assert.equal(matchAmsSlot({ subBrand: '', color: '#161616FF' }), null)
    assert.equal(matchAmsSlot({ subBrand: 'Generic ABS', color: '#161616FF' }), null)
    assert.equal(matchAmsSlot({ subBrand: 'PLA Basic', color: '#307FE2FF' }), null)
    assert.equal(matchAmsSlot({ subBrand: 'PLA Basic', color: null }), null)
  })

  test('drops empty slots, keeps the time the AMS itself reported, and survives no AMS', () => {
    const stock = amsStockOf(snapshot([slot('0', '#6F5034FF', 55), slot('1', '', null, { empty: true })]))
    assert.equal(stock?.slots.length, 1)
    assert.equal(stock?.receivedAt, '2026-09-16T13:59:19.874Z')
    assert.equal(amsStockOf(snapshot(null)), null)
    assert.equal(amsStockOf(null), null)
  })

  test('labels slots from one, as the printer does', () => {
    assert.equal(slotLabel({ amsId: '0', slotId: '3' }), 'AMS 1 · slot 4')
    assert.equal(slotLabel({ amsId: 'external', slotId: '0' }), 'AMS external · slot 0')
  })
})

describe('deciding to reorder', () => {
  test('nothing warns while every loaded spool is above the line', () => {
    const stock = stockOf(production(), owning({}))
    assert.ok(stock.every(entry => entry.status === 'ok'))
  })

  test('a low spool with nothing behind it says reorder', () => {
    const ams = production()
    ams.slots[0].remainingPercent = 12
    const cocoa = stockOf(ams, owning({ [COCOA]: 1 }))[0]
    assert.deepEqual(
      [cocoa.key, cocoa.status, cocoa.lowestPercent, cocoa.owned, cocoa.spares],
      [COCOA, 'reorder', 12, 1, 0])
  })

  test('the loaded spool is one of the ones you own, so a spare means owning two', () => {
    const ams = production()
    ams.slots[0].remainingPercent = 12
    assert.equal(stockOf(ams, owning({ [COCOA]: 2 }))
      .find(entry => entry.key === COCOA)?.status, 'covered')
    assert.equal(stockOf(ams, owning({ [COCOA]: 2 }))
      .find(entry => entry.key === COCOA)?.spares, 1)
  })

  test('a colour loaded but never ticked has no spares on record', () => {
    const ams = production()
    ams.slots[3].remainingPercent = 5
    const jade = stockOf(ams, owning({})).find(entry => entry.key === JADE)
    assert.equal(jade?.status, 'reorder')
    assert.equal(jade?.owned, 0)
  })

  test('the line is inclusive, and two loaded spools of a colour both count against spares', () => {
    const ams = amsStockOf(snapshot([
      slot('0', '#6F5034FF', LOW_PERCENT),
      slot('1', '#6F5034FF', 90),
    ])) as AmsStock
    const cocoa = stockOf(ams, owning({ [COCOA]: 2 }))[0]
    assert.equal(cocoa.status, 'reorder')
    assert.equal(cocoa.spares, 0)
    assert.equal(cocoa.loaded[0].remainingPercent, LOW_PERCENT)
  })

  test('an unreported percentage never warns, however few you own', () => {
    const ams = amsStockOf(snapshot([slot('0', '#6F5034FF', null)])) as AmsStock
    const cocoa = stockOf(ams, owning({}))[0]
    assert.equal(cocoa.lowestPercent, null)
    assert.equal(cocoa.status, 'ok')
  })

  test('reorders sort first, lowest first; unmatched slots are left out', () => {
    const ams = production()
    ams.slots[1].remainingPercent = 15
    ams.slots[3].remainingPercent = 4
    ams.slots.push({
      amsId: '1', slotId: '0', key: null, material: 'ABS', subBrand: '',
      color: '#161616', remainingPercent: 1,
    })
    const stock = stockOf(ams, owning({}))
    assert.deepEqual(stock.map(entry => [entry.key, entry.status]), [
      [JADE, 'reorder'], [GRAY, 'reorder'], [COCOA, 'ok'], [PUMPKIN, 'ok'],
    ])
  })
})
