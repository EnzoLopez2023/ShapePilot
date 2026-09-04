import assert from 'node:assert/strict'
import { test } from 'vitest'
import { buildRegions, buildTrayMesh, cornerSpacerRects } from './layers.ts'
import { checkManifold } from '../../../geometry/mesh.ts'
import { multiArea } from '../../../geometry/vec.ts'
import { LIBRARY_SIZING, PYTHON_SIZING } from './shapes.ts'
import type { Pocket, TrayDesign } from '../model/types.ts'
import { hydrateDesignSizing } from '../service.ts'

let seq = 0
const pk = (units: number, x: number, y: number, extra: Partial<Pocket> = {}): Pocket =>
  ({ id: `p${seq++}`, units, x, y, ...extra })

const design = (pockets: Pocket[], over: Partial<TrayDesign> = {}): TrayDesign => ({
  id: 'test', name: 'test',
  profile: { kind: 'rect', widthMm: 100, heightMm: 80 },
  sizing: { ...PYTHON_SIZING },
  floorThicknessMm: 2.4, pocketDepthMm: 10, engraveDepthMm: 0.4,
  pockets, revision: 0, ...over,
})

test('an empty stored sizing is hydrated before client geometry', () => {
  const loaded = design([pk(1, 5, 5)], {
    sizing: {} as TrayDesign['sizing'],
  })
  const hydrated = hydrateDesignSizing(loaded)
  assert.deepEqual(hydrated.sizing, PYTHON_SIZING)
  assert.doesNotThrow(() => buildTrayMesh(hydrated))
})

/** Expected solid volume: profile x height, minus each pocket's cavity. */
function expectedVolume(d: TrayDesign): number {
  const r = buildRegions(d)
  const H = d.floorThicknessMm + d.pocketDepthMm
  return multiArea(r.base) * d.floorThicknessMm + multiArea(r.top) * d.pocketDepthMm
    + 0 * H
}

const cases: [string, TrayDesign][] = [
  ['empty tray', design([])],
  ['one pocket', design([pk(1, 10, 10)])],
  ['row of pockets', design(Array.from({ length: 5 }, (_, i) => pk(1, 5 + i * 20, 10)))],
  ['mixed widths', design([pk(1, 5, 5), pk(2.25, 30, 5), pk(6.25, 5, 40)])],
  ['rotated 2u', design([pk(2, 20, 20, { rotationDeg: 90 })])],
  ['pocket hanging off the right edge', design([pk(2, 92, 20)])],
  ['pocket hanging off the corner', design([pk(2, -5, -5)])],
  ['through-cut finger hole', design([pk(1, 40, 40, { isThrough: true })])],
  ['through-cut beside a blind pocket', design([pk(1, 40, 40, { isThrough: true }), pk(1, 60, 40)])],
  ['two pockets sharing an edge', design([pk(1, 10, 10), pk(1, 10 + 18.8, 10)])],
  ['overlapping pockets merge', design([pk(2, 10, 10), pk(2, 20, 10)])],
  ['rounded rect profile', design([pk(1, 20, 20)], {
    profile: { kind: 'rect', widthMm: 100, heightMm: 80, cornerRadiusMm: 6 },
  })],
  ['notched systainer preset', design([pk(1, 20, 20), pk(6.25, 40, 60)], {
    profile: { kind: 'preset', id: 'systainer-s76-notched' },
  })],
  ['iso-enter pocket', design([pk(1.5, 20, 20, { shape: 'iso-enter' })])],
  ['iso-enter beside a rect pocket, sharing a wall',
    design([pk(1.5, 10, 10, { shape: 'iso-enter' }), pk(1, 10 + 28.325, 10)])],
  ['iso-enter hanging off the corner', design([pk(1.5, -5, -5, { shape: 'iso-enter' })])],
  ['freely rotated 2u', design([pk(2, 30, 30, { rotationDeg: 37 })])],
  ['mirrored iso-enter', design([pk(1.5, 20, 20, { shape: 'iso-enter', mirrorX: true })])],
  ['flipped iso-enter', design([pk(1.5, 20, 20, { shape: 'iso-enter', flipY: true })])],
  ['rotated iso-enter', design([pk(1.5, 25, 25, { shape: 'iso-enter', rotationDeg: 22 })])],
]

for (const [name, d] of cases) {
  test(`mesh is watertight: ${name}`, () => {
    const mesh = buildTrayMesh(d)
    const report = checkManifold(mesh)
    assert.equal(report.danglingEdges, 0, `${report.danglingEdges} dangling half-edges`)
    assert.ok(report.volume > 0, `volume must be positive, got ${report.volume}`)
    assert.ok(report.ok)
  })
}

test('volume equals the region areas times their band heights', () => {
  for (const [name, d] of cases) {
    const { volume } = checkManifold(buildTrayMesh(d))
    const expected = expectedVolume(d)
    assert.ok(Math.abs(volume - expected) / Math.max(expected, 1) < 1e-4,
      `${name}: volume ${volume.toFixed(3)} vs expected ${expected.toFixed(3)}`)
  }
})

test('a pocket removes material', () => {
  const empty = checkManifold(buildTrayMesh(design([]))).volume
  const one = checkManifold(buildTrayMesh(design([pk(1, 10, 10)]))).volume
  const cavity = 18.8 * 18.8 - (4 - Math.PI) * 1 // rounded corners, r=1
  assert.ok(Math.abs((empty - one) - cavity * 10) < 1, `removed ${(empty - one).toFixed(2)}`)
})

test('a through-cut removes the full height', () => {
  const empty = checkManifold(buildTrayMesh(design([]))).volume
  const thru = checkManifold(buildTrayMesh(design([pk(1, 10, 10, { isThrough: true })]))).volume
  const cavity = 18.8 * 18.8 - (4 - Math.PI) * 1
  assert.ok(Math.abs((empty - thru) - cavity * 12.4) < 1, `removed ${(empty - thru).toFixed(2)}`)
})

test('mesh bbox matches the tray footprint and height', () => {
  const m = buildTrayMesh(design([pk(1, 10, 10)]))
  assert.deepEqual(m.bbox.map(v => +v.toFixed(3)), [0, 0, 0, 100, 80, 12.4])
})

test('corner spacers add four watertight posts and lift the mesh by their height', () => {
  const plain = design([pk(1, 40, 30)]) // pocket well clear of every corner
  const spaced = { ...plain, cornerSpacers: { heightMm: 7, sizeMm: 10 } }

  assert.equal(cornerSpacerRects(spaced).length, 4)
  const m = buildTrayMesh(spaced)
  const report = checkManifold(m)
  assert.equal(report.danglingEdges, 0)
  // 12.4 mm tray + 7 mm post.
  assert.equal(+m.bbox[5].toFixed(3), 19.4)
  // Footprint is unchanged -- posts sit inside the outline.
  assert.deepEqual(m.bbox.slice(0, 5).map(v => +v.toFixed(3)), [0, 0, 0, 100, 80])
  // More solid than the bare tray: the posts add volume.
  assert.ok(report.volume > checkManifold(buildTrayMesh(plain)).volume)
})

test('a zero-height or zero-size spacer is a no-op', () => {
  const d = design([])
  assert.equal(cornerSpacerRects({ ...d, cornerSpacers: { heightMm: 0, sizeMm: 10 } }).length, 0)
  assert.equal(cornerSpacerRects({ ...d, cornerSpacers: { heightMm: 7, sizeMm: 0 } }).length, 0)
  assert.equal(+buildTrayMesh({ ...d, cornerSpacers: { heightMm: 0, sizeMm: 10 } }).bbox[5].toFixed(3), 12.4)
})

test('a corner pocket drops the post that would overhang it, keeping the rest', () => {
  // A 2u pocket jammed into the bottom-left corner swallows that post's footprint.
  const d = design([pk(2, 2, 2)], { cornerSpacers: { heightMm: 7, sizeMm: 12 } })
  const rects = cornerSpacerRects(d)
  assert.ok(rects.length >= 1 && rects.length < 4, `expected a partial post set, got ${rects.length}`)
  assert.equal(checkManifold(buildTrayMesh(d)).danglingEdges, 0)
})

test('the plain systainer preset is 248 x 156', () => {
  const m = buildTrayMesh(design([], { profile: { kind: 'preset', id: 'systainer-s76-plain' } }))
  assert.equal(+m.bbox[3].toFixed(3), 248)
  assert.equal(+m.bbox[4].toFixed(3), 156)
})

// Regressions found by running the real Shaper reference layout, not by the
// cases above. Both produced a mesh that looked fine and was not watertight.
test('pockets spilling into the notched profile stay watertight', () => {
  // punchDisjointFast used to accept these: each pocket's bounding box is inside
  // the tray's bounding box, while the pocket itself hangs over a notch.
  const d = design(
    [
      { id: 'a', units: 4, x: 6, y: 140.883 },
      { id: 'b', units: 4, x: 84.75, y: 140.883 },
      { id: 'c', units: 4, x: 163.5, y: 140.883 },
    ],
    {
      profile: { kind: 'preset', id: 'systainer-s76-notched' },
      sizing: { ...PYTHON_SIZING, widthOffset: -0.45, height: 18.6, cornerRadius: 2 },
    },
  )
  const r = checkManifold(buildTrayMesh(d))
  assert.equal(r.danglingEdges, 0, `${r.danglingEdges} unpaired edges`)
  assert.ok(r.volume > 0)
})

test('a full justified layout on the notched profile stays watertight', () => {
  // The Shaper Studio reference: six rows of mixed widths, several overhanging
  // the notches. This is what exposed the too-tight T-junction epsilon and the
  // over-broad own-vertex guard.
  const rows = [[4, 4, 4], [1, 11], [1.5, 10], [1.75, 9], [2.25, 9], [3.75, 6.25, 1.25]]
  const sizing = { ...PYTHON_SIZING, widthOffset: -0.45, height: 18.6, cornerRadius: 2 }
  const pockets: Pocket[] = []
  let y = 165.483 - 6 - 18.6
  let i = 0
  for (const row of rows) {
    let x = 6
    for (const u of row) {
      pockets.push({ id: `p${i++}`, units: u, x, y })
      x += 19.05 * u - 0.45 + 3
    }
    y -= 18.6 + 4
  }
  const d = design(pockets, { profile: { kind: 'preset', id: 'systainer-s76-notched' }, sizing })
  assert.equal(d.pockets.length, 14)
  const r = checkManifold(buildTrayMesh(d))
  assert.equal(r.danglingEdges, 0, `${r.danglingEdges} unpaired edges`)
  assert.ok(r.volume > 0)
})

test('randomised layouts stay watertight across profiles and sizings', () => {
  // Deterministic, so any failure is reproducible from the printed trial number.
  // This is what caught the notched-profile containment bug, the too-tight
  // T-junction epsilon, and earcut's collinear pruning -- none of which the
  // hand-written cases above reached.
  const widths = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.75, 3.75, 4, 6.25, 9, 11, 13]
  for (let trial = 1; trial <= 120; trial++) {
    let seed = trial * 2654435761
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const profile: TrayDesign['profile'] =
      trial % 3 === 0 ? { kind: 'preset', id: 'systainer-s76-plain' }
      : trial % 3 === 1 ? { kind: 'preset', id: 'systainer-s76-notched' }
      : { kind: 'rect', widthMm: 120 + rnd() * 160, heightMm: 90 + rnd() * 90,
          cornerRadiusMm: rnd() < 0.5 ? 0 : 6 }
    const pockets: Pocket[] = []
    const n = 1 + Math.floor(rnd() * 20)
    for (let i = 0; i < n; i++) {
      pockets.push({
        id: `r${i}`,
        units: widths[Math.floor(rnd() * widths.length)],
        x: rnd() * 270 - 20,
        y: rnd() * 180 - 20,
        isThrough: rnd() < 0.25,
        // Mirror/flip are exact QUANTUM-safe reflections, so they are packed in
        // with the rest. Free-angle rotation is swept separately (below): many
        // freely-rotated pockets densely interacting can still trip the
        // T-junction pass -- a known limitation, see DESIGN.md.
        rotationDeg: rnd() < 0.25 ? 90 : 0,
        mirrorX: rnd() < 0.15,
        flipY: rnd() < 0.15,
        shape: rnd() < 0.12 ? 'iso-enter' : undefined,
      })
    }
    const d = design(pockets, {
      profile,
      sizing: trial % 2 ? { ...PYTHON_SIZING } : { ...LIBRARY_SIZING },
    })
    const r = checkManifold(buildTrayMesh(d))
    assert.equal(r.danglingEdges, 0, `trial ${trial}: ${r.danglingEdges} unpaired edges`)
    assert.ok(r.volume > 0, `trial ${trial}: volume ${r.volume}`)
  }
})

test('a single freely-rotated pocket stays watertight at every angle', () => {
  for (let deg = 0; deg < 180; deg += 5) {
    for (const spot of [{ x: 60, y: 45 }, { x: 92, y: 20 }, { x: -4, y: -4 }]) {
      for (const shape of [undefined, 'iso-enter' as const]) {
        const d = design([pk(shape ? 1.5 : 2, spot.x, spot.y, {
          rotationDeg: deg, shape, mirrorX: deg % 15 === 0, flipY: deg % 20 === 0,
        })])
        const r = checkManifold(buildTrayMesh(d))
        assert.equal(r.danglingEdges, 0, `${deg}deg @ ${spot.x},${spot.y} ${shape ?? 'rect'}`)
        assert.ok(r.volume > 0)
      }
    }
  }
})
