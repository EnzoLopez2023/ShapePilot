import assert from 'node:assert/strict'
import { test } from 'vitest'
import { RACK } from './config.ts'
import { shallowestOverhangDeg, unsupportedRegions } from './supports.ts'

// The check that three separate features failed before anyone looked at a
// slice: openings, seam tab flanks, and the front lip all printed "fine" in
// principle and were supported in practice.
test('no part needs support at the slicer threshold', () => {
  const bad = unsupportedRegions(RACK)
  assert.deepEqual(bad, [], bad.map(o =>
    `${o.part} z=${o.z} juts ${o.jutMm.toFixed(2)}mm over ${o.areaMm2.toFixed(1)}mm2`).join('\n'))
})

test('the shallowest overhang anywhere clears the threshold', () => {
  const deg = shallowestOverhangDeg(RACK)
  assert.ok(deg >= 30, `shallowest overhang is ${deg.toFixed(1)} degrees`)
})

test('the scan actually catches a coarse tread', () => {
  // Guard against it passing everything. Cutting the 45 degree faces to a
  // 1.2 mm tread and then slicing at 0.2 leaves 1.2 mm steps -- 9.5 degrees --
  // which is the failure that shipped three times.
  const coarse = unsupportedRegions({ ...RACK, layerHeightMm: 1.2 }, 30, 2, 0.2)
  assert.ok(coarse.length > 0, 'a 1.2 mm tread sliced at 0.2 should be flagged')
  // ...and that it is the peaks and flanks, not something incidental.
  assert.ok(coarse.some(o => o.jutMm > 1), `worst jut only ${Math.max(...coarse.map(o => o.jutMm))}`)
})
