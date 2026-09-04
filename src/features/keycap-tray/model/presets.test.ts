import assert from 'node:assert/strict'
import { test } from 'vitest'
import { PROFILE_PRESETS, getPreset } from './presets.ts'
import { PRESET_PROFILE_DATA } from './profileData.ts'
import { ringBBox } from '../../../geometry/vec.ts'

const raw = (id: string) => PRESET_PROFILE_DATA.find(d => d.id === id)!

// Fraction of a ring's points sitting in the near-edge band of its own bbox.
const edgeFraction = (ring: [number, number][], edge: 'top' | 'bottom'): number => {
  const b = ringBBox(ring)
  const band = 0.15 * (b.maxY - b.minY)
  const inBand = ([, y]: [number, number]) => (edge === 'top' ? y >= b.maxY - band : y <= b.minY + band)
  return ring.filter(inBand).length / ring.length
}

test('the notched preset is corrected 180 degrees from its raw extraction', () => {
  const rawRing = raw('systainer-s76-notched').ring as [number, number][]
  const preset = getPreset('systainer-s76-notched').ring as [number, number][]

  // Same footprint -- a 180 turn does not change the bounding box size.
  const rb = ringBBox(rawRing), pb = ringBBox(preset)
  assert.ok(Math.abs((rb.maxX - rb.minX) - (pb.maxX - pb.minX)) < 1e-6)
  assert.ok(Math.abs((rb.maxY - rb.minY) - (pb.maxY - pb.minY)) < 1e-6)

  // Whichever edge carried the notch detail in the raw extraction carries the
  // plain edge in the corrected preset, and vice versa.
  assert.ok(Math.abs(edgeFraction(rawRing, 'top') - edgeFraction(preset, 'bottom')) < 1e-6)
  assert.ok(Math.abs(edgeFraction(rawRing, 'bottom') - edgeFraction(preset, 'top')) < 1e-6)
})

test('the plain rectangular preset is untouched', () => {
  assert.deepEqual(getPreset('systainer-s76-plain').ring, raw('systainer-s76-plain').ring)
})

test('every preset still has a sane bounding box', () => {
  for (const p of PROFILE_PRESETS) {
    const b = ringBBox(p.ring)
    assert.ok(Math.abs((b.maxX - b.minX) - p.widthMm) < 1e-6, `${p.id} width`)
    assert.ok(Math.abs((b.maxY - b.minY) - p.heightMm) < 1e-6, `${p.id} height`)
  }
})
