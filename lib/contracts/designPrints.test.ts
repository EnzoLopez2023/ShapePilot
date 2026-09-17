import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { ElementJob } from './elementStatistics.ts'
import { designPrintHistory, titleMatchesDesign } from './designPrints.ts'

const job = (over: Partial<ElementJob>): ElementJob => ({
  id: 'j', connectionId: 'c1', title: null, result: 'completed', rawStatus: null,
  startedAt: null, endedAt: null, actualDurationSeconds: null, estimatedDurationSeconds: null,
  estimatedWeightGrams: null, estimatedLength: null, lengthUnit: null,
  materials: [], warnings: [], firstSeenAt: '2026-01-01T00:00:00Z', lastSeenAt: '2026-01-01T00:00:00Z',
  ...over,
})

test('a design name survives the slicer that printed it', () => {
  for (const title of ['Bench_dog.3mf', 'bench dog', 'Bench_dog_plate_1', 'bench_dog(2).3mf']) {
    assert.ok(titleMatchesDesign(title, 'Bench dog'), title)
  }
  assert.equal(titleMatchesDesign('Something else', 'Bench dog'), false)
  assert.equal(titleMatchesDesign(null, 'Bench dog'), false)
  // Too short to mean anything: it would match half the ledger.
  assert.equal(titleMatchesDesign('ab', 'ab'), false)
})

test('history counts outcomes, the latest start and the average estimate', () => {
  const history = designPrintHistory('Bench dog', [
    job({ id: '1', title: 'Bench_dog.3mf', result: 'completed', startedAt: '2026-09-01T10:00:00Z', estimatedWeightGrams: 100 }),
    job({ id: '2', title: 'bench dog plate 1', result: 'failed_or_aborted', startedAt: '2026-09-05T10:00:00Z', estimatedWeightGrams: 120 }),
    // Reported no weight: it counts as a print, not as a zero.
    job({ id: '3', title: 'Bench_dog', result: 'completed', startedAt: '2026-09-03T10:00:00Z' }),
    job({ id: '4', title: 'Keycap tray', result: 'completed', startedAt: '2026-09-09T10:00:00Z' }),
  ])
  assert.equal(history.prints, 3)
  assert.deepEqual(history.results, { completed: 2, failed_or_aborted: 1, active: 0, unknown: 0 })
  assert.equal(history.lastPrintedAt, '2026-09-05T10:00:00Z')
  assert.equal(history.averageGrams, 110)
  assert.equal(history.gramsKnown, 2)
})

test('a design nothing printed has no history rather than zeroes pretending to be one', () => {
  const history = designPrintHistory('Unprinted', [job({ title: 'Bench_dog' })])
  assert.equal(history.prints, 0)
  assert.equal(history.averageGrams, null)
  assert.equal(history.lastPrintedAt, null)
})
