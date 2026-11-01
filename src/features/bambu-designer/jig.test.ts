import assert from 'node:assert/strict'
import { test } from 'vitest'
import { evaluateProgram } from '../../csg/evaluate.ts'
import { programFromScene } from '../../csg/fromScene.ts'
import { checkManifold } from '../../geometry/mesh.ts'
import type { JigSpec } from './jig.ts'
import { DEFAULT_JIG_SPEC, JIG_HOLE_MM, createJig, jigHolesFit, jigMinimums, jigName, jigProblem } from './jig.ts'

const evaluate = async (spec: JigSpec) =>
  checkManifold(await evaluateProgram(programFromScene([createJig(spec)])))

/** Floor plus walls, worked out by hand from the slot widths. */
function expectedVolume(spec: JigSpec): number {
  const w = spec.wallMm
  const C = spec.carcassMm + 2 * spec.clearanceMm
  const S = spec.shelfMm + 2 * spec.clearanceMm
  const H = spec.carcassLengthMm
  const X = spec.shelfLengthMm
  const A = 2 * w + C
  const B = 2 * w + S
  const floor = spec.kind === 'tee' ? A * H + (X - A) * B : X * B + A * (H - B)
  // The slots: the side slot full length, the shelf slot from where it leaves it.
  const slots = spec.kind === 'tee' ? C * H + (X - w - C) * S : C * (H - w) + (X - w - C) * S
  const holes = spec.holes && jigHolesFit(spec) ? 2 * Math.PI * (JIG_HOLE_MM / 2) ** 2 : 0
  return (floor - holes) * spec.floorMm + (floor - slots) * spec.depthMm
}

test('T and corner jigs evaluate watertight, to the volume of their floor and walls', async () => {
  for (const kind of ['tee', 'corner'] as const) {
    for (const holes of [false, true]) {
      const spec = { ...DEFAULT_JIG_SPEC, kind, holes }
      const report = await evaluate(spec)
      assert.ok(report.ok, `${kind} left an open mesh`)
      // The holes are 32-gons, a touch smaller than the circle.
      assert.ok(Math.abs(report.volume - expectedVolume(spec)) < 1, `${kind}: ${report.volume} vs ${expectedVolume(spec)}`)
    }
  }
})

test('each slot takes its own panel thickness plus clearance', async () => {
  const spec = { ...DEFAULT_JIG_SPEC, shelfMm: 11.6, carcassMm: 19, clearanceMm: 0.1 }
  for (const kind of ['tee', 'corner'] as const) {
    const walls = createJig({ ...spec, kind }).children[1]
    assert.ok(walls.type === 'path')
    const xs = new Set(walls.rings.flat().map(([x]) => +x.toFixed(3)))
    const ys = new Set(walls.rings.flat().map(([, y]) => +y.toFixed(3)))
    const w = spec.wallMm
    // The side slot runs from the first wall's inner face across 19.2 mm.
    assert.ok(xs.has(w) && xs.has(+(w + 19.2).toFixed(3)), `${kind} side slot`)
    // The shelf slot is 11.8 mm between its two walls.
    const shelfFloor = kind === 'tee' ? (spec.carcassLengthMm - 11.8) / 2 : w
    assert.ok(ys.has(+shelfFloor.toFixed(3)) && ys.has(+(shelfFloor + 11.8).toFixed(3)), `${kind} shelf slot`)
    assert.ok((await evaluate({ ...spec, kind })).ok)
  }
})

test('a jig too short for its slots is refused with the length it needs', () => {
  const min = jigMinimums(DEFAULT_JIG_SPEC)
  assert.equal(jigProblem({ ...DEFAULT_JIG_SPEC, carcassLengthMm: min.carcassLengthMm }), null)
  assert.match(jigProblem({ ...DEFAULT_JIG_SPEC, carcassLengthMm: min.carcassLengthMm - 1 }) ?? '', /side panel/)
  assert.match(jigProblem({ ...DEFAULT_JIG_SPEC, shelfLengthMm: 10 }) ?? '', /along the shelf/)
  assert.match(jigProblem({ ...DEFAULT_JIG_SPEC, shelfMm: 0 }) ?? '', /Shelf thickness/)
  assert.throws(() => createJig({ ...DEFAULT_JIG_SPEC, shelfMm: -1 }))
})

test('holes are left out where the slot floor has no room for them', () => {
  assert.ok(jigHolesFit(DEFAULT_JIG_SPEC))
  const min = jigMinimums(DEFAULT_JIG_SPEC)
  assert.ok(!jigHolesFit({ ...DEFAULT_JIG_SPEC, carcassLengthMm: min.carcassLengthMm }))
  const jig = createJig({ ...DEFAULT_JIG_SPEC, carcassLengthMm: min.carcassLengthMm })
  const floor = jig.children[0]
  assert.ok(floor.type === 'path' && floor.rings.length === 1)
})

test('the name carries both thicknesses, so a drawer of jigs stays sorted', () => {
  assert.equal(jigName({ ...DEFAULT_JIG_SPEC, shelfMm: 11.6, carcassMm: 18.25 }), 'T jig 11.6 / 18.25 mm')
  assert.equal(jigName({ ...DEFAULT_JIG_SPEC, kind: 'corner' }), 'Corner jig 12 / 18 mm')
})
