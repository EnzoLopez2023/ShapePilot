import assert from 'node:assert/strict'
import { test } from 'vitest'
import { checkManifold } from '../geometry/mesh.ts'
import { SKADIS } from '../geometry/skadis.ts'
import { BAMBU_X2D } from '../model/machines.ts'
import { CALIPER_HOLDER, buildCaliperHolder, checkConfig, derive } from './holder.ts'

test('the shipped holder is sound and closed', () => {
  assert.deepEqual(checkConfig(CALIPER_HOLDER), [])
  const report = checkManifold(buildCaliperHolder())
  assert.ok(report.ok, `${report.danglingEdges} dangling edges`)
})

test('it prints standing on its top face, prongs rising from the bed', () => {
  const mesh = buildCaliperHolder()
  const [x0, y0, z0, x1, y1, z1] = mesh.bbox
  assert.ok(Math.abs(z0) < 1e-4)
  assert.equal(Math.round((z1 - z0) * 10) / 10, CALIPER_HOLDER.blockHeightMm)
  assert.ok(y0 >= -1e-4)
  const plate = [...BAMBU_X2D.buildMm].sort((a, b) => b - a)
  const dims = [x1 - x0, y1 - y0, z1 - z0].sort((a, b) => b - a)
  dims.forEach((v, i) => assert.ok(v <= plate[i]!))
})

test('the beam passes the slot and the prongs fit the board', () => {
  const d = derive(CALIPER_HOLDER)
  assert.ok(d.slotWidthMm > CALIPER_HOLDER.beamWidthMm)
  assert.ok(d.slotDepthMm > CALIPER_HOLDER.beamThicknessMm)
  assert.ok(d.prongWidthMm < SKADIS.slotWidthMm)
  assert.equal(d.prongCentresMm[1] - d.prongCentresMm[0], SKADIS.columnPitchMm)
})

test('a body too thick for the block is refused', () => {
  assert.ok(checkConfig({ ...CALIPER_HOLDER, bodyThicknessMm: 19 }).length > 0)
})
