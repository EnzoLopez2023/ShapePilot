import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { checkManifold } from '../geometry/mesh.ts'
import { intersection } from '../geometry/boolean.ts'
import { multiArea } from '../geometry/vec.ts'
import { readBinaryStl, writeBinaryStl } from '../export/stl.ts'
import { BAMBU_X2D } from '../model/machines.ts'
import { checkConfig, derive, RACK, seamTabCentres } from './config.ts'
import type { MultiPolygon } from '../geometry/vec.ts'
import type { PieceSpec } from './geometry.ts'
import {
  bandVolume, buildPiece, crossSectionAt, frameFor, originShiftFor, pieceList, pieceName,
  stackLayout,
} from './geometry.ts'

const D = derive(RACK)
const PLATE_MARGIN_MM = 5

const cases: [string, PieceSpec][] = pieceList({ ...RACK, bays: 2 })
  .map(spec => [pieceName(spec), spec])

/** Undo the export shift so two pieces sit in the same rack frame. */
const inRackFrame = (spec: PieceSpec, z: number): MultiPolygon => {
  const dx = -originShiftFor(RACK, spec)
  return crossSectionAt(RACK, spec, z).map(p => p.map(r => r.map(([x, y]) => [x + dx, y] as const)))
}

/** Lift a cross-section by `dy`, for putting a stacked course in place. */
const raise = (mp: MultiPolygon, dy: number): MultiPolygon =>
  mp.map(p => p.map(r => r.map(([x, y]) => [x, y + dy] as const)))

describe('every piece', () => {
  for (const [label, spec] of cases) {
    test(`${label} is watertight`, () => {
      const report = checkManifold(buildPiece(RACK, spec).mesh)
      assert.equal(report.danglingEdges, 0, `${report.danglingEdges} dangling half-edges`)
      assert.ok(report.volume > 0, 'inverted or empty')
    })

    test(`${label} volume equals its band areas times their depths`, () => {
      // Independent of the mesh: catches a band derived from the wrong
      // neighbour, which a mesh-vs-mesh check cannot see.
      const piece = buildPiece(RACK, spec)
      const fromBands = bandVolume(piece.bands)
      const fromMesh = checkManifold(piece.mesh).volume
      assert.ok(
        Math.abs(fromBands - fromMesh) / fromMesh < 1e-6,
        `bands ${fromBands.toFixed(3)} vs mesh ${fromMesh.toFixed(3)}`,
      )
    })

    test(`${label} fits the X2D plate`, () => {
      const [x0, y0, z0, x1, y1, z1] = buildPiece(RACK, spec).mesh.bbox
      const got = [x1 - x0, y1 - y0, z1 - z0]
      const [bx, by, bz] = BAMBU_X2D.buildMm
      assert.ok(got[0]! <= bx - PLATE_MARGIN_MM, `width ${got[0]} exceeds the plate`)
      assert.ok(got[1]! <= by - PLATE_MARGIN_MM, `height ${got[1]} exceeds the plate`)
      assert.ok(got[2]! <= bz, `depth ${got[2]} exceeds the build height`)
    })

    test(`${label} sits at its own origin`, () => {
      const [x0, y0, z0] = buildPiece(RACK, spec).mesh.bbox
      assert.deepEqual([x0, y0, z0].map(v => +v.toFixed(6)), [0, 0, 0])
    })
  }
})

test('pieces are the size the stack arithmetic expects', () => {
  const rail = RACK.railHeightMm
  const size = (spec: PieceSpec): number[] => {
    const [x0, y0, z0, x1, y1, z1] = buildPiece(RACK, spec).mesh.bbox
    return [x1 - x0, y1 - y0, z1 - z0].map(v => +v.toFixed(3))
  }
  const round = (v: number[]): number[] => v.map(n => +n.toFixed(3))
  assert.deepEqual(size({ kind: 'middle', side: 'left' }),
    round([D.halfWidthMm + RACK.bossOutMm + RACK.seamTabReachMm, D.middleHeightMm + rail, D.rackDepthMm]))
  assert.deepEqual(size({ kind: 'middle', side: 'right' }),
    round([D.halfWidthMm + RACK.bossOutMm, D.middleHeightMm + rail, D.rackDepthMm]))
  // The top cap ends the stack, so it carries no rail.
  assert.deepEqual(size({ kind: 'top', side: 'right' })[1], D.capHeightMm)
})

describe('the centre seam', () => {
  test('the two halves never share solid material', () => {
    for (let z = 0.25; z < D.rackDepthMm; z += 0.25) {
      const overlap = multiArea(intersection(
        inRackFrame({ kind: 'middle', side: 'left' }, z),
        inRackFrame({ kind: 'middle', side: 'right' }, z),
      ))
      assert.ok(overlap < 1e-6, `halves interfere by ${overlap.toFixed(4)} mm2 at z=${z}`)
    }
  })

  test('a tab crosses the seam and leaves exactly the fit clearance', () => {
    const zc = seamTabCentres(RACK, D)[0]!
    const maxX = (mp: MultiPolygon): number =>
      Math.max(...mp.flat(2).map(([x]) => x))
    const minX = (mp: MultiPolygon): number =>
      Math.min(...mp.flat(2).map(([x]) => x))
    const tabTip = maxX(inRackFrame({ kind: 'middle', side: 'left' }, zc))
    const cavity = minX(inRackFrame({ kind: 'middle', side: 'right' }, zc))
    assert.equal(+tabTip.toFixed(3), D.halfWidthMm + RACK.seamTabReachMm)
    assert.equal(+(cavity - tabTip).toFixed(3), RACK.fitMm)
  })

  test('between tabs the halves butt on the seam line', () => {
    // Midway between the first two tabs there is no tab, so both halves stop
    // dead on the centreline.
    const centres = seamTabCentres(RACK, D)
    const z = (centres[0]! + centres[1]!) / 2
    const left = inRackFrame({ kind: 'middle', side: 'left' }, z)
    assert.equal(+Math.max(...left.flat(2).map(([x]) => x)).toFixed(3), D.halfWidthMm)
  })
})

describe('the course joint', () => {
  test('a tongue enters the socket above it with the fit clearance', () => {
    const lower: PieceSpec = { kind: 'bottom', side: 'left' }
    const upper: PieceSpec = { kind: 'middle', side: 'left' }
    const h = frameFor(RACK, lower).height
    const z = D.rackDepthMm / 2
    const overlap = multiArea(intersection(
      crossSectionAt(RACK, lower, z),
      raise(crossSectionAt(RACK, upper, z), h),
    ))
    assert.ok(overlap < 1e-6, `tongue and socket interfere by ${overlap.toFixed(4)} mm2`)
  })

  test('real material survives beside the socket', () => {
    // Measured off the cross-section, not recomputed from the formula, so the
    // parts and the validator cannot drift apart. The first draft left 0.05 mm
    // here -- an eighth of an extrusion line -- and every other test passed.
    const spec: PieceSpec = { kind: 'middle', side: 'left' }
    const sec = crossSectionAt(RACK, spec, D.rackDepthMm / 2)
    const h = 0.02
    const y = RACK.railHeightMm            // the socket is at its widest here
    const strip: MultiPolygon = [[[[-1, y - h], [12, y - h], [12, y], [-1, y]]]]
    const widthBothSides = multiArea(intersection(sec, strip)) / h
    const perSide = widthBothSides / 2
    assert.ok(
      perSide >= RACK.minSocketWallMm,
      `only ${perSide.toFixed(2)} mm beside the socket, want ${RACK.minSocketWallMm}`,
    )
    assert.ok(Math.abs(perSide - D.socketWallMm) < 0.05,
      `measured ${perSide.toFixed(3)} but derive() says ${D.socketWallMm.toFixed(3)}`)
  })

  test('the tongue leaves a flat shoulder to bear on', () => {
    assert.ok(D.tongueShoulderMm >= RACK.minSocketWallMm)
  })

  test('the socket is an undercut, so the joint resists lifting', () => {
    // Head wider than neck is the whole point: a straight tongue would carry no
    // tension, and the cleat hangs the stack from the top course.
    assert.ok(RACK.railHeadMm > RACK.railNeckMm)
  })
})

describe('the assembled rack', () => {
  test('every bay clears the case by exactly the headroom', () => {
    const layout = stackLayout(RACK)
    assert.equal(layout.bays.length, RACK.bays)
    for (const [i, bay] of layout.bays.entries()) {
      assert.equal(
        +(bay.ceilingY - bay.floorTopY).toFixed(3),
        RACK.caseHeightMm + RACK.clearTopMm,
        `bay ${i} opening`,
      )
    }
  })

  test('total height matches the derived figure', () => {
    assert.equal(+stackLayout(RACK).totalHeightMm.toFixed(3), +D.totalHeightMm.toFixed(3))
  })

  test('the walls leave the case its side clearance', () => {
    const interior = D.rackWidthMm - 2 * RACK.wallMm
    assert.equal(+interior.toFixed(3), RACK.caseWidthMm + 2 * RACK.clearSideMm)
  })
})

describe('config checks', () => {
  test('the shipped config is sound', () => {
    assert.deepEqual(checkConfig(RACK), [])
  })

  test('a front lip taller than the headroom is rejected', () => {
    // The case is lifted over the lip to come out, so the lip must fit under
    // the ceiling. This is the constraint that ties clearTop to the lip.
    const issues = checkConfig({ ...RACK, frontLipHeightMm: RACK.clearTopMm })
    assert.ok(issues.some(m => m.includes('could not be removed')), issues.join('; '))
  })

  test('a rail wider than its boss is rejected', () => {
    assert.ok(checkConfig({ ...RACK, railHeadMm: 99 }).length > 0)
  })
})

test('a piece round-trips through binary STL', () => {
  const mesh = buildPiece(RACK, { kind: 'middle', side: 'left' }).mesh
  const parsed = readBinaryStl(writeBinaryStl(mesh, 'rack middle L'))
  assert.equal(parsed.triangleCount, mesh.triangleCount)
})
