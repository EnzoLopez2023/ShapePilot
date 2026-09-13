// @vitest-environment jsdom
//
// The export path end to end: a file with a hole in it has to arrive at Origin
// as a hole. Two places could quietly fill it -- `compileObject`, if it treated
// an object's rings as islands, and the per-layer `union` here, which welds an
// island to whatever it sits on and cannot be undone downstream.
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { importSvg } from '../../import/svg.ts'
import { writeShaperSvg } from '../../export/shaperSvg.ts'
import { circleRing, rectRing } from '../../geometry/primitives.ts'
import { multiArea, signedArea, translateRing } from '../../geometry/vec.ts'
import type { Ring, Vec2 } from '../../geometry/vec.ts'
import { IDENTITY_TRANSFORM, createShape2D, emptyDocument } from '../../model/scene.ts'
import type { DesignDocument, PathObject, SceneObject } from '../../model/document.ts'
import { sceneCutDrawing } from './cutDrawing.ts'

const BORE = (64 / 2) * 100 * Math.sin((2 * Math.PI) / 64)

const docWith = (...objects: SceneObject[]): DesignDocument =>
  ({ ...emptyDocument('shaper', 'washer'), objects })

/** A 60 mm plate with a 20 mm bore, as an SVG a user would import. */
const plateWithBoreSvg = (): string => writeShaperSvg({
  name: 'Plate',
  layers: [{
    id: 'outline',
    cutType: 'exterior',
    polygons: [[rectRing(60, 60), [...translateRing(circleRing(10), 30, 30)].reverse()]],
  }],
})

const asPathObject = (rings: readonly (readonly Vec2[])[]): PathObject => ({
  id: 'imported', name: 'plate.svg', type: 'path', transform: IDENTITY_TRANSFORM,
  mode: 'solid', visible: true, locked: false, thicknessMm: 5,
  rings: rings.map(r => r.map(([x, y]) => [x, y] as const)),
  source: { format: 'svg', filename: 'plate.svg' },
  cut: { type: 'exterior' },
})

/** Subpath windings from an emitted `d`, in the order they were written. */
function subpathWindings(d: string): number[] {
  return d.split('Z').map(s => s.trim()).filter(Boolean).map(sub => {
    const ring: Ring = [...sub.matchAll(/[ML]\s*(-?[\d.]+),(-?[\d.]+)/g)]
      .map(m => [Number(m[1]), Number(m[2])] as Vec2)
    return Math.sign(signedArea(ring))
  })
}

test('an imported SVG hole reaches the cut layer as a hole', async () => {
  const { regions } = await importSvg(plateWithBoreSvg())
  assert.equal(regions.length, 1, 'the importer nests the bore into one region')

  const drawing = sceneCutDrawing(docWith(asPathObject(regions[0])))
  const [layer] = drawing.layers
  assert.equal(layer.polygons.length, 1)
  assert.equal(layer.polygons[0].length, 2, 'the bore must still be a hole ring')
  assert.ok(Math.abs(multiArea(layer.polygons) - (3600 - BORE)) < 0.5)
})

test('a second object on the layer does not let the union fill the bore', async () => {
  // `union` short-circuits on a single geometry, so the clipper only ever sees
  // the bore when something else shares the layer -- the realistic case, and
  // the one where an island silently became 3700 mm2 of solid material.
  const { regions } = await importSvg(plateWithBoreSvg())
  const tag = {
    ...createShape2D('rect', [200, 0, 0], { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 }),
    cut: { type: 'exterior' as const },
  }
  const drawing = sceneCutDrawing(docWith(asPathObject(regions[0]), tag))
  const [layer] = drawing.layers
  assert.ok(Math.abs(multiArea(layer.polygons) - (3600 - BORE + 100)) < 0.5)
})

test('the Shaper SVG writes the bore as an opposite-wound subpath', async () => {
  // Origin fills nonzero: same-wound subpaths in one `d` are both material.
  const { regions } = await importSvg(plateWithBoreSvg())
  const svg = writeShaperSvg(sceneCutDrawing(docWith(asPathObject(regions[0]))))
  const d = /<path d="([^"]+)"/.exec(svg)?.[1]
  assert.ok(d, 'expected one path in the exterior layer')
  const windings = subpathWindings(d)
  assert.equal(windings.length, 2)
  assert.notEqual(windings[0], windings[1], 'the bore must wind against the outline')
})
