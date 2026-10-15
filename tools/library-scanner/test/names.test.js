import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanFilename, cleanStem, groupKey, isModelFile, modelKind, pickTitle, safeComponent } from '../src/names.js'

test('cleans real download names from the library', () => {
  const cases = [
    ['light+weight+skadis+shelf+-++sizes+v5 (4).3mf', 'Light Weight Skadis Shelf - Sizes v5'],
    ["Sketch+N'+Design+-+Ikea+Skadis+Extensions.3mf", "Sketch N' Design - Ikea Skadis Extensions"],
    ['PP_Parallel+Clamp+Glue+Protector.3mf', 'PP Parallel Clamp Glue Protector'],
    ['fema filo V5.step.stl', 'fema filo V5'],
    ['Blank Latch updated v3 9.27.26 (1).stl', 'Blank Latch updated v3 9.27.26'],
    ['Desk_Skadis_Board_200x240_mm_P1S(2).3mf', 'Desk Skadis Board 200x240 mm P1S'],
    ['【双色】耳机架弧形顶面(2).3mf', '【双色】耳机架弧形顶面'],
    ['10mm_rounded_corners_post.stl', '10mm Rounded Corners Post'],
    ['Brilliant Vihelmo (7).stl', 'Brilliant Vihelmo'],
    ['P2S:X2D Screen Protective Cover.3mf', 'P2S-X2D Screen Protective Cover'],
  ]
  for (const [input, expected] of cases) assert.equal(cleanStem(input), expected, input)
})

test('sliced project files keep a clear suffix', () => {
  assert.equal(cleanFilename('light+weight+skadis+shelf+-++sizes+v5.gcode.3mf'), 'Light Weight Skadis Shelf - Sizes v5 (sliced).gcode.3mf')
  assert.equal(modelKind('a.gcode.3mf'), '3mf')
  assert.equal(modelKind('a.STP'), 'step')
})

test('generic names fall back to metadata or part names', () => {
  assert.equal(pickTitle({ filename: 'Untitled_model (9).3mf', metaTitle: 'Drawer Spacers' }), 'Drawer Spacers')
  assert.equal(pickTitle({ filename: '(10).3mf', objectNames: ['hook_v2.stl'] }), 'Hook v2')
  assert.equal(pickTitle({ filename: 'Onami.3mf', metaTitle: 'Untitled' }), 'Onami')
  assert.equal(pickTitle({ filename: 'x.stl', headerName: 'Keycap Tray Big' }), 'Keycap Tray Big')
})

test('copies group with their originals', () => {
  assert.equal(groupKey('Pen(2).3mf'), groupKey('Pen.stl'))
  assert.equal(groupKey('light+weight+skadis+shelf+-++sizes+v5 (4).3mf'), groupKey('light weight skadis shelf - sizes v5.gcode.3mf'))
})

test('path components are safe and bounded', () => {
  assert.equal(safeComponent('a/b:c'), 'a-b-c')
  assert.equal(safeComponent('   '), 'Untitled model')
  assert.ok(safeComponent('x'.repeat(200)).length <= 80)
  assert.equal(isModelFile('._thing.stl'), false)
})

test('download folder noise is dropped from folder titles', async () => {
  const { folderStem } = await import('../src/plan.js')
  assert.equal(folderStem('lancer_stls'), 'Lancer')
  assert.equal(folderStem('Tray+with+clamp+holder_stls'), 'Tray with clamp holder')
  assert.equal(folderStem('X2D+AccessoryBox+GridInfinity_stls'), 'X2D AccessoryBox GridInfinity')
})
