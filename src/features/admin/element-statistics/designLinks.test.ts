import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { DocumentSummary } from '../../../services/designDocuments.ts'
import { designPath, matchDesign } from './designLinks.ts'

const doc = (id: string, name: string, kind: DocumentSummary['kind'] = 'bambu'): DocumentSummary => ({
  id, name, kind, objectCount: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
})

const designs = [doc('1', 'Bench dog'), doc('2', 'Keycap tray'), doc('3', 'Switch tray', 'shaper')]

test('an exported name comes back through the slicer and still matches', () => {
  // safeFilename turns "Bench dog" into "Bench_dog"; Studio adds the rest.
  for (const title of ['Bench_dog.3mf', 'Bench dog', 'bench_dog_plate_1', 'Bench_dog(1).3mf']) {
    assert.equal(matchDesign(title, designs)?.document.id, '1', title)
  }
})

test('a title that merely contains the name is offered, but marked inexact', () => {
  const match = matchDesign('bench_dog_repaired.3mf', designs)
  assert.equal(match?.document.id, '1')
  assert.equal(match?.exact, false)
})

test('nothing is offered when the title names no design, or names two equally', () => {
  assert.equal(matchDesign('Untitled plate', designs), null)
  assert.equal(matchDesign(null, designs), null)
  assert.equal(matchDesign('AB', [doc('1', 'AB')]), null)
  assert.equal(matchDesign('tray', [doc('1', 'tray'), doc('2', 'Tray')]), null)
})

test('a design opens in the designer it belongs to', () => {
  assert.equal(designPath(designs[0]), '/bambu-designer?open=1')
  assert.equal(designPath(designs[2]), '/shaper-designer?open=3')
  assert.equal(designPath(doc('9', 'Idea', 'playground')), '/playground?open=9')
})
