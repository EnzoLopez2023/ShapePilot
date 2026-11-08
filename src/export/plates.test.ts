import assert from 'node:assert/strict'
import { test } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { rectRing } from '../geometry/primitives.ts'
import { meshFromBands } from '../geometry/bands.ts'
import { PLATE_GAP_MM, PLATE_MARGIN_MM, fillPlates, packPlates } from './plates.ts'
import { plateOrigin, writeThreeMfPlates } from './threemf.ts'

const BED = 256
const cell = { widthMm: 41.5, depthMm: 41.5 }

test('one-cell bins fill a 256 mm bed five across and five deep', () => {
  const spots = packPlates(Array.from({ length: 26 }, () => cell), BED)
  assert.equal(spots.filter(s => s.plate === 0).length, 25)
  assert.deepEqual(spots[25], { plate: 1, x: PLATE_MARGIN_MM, y: PLATE_MARGIN_MM })
  assert.deepEqual(spots[1], { plate: 0, x: PLATE_MARGIN_MM + 41.5 + PLATE_GAP_MM, y: PLATE_MARGIN_MM })
  for (const s of spots) assert.ok(s.x + 41.5 <= BED - PLATE_MARGIN_MM && s.y + 41.5 <= BED - PLATE_MARGIN_MM)
})

test('nothing overlaps when sizes are mixed', () => {
  const items = [
    { widthMm: 83.5, depthMm: 41.5 }, cell, { widthMm: 125.5, depthMm: 83.5 }, cell, { widthMm: 41.5, depthMm: 83.5 },
  ]
  const spots = packPlates(items, BED)
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (spots[i].plate !== spots[j].plate) continue
      const apart = spots[i].x + items[i].widthMm <= spots[j].x || spots[j].x + items[j].widthMm <= spots[i].x
        || spots[i].y + items[i].depthMm <= spots[j].y || spots[j].y + items[j].depthMm <= spots[i].y
      assert.ok(apart, `${i} and ${j} overlap`)
    }
  }
})

test('a part bigger than the bed is an error, not a silent overhang', () => {
  assert.throws(() => packPlates([{ widthMm: 335.5, depthMm: 41.5 }], BED), /bigger than the 256 mm bed/)
})

test('plates sit a fifth of a bed apart, in Studio’s square-ish grid', () => {
  assert.deepEqual(plateOrigin(0, 1, BED), [0, 0])
  assert.deepEqual(plateOrigin(1, 2, BED), [BED * 1.2, 0])
  assert.deepEqual(plateOrigin(2, 3, BED), [0, -BED * 1.2])
  assert.deepEqual(plateOrigin(3, 4, BED), [BED * 1.2, -BED * 1.2])
})

test('the 3MF lists every object on its plate, and parts stay together', () => {
  const slab = (w: number) => meshFromBands([{ z0: 0, z1: 2, region: [[rectRing(w, w)]] }])
  const objects = Array.from({ length: 26 }, (_, i) => ({
    name: `bin ${i}`,
    parts: i === 0
      ? [{ mesh: slab(40), name: 'bin 0 body' }, { mesh: slab(10), name: 'bin 0 label', extruder: 2 }]
      : [{ mesh: slab(40), name: `bin ${i}` }],
  }))
  const { placed, plates } = fillPlates(objects, BED)
  assert.equal(plates, 2)
  const files = unzipSync(new Uint8Array(writeThreeMfPlates(placed, 'batch', BED)))
  const settings = strFromU8(files['Metadata/model_settings.config'])
  const model = strFromU8(files['3D/3dmodel.model'])
  assert.equal(settings.match(/<plate>/g)?.length, 2)
  assert.equal(settings.match(/<model_instance>/g)?.length, 26)
  assert.equal(model.match(/<item /g)?.length, 26)
  assert.match(model, /<components><component objectid="1"\/><component objectid="2"\/><\/components>/)
  assert.match(settings, /<part id="2" subtype="normal_part">[\s\S]*?key="extruder" value="2"/)
})
