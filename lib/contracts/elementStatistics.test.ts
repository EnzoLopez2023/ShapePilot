import { expect, test } from 'vitest'
import { elementElapsedSeconds } from './elementStatistics.ts'

const start = '2026-09-14T10:00:00.000Z'
const end = '2026-09-14T11:00:00.000Z'
const observed = '2026-09-15T12:00:00.000Z'

test('elapsed runtime derives only from valid terminal timestamps, never a slice estimate', () => {
  expect(elementElapsedSeconds('completed', start, end, observed)).toBe(3600)
  expect(elementElapsedSeconds('completed', start, '2026-09-14T10:01:01.000Z', observed)).toBe(61)
  expect(elementElapsedSeconds('failed_or_aborted', start, end, observed)).toBe(3600)
  expect(elementElapsedSeconds('active', start, end, observed)).toBeNull()
  expect(elementElapsedSeconds('unknown', start, end, observed)).toBeNull()
})

test.each<[string | null, string | null, string]>([
  [null, end, observed],
  [start, null, observed],
  [end, start, observed],
  [start, '2026-09-14T10:00:59.000Z', observed],
  [start, '2026-09-14T10:01:00.000Z', observed],
  ['invalid', end, observed],
  [start, end, 'invalid'],
  [start, end, '2026-09-14T10:30:00.000Z'],
])('unavailable interval: %s through %s, observed %s', (startedAt, endedAt, observedAt) => {
  expect(elementElapsedSeconds('completed', startedAt, endedAt, observedAt)).toBeNull()
})
