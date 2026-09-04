import assert from 'node:assert/strict'
import { test } from 'vitest'
import { rotateDesign180 } from './transform.ts'
import { PYTHON_SIZING } from '../geometry/shapes.ts'
import { profileToMulti } from './presets.ts'
import { multiBBox } from '../../../geometry/vec.ts'
import { buildTrayMesh } from '../geometry/layers.ts'
import { checkManifold } from '../../../geometry/mesh.ts'
import type { Pocket, TrayDesign } from './types.ts'

const design = (over: Partial<TrayDesign> = {}): TrayDesign => ({
  id: 't', name: 't',
  profile: { kind: 'preset', id: 'systainer-s76-notched' },
  sizing: { ...PYTHON_SIZING },
  floorThicknessMm: 2.4, pocketDepthMm: 10, engraveDepthMm: 0.4,
  pockets: [
    { id: 'a', units: 1, x: 8, y: 8 } as Pocket,
    { id: 'b', units: 2.25, x: 40, y: 8, rotationDeg: 15 } as Pocket,
  ],
  revision: 0, ...over,
})

test('rotating twice returns to the original layout', () => {
  const d = design()
  const back = rotateDesign180(rotateDesign180(d))
  for (let i = 0; i < d.pockets.length; i++) {
    assert.ok(Math.abs(back.pockets[i].x - d.pockets[i].x) < 1e-6, 'x restored')
    assert.ok(Math.abs(back.pockets[i].y - d.pockets[i].y) < 1e-6, 'y restored')
    assert.equal((back.pockets[i].rotationDeg ?? 0) % 360, (d.pockets[i].rotationDeg ?? 0) % 360)
  }
})

test('the outline keeps its footprint but turns over (a preset becomes custom)', () => {
  const d = design()
  const before = multiBBox(profileToMulti(d.profile))
  const r = rotateDesign180(d)
  assert.equal(r.profile.kind, 'custom')
  const after = multiBBox(profileToMulti(r.profile))
  assert.ok(Math.abs((after.maxX - after.minX) - (before.maxX - before.minX)) < 1e-6)
  assert.ok(Math.abs((after.maxY - after.minY) - (before.maxY - before.minY)) < 1e-6)
})

test('the notch moves to the opposite edge', () => {
  const d = design()
  const yTop = (mp: ReturnType<typeof profileToMulti>) => {
    const b = multiBBox(mp)
    // fraction of the outline's points that sit in the top 15% of its height
    const ring = mp[0][0]
    const cut = b.maxY - 0.15 * (b.maxY - b.minY)
    return ring.filter(([, y]) => y >= cut).length / ring.length
  }
  const yBot = (mp: ReturnType<typeof profileToMulti>) => {
    const b = multiBBox(mp)
    const ring = mp[0][0]
    const cut = b.minY + 0.15 * (b.maxY - b.minY)
    return ring.filter(([, y]) => y <= cut).length / ring.length
  }
  const before = profileToMulti(d.profile)
  const after = profileToMulti(rotateDesign180(d).profile)
  // Whichever edge had the detail before has the plain edge after, and vice versa.
  assert.ok(Math.abs(yTop(before) - yBot(after)) < 1e-6)
  assert.ok(Math.abs(yBot(before) - yTop(after)) < 1e-6)
})

test('a rectangular profile is left as a rect (it is symmetric under the turn)', () => {
  const d = design({ profile: { kind: 'rect', widthMm: 200, heightMm: 120 } })
  assert.deepEqual(rotateDesign180(d).profile, d.profile)
})

test('the rotated tray still meshes watertight', () => {
  const r = rotateDesign180(design())
  const report = checkManifold(buildTrayMesh(r))
  assert.equal(report.danglingEdges, 0)
  assert.ok(report.volume > 0)
})
