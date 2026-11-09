import assert from 'node:assert/strict'
import { test } from 'vitest'
import { evaluateProgram } from '../../csg/evaluate.ts'
import { programFromScene } from '../../csg/fromScene.ts'
import { checkManifold } from '../../geometry/mesh.ts'
import type { PathObject, TextObject } from '../../model/document.ts'
import {
  BASE_MM, DEFAULT_PANEL_STAND_SPEC, HEIGHT_MM, createPanelStands, filletRing, labelRoom, labelSize,
  panelLabel, panelStandLayout, panelStandProblem,
} from './panelStand.ts'

/** A stand-in font: every character 0.6 wide and 0.7 tall per mm of size. */
const measure = (text: string) => ({ widthMm: 0.6 * text.length, heightMm: 0.7 })

const area = (ring: readonly (readonly [number, number])[]) =>
  ring.reduce((sum, [x0, y0], i) => {
    const [x1, y1] = ring[(i + 1) % ring.length]
    return sum + x0 * y1 - x1 * y0
  }, 0) / 2

test('a stand evaluates watertight', async () => {
  const [stand] = createPanelStands({ ...DEFAULT_PANEL_STAND_SPEC, count: 1, label: '' }, null)
  const report = checkManifold(await evaluateProgram(programFromScene([stand])))
  assert.ok(report.ok)
  assert.ok(report.volume > 0)
})

test('the outline winds CCW, the four windows CW, and they sit inside it', () => {
  const [stand] = createPanelStands({ ...DEFAULT_PANEL_STAND_SPEC, count: 1, label: '' }, null) as PathObject[]
  const [outer, ...windows] = stand.rings
  assert.equal(windows.length, 4)
  assert.ok(area(outer) > 0)
  for (const w of windows) {
    assert.ok(area(w) < -50, `window area ${area(w)}`)
    for (const [, y] of w) assert.ok(y > BASE_MM - 1e-6 && y < HEIGHT_MM, `window point at y ${y}`)
  }
})

test('the slot is the panel plus clearance each side, square-bottomed on the base', () => {
  const s = { ...DEFAULT_PANEL_STAND_SPEC, panelMm: 12.7, clearanceMm: 0.25, count: 1, label: '' }
  const [stand] = createPanelStands(s, null) as PathObject[]
  const half = 12.7 / 2 + 0.25
  const floor = stand.rings[0].filter(([x, y]) => Math.abs(y - BASE_MM) < 1e-9 && Math.abs(Math.abs(x) - half) < 1e-9)
  assert.equal(floor.length, 2)
})

test('the label is raised from the top of the stand, centred on the base bar', () => {
  const s = { ...DEFAULT_PANEL_STAND_SPEC, count: 1, label: '12mm' }
  const [stand, label] = createPanelStands(s, measure)
  assert.equal(label.type, 'text')
  const text = label as TextObject
  assert.deepEqual(text.transform.position, [stand.transform.position[0], BASE_MM / 2, s.depthMm])
  assert.equal(text.thicknessMm, s.raiseMm)
  const room = labelRoom(s)
  assert.ok(0.7 * text.sizeMm <= room.heightMm + 1e-9)
  assert.ok(0.6 * 4 * text.sizeMm <= room.widthMm + 1e-9)
})

test('a blank label, or one too long to read, is left off', () => {
  assert.equal(labelSize({ ...DEFAULT_PANEL_STAND_SPEC, label: '  ' }, measure), null)
  assert.equal(labelSize({ ...DEFAULT_PANEL_STAND_SPEC, label: 'x'.repeat(200) }, measure), null)
  assert.equal(createPanelStands({ ...DEFAULT_PANEL_STAND_SPEC, count: 2, label: '' }, measure).length, 2)
  assert.equal(createPanelStands({ ...DEFAULT_PANEL_STAND_SPEC, count: 2 }, measure).length, 4)
})

test('labels read the way the thickness was typed', () => {
  assert.equal(panelLabel(18), '18mm')
  assert.equal(panelLabel(18.5), '18.5mm')
  assert.equal(panelLabel(12.7), '12.7mm')
})

test('fillets keep the winding and stay near the corner they round', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]] as const
  const round = filletRing(square, [2, 2, 2, 2])
  assert.ok(Math.abs(area(round) - (100 - (4 - Math.PI) * 4)) < 0.2)
})

test('rejects what cannot be made', () => {
  assert.equal(panelStandProblem(DEFAULT_PANEL_STAND_SPEC), null)
  assert.match(panelStandProblem({ ...DEFAULT_PANEL_STAND_SPEC, panelMm: 1 }) ?? '', /Panel thickness/)
  assert.match(panelStandProblem({ ...DEFAULT_PANEL_STAND_SPEC, count: 0 }) ?? '', /between 1/)
  assert.match(panelStandProblem({ ...DEFAULT_PANEL_STAND_SPEC, raiseMm: 0 }) ?? '', /Label height/)
  assert.equal(panelStandProblem({ ...DEFAULT_PANEL_STAND_SPEC, raiseMm: 0, label: '' }), null)
})

test('stands nest in pairs, the second turned, so four 18 mm fit a 256 mm plate', () => {
  const layout = panelStandLayout(DEFAULT_PANEL_STAND_SPEC, 256)
  const [x, y] = layout.footprintMm
  assert.ok(x <= 256 && y <= 256, `${x} × ${y}`)
  assert.deepEqual(layout.stands.map(p => p.flipped), [false, true, false, true])
})

test('a pair too wide for the plate goes one to a row', () => {
  const layout = panelStandLayout({ ...DEFAULT_PANEL_STAND_SPEC, panelMm: 40, count: 2 }, 256)
  assert.ok(layout.stands.every(p => !p.flipped))
  assert.ok(layout.footprintMm[0] <= 256)
})

test('nested stands do not touch', async () => {
  const objects = createPanelStands({ ...DEFAULT_PANEL_STAND_SPEC, count: 2, label: '' }, null)
  const together = checkManifold(await evaluateProgram(programFromScene(objects)))
  const one = checkManifold(await evaluateProgram(programFromScene(objects.slice(0, 1))))
  // Overlapping solids would union into less than twice the one.
  assert.ok(Math.abs(together.volume - 2 * one.volume) < 0.5, `${together.volume} vs ${2 * one.volume}`)
})
