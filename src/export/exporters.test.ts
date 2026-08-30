import assert from 'node:assert/strict'
import { test } from 'vitest'
import { circleRing, rectRing } from '../geometry/primitives.ts'
import { translateRing } from '../geometry/vec.ts'
import type { CutDrawing } from './cutLayers.ts'
import { CUT_STYLE, writeShaperSvg } from './shaperSvg.ts'
import { DXF_LAYER_FOR, writeDxf } from './dxf.ts'
import type { CutType } from '../model/document.ts'

const square = (w: number, x = 0, y = 0) => [[translateRing(rectRing(w, w), x, y)]]

const drawing: CutDrawing = {
  name: 'Sample',
  layers: [
    { id: 'outline', cutType: 'exterior', polygons: square(100) },
    { id: 'recess', cutType: 'pocket', depthMm: 3.5, polygons: square(20, 10, 10) },
    { id: 'bore', cutType: 'interior', polygons: [[translateRing(circleRing(5), 50, 20)]] },
    { id: 'score', cutType: 'online', polygons: square(10, 50, 50) },
    { id: 'mark', cutType: 'guide', polygons: square(6, 70, 70) },
  ],
}

test('every cut type has a distinct Shaper encoding', () => {
  const types = Object.keys(CUT_STYLE) as CutType[]
  assert.deepEqual(types.sort(), ['exterior', 'guide', 'interior', 'online', 'pocket'])
  const cutTypes = types.map(t => CUT_STYLE[t].cutType)
  assert.equal(new Set(cutTypes).size, types.length, 'cutType attributes must be distinct')
  // The two through cuts use Shaper's own words, which differ from ours.
  assert.equal(CUT_STYLE.exterior.cutType, 'outside')
  assert.equal(CUT_STYLE.interior.cutType, 'inside')
})

test('an on-line cut is a stroke with no fill, so the bit centres on the path', () => {
  assert.equal(CUT_STYLE.online.fill, 'none')
  assert.notEqual(CUT_STYLE.online.stroke, 'none')
  // A pocket is the opposite: filled, because it removes area rather than
  // following a line.
  assert.equal(CUT_STYLE.pocket.stroke, 'none')
  assert.notEqual(CUT_STYLE.pocket.fill, 'none')
})

test('SVG emits one group per layer, in order, with the right cutType', () => {
  const svg = writeShaperSvg(drawing)
  const groups = [...svg.matchAll(/<g id="([^"]+)" shaper:cutType="([^"]+)"/g)]
  assert.deepEqual(groups.map(g => g[1]), ['outline', 'recess', 'bore', 'score', 'mark'])
  assert.deepEqual(groups.map(g => g[2]), ['outside', 'pocket', 'inside', 'online', 'guide'])
})

test('cutDepth is declared on the pocket layer and nowhere else', () => {
  const svg = writeShaperSvg(drawing)
  assert.match(svg, /id="recess" shaper:cutType="pocket" shaper:cutDepth="3.5mm"/)
  assert.equal((svg.match(/shaper:cutDepth/g) ?? []).length, 1)
})

test('SVG is 1:1 in millimetres and spans the drawing', () => {
  const svg = writeShaperSvg(drawing)
  assert.match(svg, /width="100mm" height="100mm" viewBox="0 0 100 100"/)
})

test('SVG bounds span every layer, unlike the DXF extents', () => {
  // A guide mark outside the stock must still be inside the viewBox or it is
  // clipped out of the file. DXF extents are informational, so they stay on the
  // exterior -- see the extents test below.
  const svg = writeShaperSvg({
    name: 'Outlier',
    layers: [
      { id: 'outline', cutType: 'exterior', polygons: square(100) },
      { id: 'far', cutType: 'guide', polygons: square(5, 120, 0) },
    ],
  })
  assert.match(svg, /width="125mm"/)
})

test('SVG escapes markup in the document name', () => {
  const svg = writeShaperSvg({ ...drawing, name: 'a <b> & c' })
  assert.match(svg, /<title>a b {2}c<\/title>/)
})

test('an empty drawing produces a valid, empty SVG rather than NaN dimensions', () => {
  const svg = writeShaperSvg({ name: 'Empty', layers: [] })
  assert.match(svg, /width="0mm" height="0mm"/)
  assert.ok(!svg.includes('NaN'))
})

test('DXF maps every cut type onto a declared layer', () => {
  const dxf = writeDxf(drawing)
  for (const cutType of Object.keys(CUT_STYLE) as CutType[]) {
    const layer = DXF_LAYER_FOR[cutType]
    assert.ok(dxf.includes(`\n2\n${layer}\n`), `layer ${layer} missing from the table`)
  }
  assert.equal((dxf.match(/\nLWPOLYLINE\n/g) ?? []).length, 5)
})

test('DXF extents come from the exterior layer, not a stray guide mark', () => {
  const withOutlier: CutDrawing = {
    name: 'Outlier',
    layers: [
      { id: 'outline', cutType: 'exterior', polygons: square(100) },
      { id: 'far', cutType: 'guide', polygons: square(5, 900, 900) },
    ],
  }
  const dxf = writeDxf(withOutlier)
  assert.match(dxf, /\$EXTMAX\n10\n100\.0000\n20\n100\.0000\n/)
})

test('declaredLayers pins the layer table for a reference file', () => {
  const dxf = writeDxf(drawing, { declaredLayers: ['PROFILE', 'POCKETS'] })
  assert.ok(dxf.includes('\n2\nPROFILE\n'))
  assert.ok(!dxf.includes('\n2\nONLINE\n'), 'undeclared layers must stay out of the table')
})
