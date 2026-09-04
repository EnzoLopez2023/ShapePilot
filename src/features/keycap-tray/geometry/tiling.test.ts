import assert from 'node:assert/strict'
import { test } from 'vitest'
import { planTiles, needsTiling } from './tiling.ts'
import { PYTHON_SIZING } from './shapes.ts'
import type { Pocket, TrayDesign } from '../model/types.ts'

let seq = 0
const pk = (units: number, x: number, y: number, extra: Partial<Pocket> = {}): Pocket =>
  ({ id: `p${seq++}`, units, x, y, ...extra })

const design = (widthMm: number, heightMm: number, pockets: Pocket[] = []): TrayDesign => ({
  id: 't', name: 't',
  profile: { kind: 'rect', widthMm, heightMm },
  sizing: { ...PYTHON_SIZING },
  floorThicknessMm: 2.4, pocketDepthMm: 10, engraveDepthMm: 0.4,
  pockets, revision: 0,
})

const X2D = { plateWidthMm: 256, plateDepthMm: 256 }

test('a tray inside the plate needs no tiling', () => {
  assert.equal(needsTiling(design(240, 150), X2D), false)
  const plan = planTiles(design(240, 150), X2D)
  assert.deepEqual([plan.cols, plan.rows], [1, 1])
  assert.equal(plan.cutsX.length, 0)
  assert.equal(plan.cells.length, 1)
})

test('a wide full-board tray splits into two columns', () => {
  const plan = planTiles(design(450, 156), X2D) // ~104-key tray
  assert.deepEqual([plan.cols, plan.rows], [2, 1])
  assert.equal(plan.cutsX.length, 1)
  assert.equal(plan.cells.length, 2)
  // Each piece fits the usable plate (256 - 2*5 margin).
  for (const c of plan.cells) assert.ok(c.maxX - c.minX <= 246 + 1e-6)
})

test('a cut is nudged into the clear gap between pocket columns', () => {
  // Ideal cut for a 480 mm tray is x=240. Two pocket blocks leave a lane at
  // x ~= 227..250, so the cut should move into it and split no pocket.
  const pockets: Pocket[] = []
  for (let c = 0; c < 11; c++) for (let r = 0; r < 6; r++) pockets.push(pk(1, 6 + c * 20.6, 6 + r * 20.6))
  for (let c = 0; c < 11; c++) for (let r = 0; r < 6; r++) pockets.push(pk(1, 250 + c * 20.6, 6 + r * 20.6))
  const plan = planTiles(design(480, 140, pockets), X2D)
  assert.equal(plan.cols, 2)
  const [cut] = plan.cutsX
  assert.ok(cut > 227 && cut < 250, `cut ${cut} should land in the empty lane`)
  assert.equal(plan.cutsThroughPockets, false)
})

test('a solid pocket field with no gap reports that a cut goes through pockets', () => {
  const pockets: Pocket[] = []
  for (let c = 0; c < 25; c++) for (let r = 0; r < 6; r++) pockets.push(pk(1, 6 + c * 19.05, 6 + r * 20.6))
  const plan = planTiles(design(480, 140, pockets), X2D)
  assert.equal(plan.cols, 2)
  assert.equal(plan.cutsThroughPockets, true)
})

test('a huge tray tiles on both axes', () => {
  const plan = planTiles(design(600, 520), X2D)
  assert.deepEqual([plan.cols, plan.rows], [3, 3])
  assert.equal(plan.cells.length, 9)
})
