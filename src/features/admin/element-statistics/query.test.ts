import { afterEach, expect, test, vi } from 'vitest'
import { initialElementQuery, elementSearch } from './query.ts'

afterEach(() => vi.useRealTimers())

test('relative preset links use the chosen calendar zone and correct inclusive dates', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-15T02:00:00Z'))
  const parsed = initialElementQuery(new URLSearchParams('range=7&timeZone=America%2FNew_York'), 'UTC')
  expect(parsed.query.filters.from).toBe('2026-09-08')
  expect(parsed.query.filters.to).toBe('2026-09-14')
  expect(parsed.range).toBe('7')
  expect(parsed.error).toBeNull()
})

test('shared explicit dates stay fixed and stop claiming a stale relative preset', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-15T18:00:00Z'))
  const parsed = initialElementQuery(new URLSearchParams('range=7&from=2026-08-01&to=2026-08-07'), 'UTC')
  expect(parsed.query.filters.from).toBe('2026-08-01')
  expect(parsed.query.filters.to).toBe('2026-08-07')
  expect(parsed.range).toBe('custom')
})

test('invalid and duplicate link filters fail explicitly instead of silently changing scope', () => {
  for (const query of ['range=invalid', 'range=custom', 'page=-1', 'timeZone=invalid', 'result=all&result=completed']) {
    expect(initialElementQuery(new URLSearchParams(query), 'UTC').error).not.toBeNull()
  }
})

test('all-history scope, sort, pagination and unit-bearing zone survive URL serialization', () => {
  const parsed = initialElementQuery(new URLSearchParams('range=all&timeZone=UTC&sort=weight_desc&page=2&pageSize=50'), 'UTC')
  expect(parsed.query.filters.from).toBeNull()
  expect(parsed.query.filters.to).toBeNull()
  expect(initialElementQuery(elementSearch(parsed.query, parsed.range), 'UTC').query).toEqual(parsed.query)
})
