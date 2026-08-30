import assert from 'node:assert/strict'
import { test } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { buildTrayMesh } from '../geometry/layers.ts'
import { checkManifold } from '../../../geometry/mesh.ts'
import { PYTHON_SIZING } from '../geometry/shapes.ts'
import type { Pocket, TrayDesign } from '../model/types.ts'
import { readBinaryStl, writeBinaryStl } from '../../../export/stl.ts'
import { writeThreeMf } from '../../../export/threemf.ts'

const design = (pockets: Pocket[], over: Partial<TrayDesign> = {}): TrayDesign => ({
  id: 't', name: 'Test tray',
  profile: { kind: 'rect', widthMm: 100, heightMm: 80 },
  sizing: { ...PYTHON_SIZING },
  floorThicknessMm: 2.4, pocketDepthMm: 10, engraveDepthMm: 0.4,
  pockets, revision: 0, ...over,
})

const sample = design([
  { id: 'a', units: 1, x: 10, y: 10 },
  { id: 'b', units: 2.25, x: 40, y: 10 },
  { id: 'c', units: 1, x: 10, y: 40, isThrough: true },
])

test('binary STL is exactly 84 + 50n bytes', () => {
  const mesh = buildTrayMesh(sample)
  const buf = writeBinaryStl(mesh)
  assert.equal(buf.byteLength, 84 + 50 * mesh.triangleCount)
})

test('STL header does not start with "solid"', () => {
  const buf = writeBinaryStl(buildTrayMesh(sample))
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, 5))
  assert.notEqual(head, 'solid')
})

test('STL round-trips every triangle vertex', () => {
  const mesh = buildTrayMesh(sample)
  const parsed = readBinaryStl(writeBinaryStl(mesh))
  assert.equal(parsed.triangleCount, mesh.triangleCount)
  for (let t = 0; t < mesh.triangleCount; t++) {
    for (let v = 0; v < 3; v++) {
      const src = mesh.indices[t * 3 + v] * 3
      for (let c = 0; c < 3; c++) {
        assert.ok(Math.abs(parsed.positions[t * 9 + v * 3 + c] - mesh.positions[src + c]) < 1e-3)
      }
    }
  }
})

test('STL normals point outward on the top face', () => {
  const mesh = buildTrayMesh(design([]))
  const buf = writeBinaryStl(mesh)
  const dv = new DataView(buf)
  const n = dv.getUint32(80, true)
  let topFacing = 0, bottomFacing = 0
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50
    const nz = dv.getFloat32(o + 8, true)
    const z = dv.getFloat32(o + 20, true)
    if (z > 12.39 && nz > 0.99) topFacing++
    if (z < 0.01 && nz < -0.99) bottomFacing++
  }
  assert.ok(topFacing > 0, 'top face must have +Z normals')
  assert.ok(bottomFacing > 0, 'bottom face must have -Z normals')
})

test('3MF declares millimetres and matches the mesh', () => {
  const mesh = buildTrayMesh(sample)
  const zip = unzipSync(new Uint8Array(writeThreeMf(mesh)))
  assert.ok(zip['[Content_Types].xml'], 'content types part required')
  assert.ok(zip['_rels/.rels'], 'rels part required')
  const model = strFromU8(zip['3D/3dmodel.model'])
  assert.match(model, /unit="millimeter"/)
  assert.equal((model.match(/<vertex /g) ?? []).length, mesh.positions.length / 3)
  assert.equal((model.match(/<triangle /g) ?? []).length, mesh.triangleCount)
})

// The reference tray: 248 x 156 mm, 75 pockets of 18.80 mm on a 5-row grid.
// Reproduces systainer_tray_1_SHAPER.svg from parameters alone.
function systainerTray(): TrayDesign {
  const pockets: Pocket[] = []
  const pitch = 20.6, cols = 12, rows = 7
  let i = 0
  for (let r = 0; r < rows && i < 75; r++) {
    for (let c = 0; c < cols && i < 75; c++, i++) {
      pockets.push({ id: `p${i}`, units: 1, x: 3.5 + c * pitch, y: 3.5 + r * pitch })
    }
  }
  return design(pockets, { profile: { kind: 'preset', id: 'systainer-s76-plain' } })
}

test('a 75-pocket Systainer tray is watertight and plausibly sized', () => {
  const d = systainerTray()
  assert.equal(d.pockets.length, 75)
  const mesh = buildTrayMesh(d)
  const report = checkManifold(mesh)
  assert.equal(report.danglingEdges, 0)
  assert.ok(report.volume > 0)
  assert.equal(+mesh.bbox[3].toFixed(2), 248)
  assert.equal(+mesh.bbox[4].toFixed(2), 156)
  assert.equal(+mesh.bbox[5].toFixed(2), 12.4)
})
