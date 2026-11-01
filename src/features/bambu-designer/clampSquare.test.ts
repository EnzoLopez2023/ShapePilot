import assert from 'node:assert/strict'
import { test } from 'vitest'
import { evaluateProgram } from '../../csg/evaluate.ts'
import { programFromScene } from '../../csg/fromScene.ts'
import { checkManifold } from '../../geometry/mesh.ts'
import {
  DEFAULT_CLAMP_SQUARE_SPEC, clampSquareColumns, clampSquareProblem, clampSquaresFootprint, createClampSquares,
} from './clampSquare.ts'

test('a clamping square evaluates watertight, to its cells minus the openings and corner notch', async () => {
  const s = { ...DEFAULT_CLAMP_SQUARE_SPEC, count: 1 }
  const report = checkManifold(await evaluateProgram(programFromScene(createClampSquares(s))))
  assert.ok(report.ok)
  // 120 mm, 3 steps, 8 mm bars: six 40 mm cells, five open -- two 32 × 28, two
  // 28 × 24 on the staircase edge, one 28 × 28 in the middle -- and a 6 mm notch.
  const openings = 2 * 32 * 28 + 2 * 28 * 24 + 28 * 28
  const expected = (6 * 40 * 40 - openings - 6 * 6) * s.heightMm
  assert.ok(Math.abs(report.volume - expected) < 0.5, `${report.volume} vs ${expected}`)
})

test('every face a clamp can grab runs parallel to a working edge', () => {
  const [square] = createClampSquares({ ...DEFAULT_CLAMP_SQUARE_SPEC, count: 1 })
  for (const ring of square.rings) {
    ring.forEach(([x, y], i) => {
      const [nx, ny] = ring[(i + 1) % ring.length]
      assert.ok(x === nx || y === ny, `sloped edge from ${x},${y} to ${nx},${ny}`)
    })
  }
  const L = DEFAULT_CLAMP_SQUARE_SPEC.legMm
  const outer = square.rings[0]
  assert.ok(outer.some(([x, y]) => x === L && y === 0))
  assert.ok(outer.some(([x, y]) => x === 0 && y === L))
  // The corner cell is solid: no opening reaches into it.
  const p = L / DEFAULT_CLAMP_SQUARE_SPEC.steps
  for (const opening of square.rings.slice(1)) {
    assert.ok(opening.some(([x, y]) => x >= p / 2 || y >= p / 2) && !opening.every(([x, y]) => x < p && y < p))
  }
  assert.equal(square.rings.length, 1 + 5)
})

test('four 120 mm squares wrap into a 2 × 2 grid that fits the X2D plate', () => {
  const columns = clampSquareColumns(DEFAULT_CLAMP_SQUARE_SPEC, 256)
  assert.equal(columns, 2)
  const squares = createClampSquares(DEFAULT_CLAMP_SQUARE_SPEC, [0, 0, 0], columns)
  assert.equal(squares.length, 4)
  assert.deepEqual(squares.map(s => s.transform.position.slice(0, 2)), [[0, 0], [125, 0], [0, 125], [125, 125]])
  assert.deepEqual(clampSquaresFootprint(DEFAULT_CLAMP_SQUARE_SPEC, columns), [245, 245])
  assert.equal(clampSquareColumns({ ...DEFAULT_CLAMP_SQUARE_SPEC, legMm: 300 }, 256), 1)
})

test('a square too small for a clamp to reach through is refused', () => {
  assert.equal(clampSquareProblem(DEFAULT_CLAMP_SQUARE_SPEC), null)
  assert.match(clampSquareProblem({ ...DEFAULT_CLAMP_SQUARE_SPEC, legMm: 100 }) ?? '', /at least 108 mm/)
  assert.match(clampSquareProblem({ ...DEFAULT_CLAMP_SQUARE_SPEC, reliefMm: 32 }) ?? '', /relief/)
  assert.match(clampSquareProblem({ ...DEFAULT_CLAMP_SQUARE_SPEC, steps: 6 }) ?? '', /between 2 and 5/)
  assert.match(clampSquareProblem({ ...DEFAULT_CLAMP_SQUARE_SPEC, count: 9 }) ?? '', /between 1 and 8/)
})
