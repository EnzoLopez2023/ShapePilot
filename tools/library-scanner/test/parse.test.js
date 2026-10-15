import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readStl, shapePilotName } from '../src/stl.js'
import { readThreeMf } from '../src/threemf.js'
import { boundingBox, geometryHash, volume } from '../src/mesh.js'
import { renderThumbnail } from '../src/render.js'
import { asciiStl, bambuThreeMf, binaryStl, cubeTris } from './helpers.js'

test('binary and ASCII STL parse to the same geometry', () => {
  const tris = cubeTris(10)
  const bin = readStl(binaryStl(tris, 'H: Keycap Tray'))
  const asc = readStl(asciiStl(tris))
  assert.equal(bin.format, 'binary')
  assert.equal(asc.format, 'ascii')
  assert.equal(bin.tris.length, 108)
  assert.equal(geometryHash(bin.tris), geometryHash(asc.tris))
  assert.deepEqual(boundingBox(bin.tris).size, [10, 10, 10])
  assert.equal(volume(bin.tris), 1000)
  assert.equal(shapePilotName(bin.header), 'Keycap Tray')
  assert.equal(shapePilotName('solid thing'), null)
})

test('geometry hash ignores placement and triangle order but not shape', () => {
  const a = cubeTris(10)
  const moved = cubeTris(10, [55, -20, 3])
  const reordered = Float32Array.from([...a.slice(54), ...a.slice(0, 54)])
  const bigger = cubeTris(11)
  assert.equal(geometryHash(a), geometryHash(moved))
  assert.equal(geometryHash(a), geometryHash(reordered))
  assert.notEqual(geometryHash(a), geometryHash(bigger))
})

test('Bambu 3MF metadata, plates, printer and mesh are read', () => {
  const mf = readThreeMf(bambuThreeMf({ title: 'Drawer Spacers', designer: 'Deltaprints' }))
  assert.equal(mf.metadata.Title, 'Drawer Spacers')
  assert.equal(mf.metadata.Designer, 'Deltaprints')
  assert.equal(mf.metadata.Description, 'Nice & useful')
  assert.equal(mf.printer, 'Bambu Lab X2D')
  assert.equal(mf.nozzle, 0.4)
  assert.deepEqual(mf.filaments, [{ type: 'PLA', color: '#FF0000', profile: null }])
  assert.deepEqual(mf.plates.map((p) => [p.index, p.name, p.objects]), [[1, 'Main', ['cube.stl']]])
  assert.equal(mf.isSliced, false)
  assert.ok(mf.hero?.length)
  // The build item transform is applied, and placement does not change the hash.
  assert.deepEqual(boundingBox(mf.tris).min, [100, 100, 5])
  assert.equal(geometryHash(mf.tris), geometryHash(cubeTris(10)))
})

test('sliced 3MF reports time and grams without inflating G-code', () => {
  const mf = readThreeMf(bambuThreeMf({ sliced: true }))
  assert.equal(mf.isSliced, true)
  assert.equal(mf.seconds, 3600)
  assert.equal(mf.grams, 12.5)
  assert.equal(mf.plates[0].filaments[0].type, 'PLA')
})

test('thumbnail renderer produces a non-blank PNG', () => {
  const png = renderThumbnail(cubeTris(10), { size: 64 })
  assert.equal(png.subarray(1, 4).toString(), 'PNG')
  assert.ok(png.length > 200)
  assert.equal(renderThumbnail(new Float32Array(0)), null)
})
