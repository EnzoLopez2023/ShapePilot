import assert from 'node:assert/strict'
import { test } from 'vitest'
import { buildTrayMesh } from '../geometry/layers.ts'
import { LIBRARY_SIZING, PYTHON_SIZING } from '../geometry/shapes.ts'
import { checkWallThickness, issuesFor, validateDesign } from '../geometry/validate.ts'
import { DEFAULT_FABRICATION } from '../model/defaults.ts'
import type { Pocket, TrayDesign } from '../model/types.ts'
import { writeShaperSvg } from './svg.ts'
import { writeDxf } from './dxf.ts'

const design = (pockets: Pocket[], over: Partial<TrayDesign> = {}): TrayDesign => ({
  id: 't', name: 'Test tray',
  profile: { kind: 'preset', id: 'systainer-s76-plain' },
  sizing: { ...PYTHON_SIZING },
  floorThicknessMm: 2.4, pocketDepthMm: 10, engraveDepthMm: 0.4,
  pockets, revision: 0, ...over,
})

const sample = design([
  { id: 'a', units: 1, x: 10, y: 10 },
  { id: 'b', units: 6.25, x: 40, y: 10 },
  { id: 'c', units: 1, x: 10, y: 40, isThrough: true },
])

test('SVG declares mm dimensions with a matching 1:1 viewBox', () => {
  const svg = writeShaperSvg(sample)
  assert.match(svg, /width="248mm" height="156mm"/)
  assert.match(svg, /viewBox="0 0 248 156"/)
})

test('SVG carries the shaper namespace and cut types', () => {
  const svg = writeShaperSvg(sample)
  assert.match(svg, /xmlns:shaper="http:\/\/www\.shapertools\.com\/namespaces\/shaper"/)
  assert.match(svg, /id="exterior-profile" shaper:cutType="outside"/)
  assert.match(svg, /id="pockets" shaper:cutType="pocket" shaper:cutDepth="10mm"/)
  assert.match(svg, /id="finger-holes" shaper:cutType="inside"/)
})

test('SVG uses the reference colour convention', () => {
  const svg = writeShaperSvg(sample)
  assert.match(svg, /fill="#FFFFFF" stroke="#000000"/) // profile
  assert.match(svg, /fill="#7F7F7F" stroke="none"/)    // pocket
  assert.match(svg, /fill="#000000" stroke="none"/)    // through
})

test('SVG contains no live text -- Shaper cannot render fonts', () => {
  const svg = writeShaperSvg(sample, { labels: true })
  assert.ok(!/<text[\s>]/.test(svg), 'labels must be path outlines')
})

test('SVG flips y so the model origin lands at the bottom-left', () => {
  // A pocket at model y=10 with height 18.8 spans SVG y = 156-28.8 .. 156-10.
  const svg = writeShaperSvg(design([{ id: 'a', units: 1, x: 10, y: 10 }]))
  const pockets = svg.match(/id="pockets"[\s\S]*?<\/g>/)![0]
  const ys = [...pockets.matchAll(/[ML] [\d.-]+,([\d.-]+)/g)].map(m => parseFloat(m[1]))
  assert.ok(Math.min(...ys) > 127 && Math.max(...ys) < 146.01, `y range ${Math.min(...ys)}..${Math.max(...ys)}`)
})

test('SVG normalizes an offset custom profile and its geometry into the viewBox', () => {
  const svg = writeShaperSvg(design(
    [{ id: 'a', units: 1, x: 0, y: 30 }],
    { profile: { kind: 'custom', rings: [[[[-10, 20], [90, 20], [90, 70], [-10, 70]]]] } },
  ))
  assert.match(svg, /width="100mm" height="50mm" viewBox="0 0 100 50"/)
  const paths = [...svg.matchAll(/[ML] ([\d.-]+),([\d.-]+)/g)]
    .map((match) => [Number(match[1]), Number(match[2])])
  assert.ok(paths.length > 0)
  for (const [x, y] of paths) {
    assert.ok(x >= 0 && x <= 100, `x ${x} is outside the viewBox`)
    assert.ok(y >= 0 && y <= 50, `y ${y} is outside the viewBox`)
  }
})

test('DXF declares millimetres and only LWPOLYLINE on the reference layers', () => {
  const dxf = writeDxf(sample)
  assert.match(dxf, /\$INSUNITS\n\s*70\n4\n/)
  assert.match(dxf, /\$ACADVER\n\s*1\nAC1015\n/)
  for (const layer of ['PROFILE', 'POCKETS', 'THROUGH']) {
    assert.ok(dxf.includes(`\n8\n${layer}\n`), `missing layer ${layer}`)
  }
  assert.ok(!/\nPOLYLINE\n/.test(dxf.replace(/LWPOLYLINE/g, '')), 'only LWPOLYLINE entities')
  const count = (dxf.match(/\nLWPOLYLINE\n/g) ?? []).length
  assert.equal(count, 1 + sample.pockets.length, 'one polyline per profile ring and pocket')
})

test('DXF extents match the tray footprint', () => {
  const dxf = writeDxf(sample)
  assert.match(dxf, /\$EXTMAX\n\s*10\n248\.0000\n\s*20\n156\.0000\n/)
})

test('the 1.00 mm Python radius is rejected for CNC but fine for printing', () => {
  const d = design([{ id: 'a', units: 1, x: 10, y: 10 }])
  const issues = validateDesign(d, DEFAULT_FABRICATION, buildTrayMesh(d))
  const cnc = issuesFor(issues, 'cnc').filter(i => i.code === 'corner-radius-below-tool')
  const print = issuesFor(issues, 'print').filter(i => i.code === 'corner-radius-below-tool')
  assert.equal(cnc.length, 1, 'CNC must flag a 1.00 mm radius against a 1/8" bit')
  assert.equal(cnc[0].severity, 'error')
  assert.equal(print.length, 0, 'printing has no corner-radius limit')
})

test('the 2.00 mm library radius passes CNC', () => {
  const d = design([{ id: 'a', units: 1, x: 10, y: 10 }], { sizing: { ...LIBRARY_SIZING } })
  const issues = validateDesign(d, DEFAULT_FABRICATION, buildTrayMesh(d))
  assert.equal(issuesFor(issues, 'cnc').filter(i => i.code === 'corner-radius-below-tool').length, 0)
})

test('CNC validation uses the radius geometry can actually generate', () => {
  const d = design([{
    id: 'narrow',
    units: 1,
    x: 10,
    y: 10,
    widthMm: 2,
    heightMm: 10,
    cornerRadiusMm: 2,
  }])
  const issues = validateDesign(d, DEFAULT_FABRICATION, buildTrayMesh(d))
  const radius = issues.find(i => i.code === 'corner-radius-below-tool')
  assert.ok(radius)
  assert.deepEqual(radius.pocketIds, ['narrow'])
  assert.match(radius.message, /1 mm corner radius/)
})

test('minimum wall validation includes clearance from the tray rim', () => {
  const d = design([{ id: 'edge', units: 1, x: 0.1, y: 20 }], {
    profile: { kind: 'rect', widthMm: 100, heightMm: 60 },
    sizing: { ...LIBRARY_SIZING },
  })
  const issues = validateDesign(d, DEFAULT_FABRICATION, buildTrayMesh(d))
  const rim = issues.find(i => i.code === 'rim-too-thin')
  assert.ok(rim)
  assert.deepEqual(rim.pocketIds, ['edge'])
  assert.equal(issues.some(i => i.code === 'pocket-outside-profile'), false)
})

test('rim validation stays bounded at accepted profile and pocket limits', () => {
  const boundary = Array.from({ length: 4_000 }, (_, index) => {
    const angle = index / 4_000 * Math.PI * 2
    return [10_000 * Math.cos(angle), 10_000 * Math.sin(angle)] as [number, number]
  })
  const pockets = Array.from({ length: 512 }, (_, index): Pocket => ({
    id: `pocket-${index}`,
    units: 1,
    x: 100,
    y: 100,
  }))
  const d = design(pockets, {
    profile: { kind: 'custom', rings: [[boundary]] },
    sizing: { ...LIBRARY_SIZING },
  })
  assert.deepEqual(checkWallThickness(d, DEFAULT_FABRICATION), [])
})

test('a pocket past the outline is an error', () => {
  const d = design([{ id: 'a', units: 2, x: 240, y: 10 }])
  const issues = validateDesign(d, DEFAULT_FABRICATION, buildTrayMesh(d))
  const o = issues.find(i => i.code === 'pocket-outside-profile')
  assert.ok(o, 'must flag a pocket spilling past the profile')
  assert.equal(o!.severity, 'error')
  assert.deepEqual(o!.pocketIds, ['a'])
})

test('overlapping pockets are flagged', () => {
  const d = design([{ id: 'a', units: 2, x: 10, y: 10 }, { id: 'b', units: 2, x: 20, y: 10 }])
  const issues = validateDesign(d, DEFAULT_FABRICATION, buildTrayMesh(d))
  assert.ok(issues.find(i => i.code === 'pockets-overlap'))
})

test('depth deeper than the stock is a CNC error only', () => {
  const d = design([], { pocketDepthMm: 20 })
  const issues = validateDesign(d, DEFAULT_FABRICATION, buildTrayMesh(d))
  const i = issues.find(x => x.code === 'depth-exceeds-stock')
  assert.ok(i)
  assert.deepEqual(i!.targets, ['cnc'])
})

test('an oversized tray is flagged for the plate but not the CNC', () => {
  const d = design([], { profile: { kind: 'rect', widthMm: 400, heightMm: 300 } })
  const issues = validateDesign(d, DEFAULT_FABRICATION, buildTrayMesh(d))
  const i = issues.find(x => x.code === 'exceeds-plate')
  assert.ok(i)
  assert.deepEqual(i!.targets, ['print'])
})

test('a clean design produces no issues', () => {
  const d = design([
    { id: 'a', units: 1, x: 10, y: 10 },
    { id: 'b', units: 1, x: 40, y: 10 },
  ], { sizing: { ...LIBRARY_SIZING } })
  assert.deepEqual(validateDesign(d, DEFAULT_FABRICATION, buildTrayMesh(d)), [])
})
