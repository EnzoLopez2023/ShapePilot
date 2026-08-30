// @vitest-environment jsdom
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { checkManifold } from '../geometry/mesh.ts'
import { multiArea, multiBBox, signedArea } from '../geometry/vec.ts'
import { writeBinaryStl } from '../export/stl.ts'
import { writeShaperSvg } from '../export/shaperSvg.ts'
import { writeDxf } from '../export/dxf.ts'
import { circleRing, rectRing } from '../geometry/primitives.ts'
import { translateRing } from '../geometry/vec.ts'
import { evaluateNode } from '../csg/evaluate.ts'
import { importDxf } from './dxf.ts'
import { importStl } from './mesh.ts'
import { importSvg, unitScaleMm } from './svg.ts'
import { formatFromFilename } from './types.ts'

const IDENTITY = { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] } as const

test('formatFromFilename accepts the supported extensions only', () => {
  assert.equal(formatFromFilename('part.STL'), 'stl')
  assert.equal(formatFromFilename('a.b.dxf'), 'dxf')
  assert.equal(formatFromFilename('drawing.svg'), 'svg')
  assert.equal(formatFromFilename('model.3mf'), '3mf')
  assert.equal(formatFromFilename('notes.txt'), null)
  assert.equal(formatFromFilename('noextension'), null)
})

test('an STL we wrote imports back to the same watertight solid', async () => {
  const original = await evaluateNode({
    id: 'b', name: 'B', op: 'box',
    params: { widthMm: 30, depthMm: 20, heightMm: 10 }, transform: IDENTITY,
  })
  const bytes = writeBinaryStl(original, 'round trip')

  const { mesh } = await importStl(bytes)
  const report = checkManifold(mesh)
  assert.ok(report.ok, `re-imported STL is not watertight: ${report.danglingEdges} dangling edges`)
  // STL is a triangle soup, so the importer must weld before this can hold.
  assert.ok(Math.abs(report.volume - 6000) < 1e-3, `volume drifted to ${report.volume}`)
  assert.deepEqual([...mesh.bbox].map(v => Math.round(v)), [-15, -10, 0, 15, 10, 10])
})

test('unitScaleMm reads real-world units off the document', () => {
  assert.equal(unitScaleMm('<svg width="100mm" viewBox="0 0 100 100">'), 1)
  assert.equal(unitScaleMm('<svg width="50mm" viewBox="0 0 100 100">'), 0.5)
  assert.ok(Math.abs(unitScaleMm('<svg width="1in" viewBox="0 0 96 96">') - 25.4 / 96) < 1e-9)
  // No declared width at all falls back to the CSS 96 dpi user unit.
  assert.ok(Math.abs(unitScaleMm('<svg viewBox="0 0 100 100">') - 25.4 / 96) < 1e-9)
  assert.ok(Math.abs(unitScaleMm('<svg width="100%" viewBox="0 0 10 10">') - 25.4 / 96) < 1e-9)
})

test('an SVG we wrote imports back at the same size, right way up', async () => {
  const plate = [[translateRing(rectRing(80, 40), 10, 20)]]
  const svg = writeShaperSvg({
    name: 'Plate', layers: [{ id: 'outline', cutType: 'exterior', polygons: plate }],
  })

  const { regions } = await importSvg(svg)
  assert.equal(regions.length, 1)
  const mp = regions.map(r => r.map(ring => ring.map(([x, y]) => [x, y] as const)))
  assert.ok(Math.abs(multiArea(mp) - 3200) < 0.5, `area drifted to ${multiArea(mp)}`)
  const b = multiBBox(mp)
  assert.ok(Math.abs(b.maxX - b.minX - 80) < 0.01)
  assert.ok(Math.abs(b.maxY - b.minY - 40) < 0.01)
})

test('an SVG hole survives the round trip as a hole, not a second outline', async () => {
  // rectRing origins at its lower-left, circleRing centres on the origin, so
  // the hole has to be moved to the plate's middle to actually be inside it.
  const withHole = [[rectRing(60, 60), [...translateRing(circleRing(10), 30, 30)].reverse()]]
  const svg = writeShaperSvg({
    name: 'Washer', layers: [{ id: 'outline', cutType: 'exterior', polygons: withHole }],
  })

  const { regions } = await importSvg(svg)
  const mp = regions.map(r => r.map(ring => ring.map(([x, y]) => [x, y] as const)))
  assert.equal(regions[0].length, 2, 'expected an outer ring and one hole')
  assert.ok(signedArea(mp[0][0]) > 0, 'outer ring must be CCW')
  assert.ok(signedArea(mp[0][1]) < 0, 'hole must be CW')
  const inscribed = (64 / 2) * 100 * Math.sin((2 * Math.PI) / 64)
  assert.ok(Math.abs(multiArea(mp) - (3600 - inscribed)) < 1, `area was ${multiArea(mp)}`)
})

test('an SVG with only strokes is refused with a useful message', async () => {
  const stroked = '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" viewBox="0 0 10 10">'
    + '<path d="M 0,0 L 10,10" fill="none" stroke="#000"/></svg>'
  await assert.rejects(() => importSvg(stroked), /converted to paths/)
})

test('a DXF we wrote imports back at the same size', async () => {
  const plate = [[translateRing(rectRing(50, 30), 5, 5)]]
  const dxf = writeDxf({
    name: 'Plate', layers: [{ id: 'outline', cutType: 'exterior', polygons: plate }],
  })

  const { regions } = await importDxf(dxf)
  const mp = regions.map(r => r.map(ring => ring.map(([x, y]) => [x, y] as const)))
  assert.ok(Math.abs(multiArea(mp) - 1500) < 0.5, `area drifted to ${multiArea(mp)}`)
  const b = multiBBox(mp)
  // DXF is already y-up, so nothing should have flipped.
  assert.ok(Math.abs(b.minX - 5) < 0.01 && Math.abs(b.minY - 5) < 0.01)
})

test('DXF chains loose LINE entities into one closed ring', async () => {
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    `0\nLINE\n8\n0\n10\n${x1}\n20\n${y1}\n11\n${x2}\n21\n${y2}\n`
  // Deliberately out of order and with one segment reversed: the chainer has to
  // match endpoints, not trust the file's ordering.
  const dxf = '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n'
    + '0\nSECTION\n2\nENTITIES\n'
    + line(0, 0, 10, 0) + line(10, 10, 0, 10) + line(0, 10, 0, 0) + line(10, 0, 10, 10)
    + '0\nENDSEC\n0\nEOF\n'

  const { regions } = await importDxf(dxf)
  assert.equal(regions.length, 1)
  const mp = regions.map(r => r.map(ring => ring.map(([x, y]) => [x, y] as const)))
  assert.ok(Math.abs(multiArea(mp) - 100) < 0.01, `area was ${multiArea(mp)}`)
})

test('DXF honours $INSUNITS when the file is in inches', async () => {
  const dxf = '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n1\n0\nENDSEC\n'
    + '0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n8\n0\n10\n0\n20\n0\n40\n1\n0\nENDSEC\n0\nEOF\n'
  const { regions } = await importDxf(dxf)
  const mp = regions.map(r => r.map(ring => ring.map(([x, y]) => [x, y] as const)))
  const b = multiBBox(mp)
  // A 1 inch radius circle is 50.8 mm across.
  assert.ok(Math.abs(b.maxX - b.minX - 50.8) < 0.1, `diameter was ${b.maxX - b.minX}`)
})

test('an unclosed DXF run is dropped rather than closed for us', async () => {
  const dxf = '0\nSECTION\n2\nENTITIES\n'
    + '0\nLINE\n8\n0\n10\n0\n20\n0\n11\n10\n21\n0\n'
    + '0\nLINE\n8\n0\n10\n10\n20\n0\n11\n10\n21\n10\n'
    + '0\nENDSEC\n0\nEOF\n'
  await assert.rejects(() => importDxf(dxf), /no closed outlines/)
})
