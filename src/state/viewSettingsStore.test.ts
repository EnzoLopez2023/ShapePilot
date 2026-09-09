// @vitest-environment jsdom
import { describe, expect, test, beforeEach } from 'vitest'
import { booleanOr, createViewSettingsStore, numberIn } from './viewSettingsStore.ts'

interface Settings { zoom: number; grid: boolean }
const BASELINE: Settings = { zoom: 1, grid: true }

const read = (raw: unknown, baseline: Settings): Settings => {
  if (typeof raw !== 'object' || raw === null) return baseline
  const s = raw as Record<string, unknown>
  return {
    zoom: numberIn(s.zoom, 0.1, 10, baseline.zoom),
    grid: booleanOr(s.grid, baseline.grid),
  }
}

const store = createViewSettingsStore<Settings>({ key: 'test:view', read })

beforeEach(() => { localStorage.clear() })

describe('createViewSettingsStore', () => {
  test('a design nothing is remembered about comes back as the baseline', () => {
    expect(store.load('never-opened', BASELINE)).toEqual(BASELINE)
  })

  test('what was saved comes back', () => {
    store.save('7', { zoom: 2.5, grid: false })
    expect(store.load('7', BASELINE)).toMatchObject({ zoom: 2.5, grid: false })
  })

  test('designs do not read each other', () => {
    store.save('a', { zoom: 3, grid: false })
    store.save('b', { zoom: 4, grid: true })
    expect(store.load('a', BASELINE).zoom).toBe(3)
    expect(store.load('b', BASELINE).zoom).toBe(4)
  })

  test('forget drops one design and leaves the rest', () => {
    store.save('a', { zoom: 3, grid: false })
    store.save('b', { zoom: 4, grid: true })
    store.forget('a')
    expect(store.load('a', BASELINE)).toEqual(BASELINE)
    expect(store.load('b', BASELINE).zoom).toBe(4)
  })

  test('a field out of bounds degrades to the baseline, not to undefined', () => {
    localStorage.setItem('test:view', JSON.stringify({ '1': { zoom: 1e9, grid: 'yes' } }))
    expect(store.load('1', BASELINE)).toEqual(BASELINE)
  })

  test('a record that is not an object at all is survivable', () => {
    localStorage.setItem('test:view', '"not a record"')
    expect(() => store.load('1', BASELINE)).not.toThrow()
    expect(store.load('1', BASELINE)).toEqual(BASELINE)
  })

  test('unparseable storage is survivable', () => {
    localStorage.setItem('test:view', '{oh no')
    expect(() => store.load('1', BASELINE)).not.toThrow()
    expect(store.load('1', BASELINE)).toEqual(BASELINE)
  })

  // Reaches past what either feature's own suite can: the prune limit is a
  // parameter now, so prove it is honoured rather than hardcoded at 60.
  test('the record is pruned to the configured limit, least recent first', () => {
    const small = createViewSettingsStore<Settings>({ key: 'test:small', read, remembered: 3 })
    for (const id of ['1', '2', '3', '4', '5']) small.save(id, { zoom: Number(id), grid: true })
    const record = JSON.parse(localStorage.getItem('test:small') ?? '{}') as Record<string, unknown>
    expect(Object.keys(record)).toHaveLength(3)
    expect(record['1']).toBeUndefined()
    expect(record['2']).toBeUndefined()
    expect(record['5']).toBeDefined()
  })

  // Two designers share the mechanism but must not share a namespace.
  test('two stores with different keys do not collide', () => {
    const other = createViewSettingsStore<Settings>({ key: 'test:other', read })
    store.save('1', { zoom: 2, grid: false })
    other.save('1', { zoom: 9, grid: true })
    expect(store.load('1', BASELINE).zoom).toBe(2)
    expect(other.load('1', BASELINE).zoom).toBe(9)
  })

  test('the stamp the store adds does not leak into what read sees as a field', () => {
    store.save('1', { zoom: 2, grid: false })
    expect(store.load('1', BASELINE)).toEqual({ zoom: 2, grid: false })
  })
})

describe('field coercers', () => {
  test('numberIn refuses strings, NaN, Infinity and out-of-range', () => {
    expect(numberIn('2', 0, 10, 5)).toBe(5)
    expect(numberIn(Number.NaN, 0, 10, 5)).toBe(5)
    expect(numberIn(Number.POSITIVE_INFINITY, 0, 10, 5)).toBe(5)
    expect(numberIn(-1, 0, 10, 5)).toBe(5)
    expect(numberIn(11, 0, 10, 5)).toBe(5)
    expect(numberIn(0, 0, 10, 5)).toBe(0)
    expect(numberIn(10, 0, 10, 5)).toBe(10)
  })

  test('booleanOr refuses truthy non-booleans', () => {
    expect(booleanOr('yes', false)).toBe(false)
    expect(booleanOr(1, false)).toBe(false)
    expect(booleanOr(false, true)).toBe(false)
  })
})
