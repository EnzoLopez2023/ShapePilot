import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { checkManifold } from '../geometry/mesh.ts'
import { intersection } from '../geometry/boolean.ts'
import { multiArea } from '../geometry/vec.ts'
import { readBinaryStl, writeBinaryStl } from '../export/stl.ts'
import { BAMBU_X2D } from '../model/machines.ts'
import { checkConfig, derive, RACK } from './config.ts'
import type { MultiPolygon } from '../geometry/vec.ts'
import type { PieceSpec } from './geometry.ts'
import {
  bandVolume, buildPiece, crossSectionAt, frameFor, originShiftFor, pieceList, pieceName,
  backReachMm, bevelYAt, buildCleat, cleatHeightMm, frontLipHeightAt, gableHeight, openingSpanAt,
  seamVee, shelfOpenings, stackLayout,
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
    round([D.halfWidthMm + RACK.bossOutMm + RACK.seamVeeDepthMm, D.middleHeightMm + rail, D.rackDepthMm]))
  assert.deepEqual(size({ kind: 'middle', side: 'right' }),
    // narrower than the left by the glue gap it holds off the centreline
    round([D.halfWidthMm + RACK.bossOutMm - RACK.fitMm, D.middleHeightMm + rail, D.rackDepthMm]))
  // The top cap ends the stack, so it carries no rail.
  assert.deepEqual(size({ kind: 'top', side: 'right' })[1], D.capHeightMm)
})

describe('the centre seam', () => {
  const spec: PieceSpec = { kind: 'middle', side: 'left' }
  const py0 = frameFor(RACK, spec).plateY0
  const py1 = py0 + RACK.shelfMm

  test('the halves never share solid material', () => {
    for (let z = 0.25; z < D.rackDepthMm; z += 0.25) {
      const overlap = multiArea(intersection(
        inRackFrame({ kind: 'middle', side: 'left' }, z),
        inRackFrame({ kind: 'middle', side: 'right' }, z),
      ))
      assert.ok(overlap < 1e-6, `halves interfere by ${overlap.toFixed(4)} mm2 at z=${z}`)
    }
  })

  test('the V is the same shape on both halves, offset by the glue gap', () => {
    const l = seamVee(RACK, D, 'left', py0, py1)
    const r = seamVee(RACK, D, 'right', py0, py1)
    assert.equal(l.length, r.length)
    for (const [i, p] of l.entries()) {
      assert.equal(+(r[i]![0] - p[0]).toFixed(6), RACK.fitMm, `point ${i} x`)
      assert.equal(r[i]![1], p[1], `point ${i} y`)
    }
  })

  test('the tongue is centred in the plate and reaches the full depth', () => {
    const v = seamVee(RACK, D, 'left', py0, py1)
    assert.equal(v[1]![1], (py0 + py1) / 2, 'the apex is not on the plate centreline')
    assert.equal(+(v[1]![0] - v[0]![0]).toFixed(6), RACK.seamVeeDepthMm)
    // Constant along the depth is the whole point: it is what costs no bands.
    const at = (z: number): number =>
      Math.max(...inRackFrame(spec, z).flat(2).map(([x]) => x))
    for (const z of [1, 40, 91, 150, D.rackDepthMm - 1]) {
      assert.equal(+at(z).toFixed(4), +(D.halfWidthMm + RACK.seamVeeDepthMm).toFixed(4),
        `the seam edge moves at z=${z}`)
    }
  })

  test('the V beats a flat butt on bonded area', () => {
    const butt = RACK.shelfMm
    const vee = 2 * Math.hypot(RACK.seamVeeDepthMm, RACK.shelfMm / 2)
    assert.ok(vee > butt * 1.2, `only ${(vee / butt).toFixed(2)}x the glue area`)
  })

  test('the halves cannot slide vertically past each other', () => {
    // The V does this unglued -- the tongue would have to climb out of the
    // groove. It is the direction the flared tabs left free.
    let worst = 0
    for (let z = 1; z < D.rackDepthMm - 1; z += 1) {
      const a = multiArea(intersection(
        inRackFrame({ kind: 'middle', side: 'left' }, z),
        inRackFrame({ kind: 'middle', side: 'right' }, z)
          .map(p => p.map(r => r.map(([x, y]) => [x, y + 0.6] as const))),
      ))
      if (a > worst) worst = a
    }
    assert.ok(worst > 0.05, 'the halves shear vertically -- the V does not locate them')
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

describe('the skeletonised shelf', () => {
  const spec: PieceSpec = { kind: 'middle', side: 'left' }
  const plateY = frameFor(RACK, spec).plateY0 + RACK.shelfMm / 2
  /**
   * Width of shelf material across the half at depth `z`, stopping at the seam
   * so a tab reaching past it is not counted as shelf.
   */
  const shelfWidthAt = (z: number): number => {
    const h = 0.02, x1 = D.halfWidthMm
    const strip: MultiPolygon = [[[[-20, plateY - h], [x1, plateY - h], [x1, plateY], [-20, plateY]]]]
    return multiArea(intersection(inRackFrame(spec, z), strip)) / h
  }

  test('an opening never reaches the lips, the wall or the seam joint', () => {
    for (const side of ['left', 'right'] as const) {
      for (const o of shelfOpenings(RACK, { kind: 'middle', side })) {
        assert.ok(o.z0 >= RACK.backLipDepthMm, 'opening runs under the back stop')
        assert.ok(o.z1 <= D.rackDepthMm - RACK.frontLipDepthMm, 'opening runs under the front lip')
        assert.ok(o.x0 >= RACK.wallMm, 'opening undercuts the wall')
        assert.ok(o.x1 <= D.rackWidthMm - RACK.wallMm, 'opening undercuts the wall')
        // The tab and its mating cavity both live inside the seam frame.
        const toSeam = side === 'left' ? D.halfWidthMm - o.x1 : o.x0 - D.halfWidthMm
        assert.ok(toSeam >= RACK.seamVeeDepthMm + RACK.fitMm,
          `opening comes within ${toSeam.toFixed(1)} mm of the seam, inside the joint`)
      }
    }
  })

  test('no opening ever has to bridge: every top closes to a peak', () => {
    // The shelf is a vertical wall in the print, so a flat-topped opening is a
    // horizontal roof and fills with tree supports. This is the check that it
    // closes gradually instead -- one layer of tread per layer of rise.
    for (const o of shelfOpenings(RACK, spec)) {
      const peak = gableHeight(o)
      let widest = 0
      // The last slice that still has an opening: whatever is open there is
      // what the next layer has to span unaided.
      for (let z = o.z1 - RACK.layerHeightMm + 1e-6; z < o.z1; z += RACK.layerHeightMm / 8) {
        const span = openingSpanAt(o, z)
        if (span) widest = Math.max(widest, span[1] - span[0])
      }
      assert.ok(widest <= 2 * RACK.layerHeightMm + 1e-6,
        `opening still ${widest.toFixed(2)} mm wide at its top -- that is a bridge`)
      assert.ok(Math.abs(peak - (o.x1 - o.x0) / 2) < 1e-9, 'the peak is not at 45 degrees')
    }
  })

  test('the peak insets exactly one layer per layer, which slices as 45 degrees', () => {
    const o = shelfOpenings(RACK, spec)[0]!
    const L = RACK.layerHeightMm
    const a = openingSpanAt(o, o.z1 - gableHeight(o) + 2 * L)
    const b = openingSpanAt(o, o.z1 - gableHeight(o) + 3 * L)
    assert.ok(a && b)
    const insetPerLayer = ((a![1] - a![0]) - (b![1] - b![0])) / 2
    assert.ok(Math.abs(insetPerLayer - L) < 1e-6,
      `insets ${insetPerLayer.toFixed(3)} mm per layer, want ${L} -- a slicer would call this ` +
      `${(Math.atan2(L, insetPerLayer) * 180 / Math.PI).toFixed(1)} degrees`)
  })

  test('the shelf still runs wall to seam at a rib', () => {
    const os = shelfOpenings(RACK, spec)
    const zs = [...new Set(os.map(o => o.z1))].sort((a, b) => a - b)
    const rib = zs[0]! + RACK.shelfRibMm / 2      // between the first two rows
    assert.ok(Math.abs(shelfWidthAt(rib) - D.halfWidthMm) < 0.05,
      `shelf is ${shelfWidthAt(rib).toFixed(1)} mm at a rib, expected the full ${D.halfWidthMm}`)
  })

  test('the frames survive at both ends of the depth', () => {
    for (const z of [1, D.rackDepthMm - 1]) {
      assert.ok(Math.abs(shelfWidthAt(z) - D.halfWidthMm) < 0.05, `shelf is cut at z=${z}`)
    }
  })

  test('an opening actually removes material', () => {
    const o = shelfOpenings(RACK, spec)[0]!
    const inside = shelfWidthAt((o.z0 + o.z1) / 2)
    assert.ok(inside < D.halfWidthMm - 20, `expected a cut, got ${inside.toFixed(1)} mm of material`)
  })

  test('skeletonising is lighter and still watertight', () => {
    const solid = buildPiece({ ...RACK, skeletonShelf: false }, spec)
    const skel = buildPiece(RACK, spec)
    const vs = checkManifold(solid.mesh).volume, vk = checkManifold(skel.mesh).volume
    assert.ok(vk < vs * 0.9, `only saved ${(100 * (1 - vk / vs)).toFixed(1)}%`)
    assert.equal(checkManifold(skel.mesh).danglingEdges, 0)
    assert.ok(Math.abs(bandVolume(skel.bands) - vk) / vk < 1e-6)
  })
})

describe('the front lip', () => {
  const L = RACK.layerHeightMm

  test('never rises more than one layer per layer', () => {
    // A square lip appeared all at once, sliced as 4.6 degrees, and pulled a
    // tree support up from the bed.
    let prev = 0
    for (let z = D.rackDepthMm - RACK.frontLipDepthMm - L; z <= D.rackDepthMm; z += L) {
      const h = frontLipHeightAt(RACK, D, +z.toFixed(4))
      assert.ok(h - prev <= L + 1e-9,
        `lip jumps ${(h - prev).toFixed(2)} mm at z=${z.toFixed(1)} -- ` +
        `${(Math.atan2(L, h - prev) * 180 / Math.PI).toFixed(1)} degrees`)
      prev = h
    }
  })

  test('is symmetric, so it inserts as well as it retains', () => {
    const mid = D.rackDepthMm - RACK.frontLipDepthMm / 2
    for (let off = 0.1; off < RACK.frontLipDepthMm / 2; off += 0.1) {
      assert.equal(
        frontLipHeightAt(RACK, D, +(mid - off).toFixed(4)),
        frontLipHeightAt(RACK, D, +(mid + off).toFixed(4)),
        `flanks differ ${off.toFixed(1)} mm from the peak`,
      )
    }
  })

  test('still stands proud enough to retain, and low enough to lift over', () => {
    const mid = D.rackDepthMm - RACK.frontLipDepthMm / 2
    const peak = frontLipHeightAt(RACK, D, mid)
    assert.ok(peak >= RACK.frontLipHeightMm - L, `peak is only ${peak.toFixed(2)} mm`)
    assert.ok(peak < RACK.clearTopMm, 'the case could not be lifted over it')
  })

  test('a lip too tall for its band is rejected', () => {
    assert.ok(checkConfig({ ...RACK, frontLipHeightMm: 4 })
      .some(m => m.includes('too\n      abruptly'.replace(/\s+/g, ' ')) || m.includes('abruptly')))
  })
})

describe('the french cleat', () => {
  test('the bevel rises away from the wall, so the rack is pulled in', () => {
    // Get this backwards and the rack walks itself off the wall.
    const atWall = bevelYAt(RACK, -RACK.cleatThicknessMm)
    const atFace = bevelYAt(RACK, 0)
    assert.ok(atFace > atWall, 'the bearing plane falls away from the wall')
    // One tread of drop per tread of depth is 45 degrees; the staircase means
    // the ends are half a tread in from the true plane.
    const rise = (bevelYAt(RACK, -2 * RACK.cleatTreadMm) - bevelYAt(RACK, -3 * RACK.cleatTreadMm))
    assert.equal(+rise.toFixed(6), RACK.cleatTreadMm, 'not 45 degrees')
  })

  test('only the caps reach behind the back face', () => {
    assert.equal(backReachMm(RACK, { kind: 'middle', side: 'left' }), 0)
    assert.equal(backReachMm(RACK, { kind: 'top', side: 'left' }), RACK.cleatThicknessMm)
    assert.equal(backReachMm(RACK, { kind: 'bottom', side: 'left' }), RACK.cleatThicknessMm)
  })

  test('the hook only ever loses material going up the print', () => {
    // Its underside IS the bearing plane, so it rises with z. That is the whole
    // reason neither part needs support -- material ends, never appears.
    const spec: PieceSpec = { kind: 'top', side: 'left' }
    const lowest = (z: number): number => {
      const mp = crossSectionAt(RACK, spec, z)
      return Math.min(...mp.flat(2).map(([, y]) => y))
    }
    let prev = -Infinity
    for (let z = -RACK.cleatThicknessMm + 0.01; z < -0.01; z += 0.25) {
      const y = lowest(z)
      assert.ok(y >= prev - 1e-6, `the hook's underside drops at z=${z.toFixed(2)} -- an overhang`)
      prev = y
    }
  })

  test('the strip clears the hook by exactly the fit, all the way along', () => {
    const cleat = buildCleat(RACK, 'left')
    const top = RACK.cleatBevelTopMm, Hs = cleatHeightMm(RACK)
    for (const band of cleat.bands) {
      const u = (band.z0 + band.z1) / 2
      const stripTop = Math.max(...band.region.flat(2).map(([, y]) => y))
      // Put the strip in the rack's frame: its base sits Hs below the high point.
      const inRack = stripTop + (top - Hs)
      const hookUnder = bevelYAt(RACK, -u)
      assert.ok(Math.abs((hookUnder - inRack) - RACK.fitMm) < 1e-6,
        `gap is ${(hookUnder - inRack).toFixed(3)} at u=${u.toFixed(2)}, want ${RACK.fitMm}`)
    }
  })

  test('the strip loses height going back, so it prints without support', () => {
    const cleat = buildCleat(RACK, 'left')
    let prev = Infinity
    for (const band of cleat.bands) {
      const top = Math.max(...band.region.flat(2).map(([, y]) => y))
      assert.ok(top <= prev + 1e-6, 'the strip gains height going back -- an overhang')
      prev = top
    }
  })

  test('both strips are watertight and fit the plate', () => {
    for (const side of ['left', 'right'] as const) {
      const mesh = buildCleat(RACK, side).mesh
      const r = checkManifold(mesh)
      assert.equal(r.danglingEdges, 0, `cleat_${side} leaks`)
      assert.ok(r.volume > 0)
      const [x0, y0, z0, x1, y1, z1] = mesh.bbox
      const [bx, by, bz] = BAMBU_X2D.buildMm
      assert.ok(x1 - x0 <= bx - PLATE_MARGIN_MM && y1 - y0 <= by - PLATE_MARGIN_MM && z1 - z0 <= bz)
    }
  })

  test('the two strips peg together', () => {
    const l = buildCleat(RACK, 'left').mesh.bbox
    const r = buildCleat(RACK, 'right').mesh.bbox
    assert.ok(l[3] - l[0] > r[3] - r[0], 'the left strip should carry the peg')
    assert.equal(+((l[3] - l[0]) - (r[3] - r[0])).toFixed(3), RACK.cleatPegMm)
  })

  test('a bevel taller than the top cap is rejected', () => {
    assert.ok(checkConfig({ ...RACK, cleatBevelTopMm: 60 }).some(m => m.includes('no piece to hang')))
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
  test('a shelf with no room between its frames is rejected', () => {
    // The coupon shrinks the case far enough to hit this, which is how it was
    // found -- the validator refused to build it rather than emitting a shelf
    // with silently empty openings.
    const issues = checkConfig({ ...RACK, caseWidthMm: 60 })
    assert.ok(issues.some(m => m.includes('nothing left to open up')), issues.join('; '))
  })

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
