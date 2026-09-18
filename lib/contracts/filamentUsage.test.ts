// Usage matching, against the filament mix real print history actually holds.
//
// The fixtures reproduce the tuples the 2026-09-16 spike found in production --
// material, preset ID, AMS colour -- because those are the shapes that decide
// whether this is right: GFA00 with a PLA Basic colour, GFA01 with a Matte one,
// a PLA blue in no catalogue line, generic-preset ABS in third-party colours,
// and a Basic preset printing a Matte-only colour.
import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import {
  candidatesFor, computeFilamentUsage, matchSource, normalizeColor, normalizeSource,
} from './filamentUsage.ts'
import type { FilamentUsageMapping } from './filamentUsage.ts'
import type { ElementJob, ElementJobResult, ElementMaterialUsage } from './elementStatistics.ts'

let nextJob = 1
const job = (
  materials: Partial<ElementMaterialUsage>[],
  { result = 'completed', startedAt = '2026-09-10T12:00:00Z' }:
    { result?: ElementJobResult; startedAt?: string | null } = {},
): ElementJob => ({
  connectionId: 'c'.repeat(64),
  id: `job-${nextJob++}`,
  title: null,
  result,
  rawStatus: null,
  startedAt,
  endedAt: null,
  actualDurationSeconds: null,
  estimatedDurationSeconds: null,
  estimatedWeightGrams: null,
  estimatedLength: null,
  lengthUnit: null,
  materials: materials.map(entry => ({
    material: null, filamentId: null, color: null, estimatedWeightGrams: null,
    nozzleId: null, amsId: '0', slotId: '0', ...entry,
  })),
  warnings: [],
  firstSeenAt: '2026-09-10T12:00:00Z',
  lastSeenAt: '2026-09-10T12:00:00Z',
})

const COCOA = 'bambu-lab/pla/basic/cocoa-brown-10802'
const JADE = 'bambu-lab/pla/basic/jade-white-10100'
const BLUE_CURRENT = 'bambu-lab/pla/basic/blue-10601'
const MANDARIN = 'bambu-lab/pla/matte/mandarin-orange-11300'

describe('normalisation', () => {
  test('drops alpha, upper-cases, and refuses what is not a colour', () => {
    assert.equal(normalizeColor('#6f5034ff'), '#6F5034')
    assert.equal(normalizeColor('6F5034'), '#6F5034')
    assert.equal(normalizeColor('#6F5034'), '#6F5034')
    for (const value of [null, '', 'brown', '#12345', '#1234567']) {
      assert.equal(normalizeColor(value), '')
    }
  })

  test('makes unreported fields empty, so equal filaments compare equal', () => {
    assert.deepEqual(normalizeSource({ material: ' pla ', filamentId: null, color: '#307fe2ff' }),
      { material: 'PLA', filamentId: '', color: '#307FE2' })
  })
})

describe('matching a source to a catalogue colour', () => {
  test('a known preset ID names the line, and the colour picks within it', () => {
    assert.equal(matchSource(normalizeSource({ material: 'PLA', filamentId: 'GFA00', color: '#6F5034FF' }))?.key, COCOA)
    assert.equal(matchSource(normalizeSource({ material: 'PLA', filamentId: 'GFA01', color: '#F99963FF' }))?.key, MANDARIN)
  })

  test('white is white in every line, and the preset ID is what separates them', () => {
    // #FFFFFF is Jade White, Ivory White, PETG White, PETG HF White and ABS White.
    assert.equal(matchSource(normalizeSource({ material: 'PLA', filamentId: 'GFA00', color: '#FFFFFFFF' }))?.key, JADE)
    // Without a known ID, PLA white is still two current colours: Basic and Matte.
    assert.equal(matchSource(normalizeSource({ material: 'PLA', filamentId: '', color: '#FFFFFFFF' })), null)
  })

  test('a retired code beside its identical replacement resolves to the one you can buy', () => {
    assert.equal(matchSource(normalizeSource({ material: 'PLA', filamentId: 'GFA00', color: '#0A2989FF' }))?.key, BLUE_CURRENT)
  })

  test('a colour the line does not sell is unmatched, not guessed from another line', () => {
    // Basic preset, Matte-only colour. Two facts disagree; neither wins.
    assert.equal(matchSource(normalizeSource({ material: 'PLA', filamentId: 'GFA00', color: '#F99963FF' })), null)
    // A PLA blue that is in no catalogue line at all.
    assert.equal(matchSource(normalizeSource({ material: 'PLA', filamentId: 'GFA00', color: '#307FE2FF' })), null)
  })

  test('without a known ID, material and exact colour must agree on one colour', () => {
    // Mandarin Orange exists only in PLA Matte.
    assert.equal(matchSource(normalizeSource({ material: 'PLA', filamentId: '', color: '#F99963' }))?.key, MANDARIN)
    // The same hex under a different material is not that filament.
    assert.equal(matchSource(normalizeSource({ material: 'PETG', filamentId: '', color: '#F99963' })), null)
    // Generic-preset ABS in a third-party colour.
    assert.equal(matchSource(normalizeSource({ material: 'ABS', filamentId: 'GFB99', color: '#161616FF' })), null)
    assert.equal(matchSource(normalizeSource({ material: '', filamentId: '', color: '#F99963' })), null)
  })

  test('suggests the nearest current colours, within the reported line or material', () => {
    const blue = candidatesFor(normalizeSource({ material: 'PLA', filamentId: 'GFA00', color: '#307FE2' }))
    assert.equal(blue.length, 5)
    assert.ok(blue.every(key => key.startsWith('bambu-lab/pla/basic/')))
    assert.ok(!blue.includes('bambu-lab/pla/basic/blue-10600'), 'discontinued colours are not suggested')
    const abs = candidatesFor(normalizeSource({ material: 'ABS', filamentId: 'GFB99', color: '#161616' }))
    assert.ok(abs.every(key => key.startsWith('bambu-lab/abs/')))
  })
})

describe('computing usage', () => {
  const history = () => [
    job([{ material: 'PLA', filamentId: 'GFA00', color: '#6F5034FF', estimatedWeightGrams: 100 }],
      { startedAt: '2026-09-05T10:00:00Z' }),
    job([
      { material: 'PLA', filamentId: 'GFA00', color: '#6F5034FF', estimatedWeightGrams: 40, slotId: '0' },
      { material: 'PLA', filamentId: 'GFA00', color: '#6F5034FF', estimatedWeightGrams: 2, slotId: '1' },
      { material: 'PLA', filamentId: 'GFA00', color: '#307FE2FF', estimatedWeightGrams: 300 },
    ], { result: 'failed_or_aborted', startedAt: '2026-09-12T10:00:00Z' }),
    job([{ material: 'ABS', filamentId: 'GFB99', color: '#161616FF', estimatedWeightGrams: 80 }]),
    job([{ material: 'ABS', filamentId: 'GFB99', color: '#AF7933FF', estimatedWeightGrams: 50 }]),
    job([{ material: 'PLA', filamentId: 'GFA00', color: '#FFFFFFFF', estimatedWeightGrams: null }]),
    job([], { startedAt: '2026-08-01T00:00:00Z' }),
  ]

  test('credits matched colours, counting each print once however many slots it used', () => {
    const usage = computeFilamentUsage(history(), [])
    const cocoa = usage.colors.find(color => color.key === COCOA)
    assert.deepEqual(cocoa, {
      key: COCOA, grams: 142, failedGrams: 42, prints: 2, lastUsedAt: '2026-09-12T10:00:00Z',
    })
  })

  test('lists what it could not match, largest first, with suggestions', () => {
    const usage = computeFilamentUsage(history(), [])
    assert.deepEqual(usage.unmatched.map(entry => [entry.material, entry.color, entry.grams]), [
      ['PLA', '#307FE2', 300],
      ['ABS', '#161616', 80],
      ['ABS', '#AF7933', 50],
    ])
    assert.equal(usage.unmatched[0].candidates.length, 5)
    assert.deepEqual(usage.untracked, [])
  })

  test('a hand-made link credits a colour, and "don\'t track" sets usage aside', () => {
    const mappings: FilamentUsageMapping[] = [
      { source: { material: 'PLA', filamentId: 'GFA00', color: '#307FE2' }, key: BLUE_CURRENT },
      { source: { material: 'ABS', filamentId: 'GFB99', color: '#161616' }, key: null },
      { source: { material: 'ABS', filamentId: 'GFB99', color: '#AF7933' }, key: null },
    ]
    const usage = computeFilamentUsage(history(), mappings)
    assert.equal(usage.colors.find(color => color.key === BLUE_CURRENT)?.grams, 300)
    assert.deepEqual(usage.unmatched, [])
    assert.deepEqual(usage.untracked.map(entry => [entry.color, entry.grams]),
      [['#161616', 80], ['#AF7933', 50]])
    assert.deepEqual(usage.mappings, mappings)
  })

  test('a link overrides even an automatic match', () => {
    const usage = computeFilamentUsage(history(), [
      { source: { material: 'PLA', filamentId: 'GFA00', color: '#6F5034' }, key: null },
    ])
    assert.equal(usage.colors.find(color => color.key === COCOA), undefined)
    assert.equal(usage.untracked[0].grams, 142)
  })

  test('a link to a colour the catalogue no longer has leaves the usage unmatched', () => {
    const usage = computeFilamentUsage(history(), [
      { source: { material: 'PLA', filamentId: 'GFA00', color: '#307FE2' }, key: 'bambu-lab/pla/basic/gone-99999' },
    ])
    assert.equal(usage.unmatched[0].color, '#307FE2')
  })

  test('reports its own coverage, including entries that carried no weight', () => {
    const usage = computeFilamentUsage(history(), [])
    assert.deepEqual(usage.coverage, {
      prints: 5, since: '2026-09-05T10:00:00Z', grams: 572, unweighedEntries: 1,
    })
    // The unweighed white print still matched, at zero grams.
    assert.equal(usage.colors.find(color => color.key === JADE)?.grams, 0)
  })
})

test('a multi-colour spool is matched on the first colour it reports', () => {
  // Real print history reported Ocean to Meadow (#307FE2 to #54FF9B) as #307FE2.
  const matched = matchSource(normalizeSource({ material: 'PLA', filamentId: '', color: '#307FE2FF' }))
  assert.equal(matched?.key, 'bambu-lab/pla/basic-gradient/ocean-to-meadow-10902')
  // Its second colour is never what a spool reports, so it matches nothing.
  assert.equal(matchSource(normalizeSource({ material: 'PLA', filamentId: '', color: '#54FF9B' })), null)
})
