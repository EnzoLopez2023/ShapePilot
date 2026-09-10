import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import {
  buildRegions, buildToolTrayMesh, levelOf, liftedFloorMm, reliefKeepOuts, resolveLevels,
} from './bands.ts'
import { deepestStepMm, fingerAccessRings, pocketFootprint, stepRings } from './shapes.ts'
import { emptyDesign } from '../model/defaults.ts'
import { PART_PRESETS, getPartPreset } from '../model/partPresets.ts'
import type { PocketStep, ToolPocket, ToolTrayDesign } from '../model/types.ts'
import { checkManifold } from '../../../geometry/mesh.ts'
import type { Polygon } from '../../../geometry/vec.ts'
import { multiArea } from '../../../geometry/vec.ts'
import { intersection, union, unionDisjointFast } from '../../../geometry/boolean.ts'
import { profileToMulti, profileUndersideReliefs } from '../../../model/trayProfile.ts'

let seq = 0
const pocket = (p: Partial<ToolPocket> & { steps: PocketStep[] }): ToolPocket => ({
  id: `p${++seq}`, kind: 'bin', x: 20, y: 20, widthMm: 30, heightMm: 20, ...p,
})

const bin = (
  x: number, y: number, w: number, h: number, depthMm: number | null, extra: Partial<ToolPocket> = {},
): ToolPocket => pocket({
  x, y, widthMm: w, heightMm: h,
  steps: [{ shape: { kind: 'rect', widthMm: w, heightMm: h, cornerRadiusMm: 2 }, depthMm }],
  ...extra,
})

const tray = (pockets: ToolPocket[], over: Partial<ToolTrayDesign> = {}): ToolTrayDesign => ({
  ...emptyDesign(), pockets, undersideReliefs: 'ignore', ...over,
})

const fromPreset = (id: string, x: number, y: number): ToolPocket => {
  const p = getPartPreset(id)
  assert.ok(p, `no preset ${id}`)
  return pocket({
    id: `${id}-${++seq}`, kind: p.kind, presetId: p.id, x, y,
    widthMm: p.widthMm, heightMm: p.heightMm, steps: p.steps,
  })
}

// ---------------------------------------------------------------------------
// The two volume identities. Check 1 is derived from buildRegions' own output,
// so it cannot catch a band-derivation bug; check 2 is independent and is the
// one that would have caught `depthMm` never being read by the mesher.
// ---------------------------------------------------------------------------

/** Sum of every band's area times its height. */
const bandSumVolume = (d: ToolTrayDesign): number =>
  buildRegions(d).bands.reduce((sum, b) => sum + multiArea(b.region) * (b.z1 - b.z0), 0)

/**
 * The negative, built by the COMPLEMENTARY rule to the mesher's.
 *
 * `buildRegions` works downward: start from the profile and successively punch
 * each level's rings out of the band below. This works upward: a step whose
 * floor is at level L removes material at every z above L, so the void at band
 * i is the union of every ring whose level is at or below `levels[i]`. Two
 * different constructions of the same solid, which is what makes this an
 * independent check rather than a restatement -- it is the one that catches a
 * pocket landing in the wrong band, and the one that would have caught
 * `Pocket.depthMm` never being read.
 *
 * Integrated as areas rather than meshed: same number, no second mesh to get
 * wrong. Clipped to the profile, because a pocket may hang off the edge and
 * only the part over the tray removes anything.
 */
function cavityVolume(d: ToolTrayDesign): number {
  const profile = profileToMulti(d.profile)
  const levels = resolveLevels(d)

  // Everything each pocket removes, keyed by the level its floor snaps to --
  // finger access included, since it cuts the tray just as a step does.
  const byLevel = new Map<number, Polygon[]>()
  const add = (z: number, polys: Polygon[]) =>
    byLevel.set(z, [...(byLevel.get(z) ?? []), ...polys])
  for (const p of d.pockets) {
    const deepest = deepestStepMm(p) ?? d.heightMm
    for (const s of p.steps) add(levelOf(s.depthMm, d), stepRings(p, s))
    const fa = p.fingerAccess
    if (fa) add(levelOf(fa.depthMm ?? deepest, d), fingerAccessRings(p, fa))
  }

  let volume = 0
  const accumulated: Polygon[] = []
  for (let i = 0; i + 1 < levels.length; i++) {
    accumulated.push(...(byLevel.get(levels[i]!) ?? []))
    if (!accumulated.length) continue
    const merged = unionDisjointFast(accumulated)
      ?? union(...accumulated.map(poly => [poly]))
    volume += multiArea(intersection(merged, profile)) * (levels[i + 1]! - levels[i]!)
  }
  return volume
}

const CASES: [string, ToolTrayDesign][] = (() => {
  const notched = { kind: 'preset' as const, id: 'systainer-s76-notched' as const }
  const plain = { kind: 'rect' as const, widthMm: 200, heightMm: 140 }
  return [
    ['an empty tray', tray([])],
    ['one bin', tray([bin(30, 30, 40, 30, 10)])],
    ['two bins at the same depth', tray([bin(20, 20, 40, 30, 10), bin(70, 20, 40, 30, 10)])],
    // The case the whole file exists for.
    ['two bins at DIFFERENT depths sharing a web', tray([
      bin(20, 20, 40, 30, 8), bin(64, 20, 40, 30, 19),
    ])],
    ['three depths nested in one tray', tray([
      bin(20, 20, 40, 30, 6), bin(64, 20, 40, 30, 12), bin(108, 20, 40, 30, 19),
    ])],
    ['a through-cut beside a blind pocket', tray([
      bin(20, 20, 30, 30, null), bin(58, 20, 30, 30, 11),
    ])],
    ['seven distinct depths, as the reference kit has', tray([
      bin(20, 20, 20, 20, 8), bin(45, 20, 20, 20, 9), bin(70, 20, 20, 20, 11),
      bin(95, 20, 20, 20, 12), bin(120, 20, 20, 20, 13), bin(145, 20, 20, 20, 17),
      bin(170, 20, 20, 20, 19),
    ], { profile: plain })],
    ['a pocket rotated 37 degrees', tray([bin(60, 50, 40, 24, 12, { rotationDeg: 37 })])],
    ['a mirrored, flipped, rotated tiered pocket', tray([
      { ...fromPreset('bambu-hotend', 60, 40), rotationDeg: 23, mirrorX: true, flipY: true },
    ], { profile: notched })],
    ['the hotend preset, three depths in one pocket', tray([
      fromPreset('bambu-hotend', 40, 40),
    ], { profile: notched })],
    ['an L-shaped channel', tray([pocket({
      x: 30, y: 30, widthMm: 80, heightMm: 40, kind: 'channel',
      steps: [{ shape: { kind: 'channel', path: [[2, 36], [76, 36], [76, 6]], widthMm: 4 }, depthMm: 9 }],
    })], { profile: plain })],
    ['a channel that doubles back on itself', tray([pocket({
      x: 30, y: 30, widthMm: 90, heightMm: 40, kind: 'channel',
      steps: [{
        shape: { kind: 'channel', path: [[4, 10], [80, 10], [80, 30], [8, 30], [8, 20]], widthMm: 5 },
        depthMm: 10,
      }],
    })], { profile: plain })],
    ['an ellipse and a hexagon pocket', tray([
      pocket({ x: 30, y: 30, widthMm: 40, heightMm: 24,
        steps: [{ shape: { kind: 'ellipse', rxMm: 20, ryMm: 12 }, depthMm: 9 }] }),
      pocket({ x: 90, y: 30, widthMm: 30, heightMm: 30,
        steps: [{ shape: { kind: 'polygon', sides: 6, radiusMm: 15 }, depthMm: 14 }] }),
    ], { profile: plain })],
    ['finger access breaching the pocket wall', tray([
      bin(40, 40, 40, 30, 14, { fingerAccess: { style: 'scallop', side: 'left', widthMm: 14, reachMm: 6 } }),
    ], { profile: plain })],
    ['finger access as a slot, deeper than the pocket floor', tray([
      bin(40, 40, 40, 30, 10, {
        fingerAccess: { style: 'slot', side: 'bottom', widthMm: 12, reachMm: 5, depthMm: 15 },
      }),
    ], { profile: plain })],
    ['every part preset in one tray', tray(
      PART_PRESETS.map((p, i) => fromPreset(p.id, 6 + (i % 2) * 130, 6 + Math.floor(i / 2) * 76)),
      { profile: { kind: 'rect', widthMm: 280, heightMm: 320 } },
    )],
    ['feet under a tray', tray([bin(40, 40, 40, 30, 12)], {
      profile: notched, feet: { heightMm: 6, sizeMm: 10, pattern: 'corners' },
    })],
    ['feet at every corner and edge', tray([bin(40, 40, 40, 30, 12)], {
      profile: notched, feet: { heightMm: 6, sizeMm: 10, pattern: 'corners+edges' },
    })],
  ]
})()

describe('multi-band extrusion', () => {
  for (const [name, design] of CASES) {
    test(`${name} makes a watertight solid`, () => {
      const report = checkManifold(buildToolTrayMesh(design))
      assert.equal(report.danglingEdges, 0, `${report.danglingEdges} dangling edges`)
      // Even an empty tray has volume -- it is a solid slab of the outline.
      assert.ok(report.volume > 0)
    })
  }

  for (const [name, design] of CASES) {
    test(`${name} holds the volume its bands say it does`, () => {
      // Feet are welded on after the bands, so compare without them.
      const mesh = buildToolTrayMesh(design, { omitSeparateParts: true })
      const got = checkManifold(mesh).volume
      const want = bandSumVolume(design)
      assert.ok(Math.abs(got - want) / Math.max(want, 1) < 1e-4,
        `band sum ${want.toFixed(4)} vs mesh ${got.toFixed(4)}`)
    })
  }

  for (const [name, design] of CASES) {
    test(`${name} plus its cavities makes an uncut blank`, () => {
      const tray_ = checkManifold(buildToolTrayMesh(design, { omitSeparateParts: true })).volume
      const cavities = cavityVolume(design)
      const blank = multiArea(profileToMulti(design.profile)) * design.heightMm
      assert.ok(Math.abs(tray_ + cavities - blank) / blank < 1e-4,
        `tray ${tray_.toFixed(3)} + cavities ${cavities.toFixed(3)} != blank ${blank.toFixed(3)}`)
    })
  }
})

describe('the band structure itself', () => {
  test('bands are contiguous, ascending, and start at zero', () => {
    for (const [, d] of CASES) {
      const { bands, levels } = buildRegions(d)
      assert.equal(levels.length, bands.length + 1)
      if (!bands.length) continue
      assert.equal(bands[0]!.z0, 0)
      assert.equal(bands[bands.length - 1]!.z1, d.heightMm)
      for (let i = 0; i + 1 < bands.length; i++) {
        assert.equal(bands[i]!.z1, bands[i + 1]!.z0)
        assert.ok(bands[i]!.z1 > bands[i]!.z0)
      }
    }
  })

  test('with no underside relief every band is no wider than the one below', () => {
    for (const [name, d] of CASES) {
      const { bands } = buildRegions(d)
      for (let i = 1; i < bands.length; i++) {
        assert.ok(multiArea(bands[i]!.region) <= multiArea(bands[i - 1]!.region) + 1e-9,
          `${name}: band ${i} grew`)
      }
    }
  })

  test('every level is a whole number of layers', () => {
    for (const [name, d] of CASES) {
      for (const z of buildRegions(d).levels) {
        const layers = z / d.layerHeightMm
        assert.ok(Math.abs(layers - Math.round(layers)) < 1e-6, `${name}: level ${z} is not whole layers`)
      }
    }
  })

  test('a floor snaps DOWN, so a pocket is never shallower than asked', () => {
    const d = tray([bin(20, 20, 30, 20, 10.37)], { heightMm: 21, layerHeightMm: 0.2 })
    const level = levelOf(10.37, d)
    assert.ok(level <= 21 - 10.37 + 1e-9, 'snapped floor sits above the requested depth')
    assert.ok(Math.abs(level - 10.6) < 1e-9, `level was ${level}`)
  })

  test('a single global depth degenerates to exactly two bands', () => {
    // Proves the generalisation is a superset of what the keycap tray does.
    const d = tray([bin(20, 20, 40, 30, 10), bin(70, 20, 40, 30, 10)])
    const { bands } = buildRegions(d)
    assert.equal(bands.length, 2)
    const mesh = buildToolTrayMesh(d, { omitSeparateParts: true })
    const { base, top } = { base: bands[0]!.region, top: bands[1]!.region }
    const want = multiArea(base) * bands[0]!.z1 + multiArea(top) * (bands[1]!.z1 - bands[1]!.z0)
    assert.ok(Math.abs(checkManifold(mesh).volume - want) / want < 1e-4)
  })

  test('a through-cut and a blind pocket land in different bands', () => {
    const d = tray([bin(20, 20, 30, 30, null), bin(58, 20, 30, 30, 11)])
    const { bands, levels } = buildRegions(d)
    assert.ok(levels.includes(0))
    // The bottom band already has the through-cut removed, so it is smaller
    // than the profile; the blind pocket only appears higher up.
    assert.ok(multiArea(bands[0]!.region) < multiArea(profileToMulti(d.profile)))
  })

  test('the level count is bounded by the depths actually used, not the pockets', () => {
    const many = Array.from({ length: 12 }, (_, i) => bin(6 + i * 22, 20, 18, 18, 10))
    // Twelve pockets, one depth -> two bands.
    assert.equal(buildRegions(tray(many, {
      profile: { kind: 'rect', widthMm: 300, heightMm: 100 },
    })).bands.length, 2)
  })
})

describe('generating the underside reliefs', () => {
  const mode = (m: 'ignore' | 'avoid' | 'generate'): ToolTrayDesign =>
    tray([bin(60, 70, 40, 30, 12)], { undersideReliefs: m })

  const reliefArea = (): number =>
    profileUndersideReliefs(mode('generate').profile)
      .reduce((sum, r) => sum + multiArea([[r.ring]]), 0)

  test('only generating cuts anything -- ignore and avoid are the same solid', () => {
    const a = checkManifold(buildToolTrayMesh(mode('ignore'), { omitSeparateParts: true })).volume
    const b = checkManifold(buildToolTrayMesh(mode('avoid'), { omitSeparateParts: true })).volume
    assert.ok(Math.abs(a - b) / a < 1e-9, 'avoid is a check, not geometry')
  })

  test('it removes exactly the relief footprint times its height, and no more', () => {
    // The bug this pins: the relief was folded into the pocket chain, which
    // derives each band from the band below, so it propagated through every
    // band above and cut the relief over the tray's whole height -- 21 mm
    // instead of 5, four times too much. The relief is applied per band now.
    const plain = checkManifold(buildToolTrayMesh(mode('ignore'), { omitSeparateParts: true }))
    const cut = checkManifold(buildToolTrayMesh(mode('generate'), { omitSeparateParts: true }))
    const height = Math.max(
      0, ...profileUndersideReliefs(mode('generate').profile).map(r => r.heightMm))
    const want = reliefArea() * height
    const got = plain.volume - cut.volume
    assert.ok(Math.abs(got - want) / want < 1e-4,
      `generate removed ${got.toFixed(2)} mm3, expected ${want.toFixed(2)}`)
  })

  test('it is the only thing that makes a band wider than the one below', () => {
    // Which is what `ceilingsDown` exists for: a downward-facing interior face.
    const plain = buildRegions(mode('ignore'))
    assert.ok(plain.ceilingsDown.every(c => multiArea(c) < 1e-9))

    const cut = buildRegions(mode('generate'))
    const widened = cut.ceilingsDown
      .map((c, i) => (multiArea(c) > 1e-9 ? i : -1)).filter(i => i >= 0)
    assert.equal(widened.length, 1, 'exactly one interface should have a down face')
    // ...and its area is the relief footprint: those are the roofs.
    assert.ok(Math.abs(multiArea(cut.ceilingsDown[widened[0]!]!) - reliefArea()) < 1e-6)
  })

  test('the generated solid is still watertight', () => {
    const report = checkManifold(buildToolTrayMesh(mode('generate')))
    assert.equal(report.danglingEdges, 0)
    assert.ok(report.ok)
  })

  test('an outline with no reliefs is unaffected by the mode', () => {
    const plain = { kind: 'rect' as const, widthMm: 200, heightMm: 140 }
    const a = checkManifold(buildToolTrayMesh(
      { ...mode('ignore'), profile: plain }, { omitSeparateParts: true })).volume
    const b = checkManifold(buildToolTrayMesh(
      { ...mode('generate'), profile: plain }, { omitSeparateParts: true })).volume
    assert.equal(a, b)
  })
})

describe('liftOverKeepOut', () => {
  // The flag was declared, and the VALIDATOR honoured it, while the mesher
  // ignored it -- so setting it silenced the warning and left the hole. These
  // pin that it now changes the solid, not just the message.
  const overRecess = (lift: boolean): ToolTrayDesign => {
    const step: PocketStep = {
      shape: { kind: 'rect', widthMm: 30, heightMm: 20 },
      depthMm: 19,
      ...(lift ? { liftOverKeepOut: true } : {}),
    }
    return tray([pocket({ x: 6, y: 37, widthMm: 30, heightMm: 20, steps: [step] })],
      { undersideReliefs: 'avoid' })
  }

  test('lifting adds a level at the relief roof', () => {
    const plain = resolveLevels(overRecess(false))
    const lifted = resolveLevels(overRecess(true))
    const roof = liftedFloorMm(overRecess(true))
    assert.equal(roof, 6.2, 'a 5 mm relief plus a 1.2 mm roof, on whole layers')
    assert.ok(!plain.includes(roof))
    assert.ok(lifted.includes(roof))
  })

  test('lifting leaves material the unlifted pocket removed, and exactly that much', () => {
    const plain = checkManifold(buildToolTrayMesh(overRecess(false), { omitSeparateParts: true }))
    const lifted = checkManifold(buildToolTrayMesh(overRecess(true), { omitSeparateParts: true }))
    assert.equal(plain.danglingEdges, 0)
    assert.equal(lifted.danglingEdges, 0)

    // The gain is the part of the pocket over a keep-out, times the height the
    // floor was raised through. Computed from the keep-outs and the design
    // rather than from buildRegions, so this is an independent number.
    const d = overRecess(true)
    const ring = unionDisjointFast(stepRings(d.pockets[0]!, d.pockets[0]!.steps[0]!))
      ?? union(...stepRings(d.pockets[0]!, d.pockets[0]!.steps[0]!).map(x => [x]))
    const ko = unionDisjointFast(reliefKeepOuts(d))
      ?? union(...reliefKeepOuts(d).map(x => [x]))
    const over = multiArea(intersection(ring, ko))
    assert.ok(over > 1e-6, 'the fixture is meant to sit over a recess')

    const raised = liftedFloorMm(d) - levelOf(19, d)
    assert.ok(raised > 0)
    const want = over * raised
    const got = lifted.volume - plain.volume
    assert.ok(Math.abs(got - want) / want < 1e-4,
      `lift gained ${got.toFixed(4)} mm3, expected ${want.toFixed(4)}`)
  })

  test('a lifted step keeps its own floor everywhere else', () => {
    // Only the part over a recess moves. Away from one, lifting changes nothing.
    const clear = (lift: boolean): ToolTrayDesign => {
      const step: PocketStep = {
        shape: { kind: 'rect', widthMm: 30, heightMm: 20 },
        depthMm: 19,
        ...(lift ? { liftOverKeepOut: true } : {}),
      }
      return tray([pocket({ x: 100, y: 70, widthMm: 30, heightMm: 20, steps: [step] })],
        { undersideReliefs: 'avoid' })
    }
    const a = checkManifold(buildToolTrayMesh(clear(false), { omitSeparateParts: true })).volume
    const b = checkManifold(buildToolTrayMesh(clear(true), { omitSeparateParts: true })).volume
    assert.ok(Math.abs(a - b) / a < 1e-9, 'a pocket clear of every recess should not move')
  })

  test("'ignore' means the flag does nothing at all", () => {
    const lift = { ...overRecess(true), undersideReliefs: 'ignore' as const }
    const plain = { ...overRecess(false), undersideReliefs: 'ignore' as const }
    assert.deepEqual(resolveLevels(lift), resolveLevels(plain))
  })
})

describe('a tiered pocket turns as one rigid body', () => {
  test('rotating the pocket keeps its steps in register', () => {
    const flat = fromPreset('bambu-hotend', 40, 40)
    const spun = { ...flat, rotationDeg: 90 }
    // Same material removed either way -- rotation cannot change the area.
    const areaOf = (p: ToolPocket) => multiArea(pocketFootprint(p))
    assert.ok(Math.abs(areaOf(flat) - areaOf(spun)) / areaOf(flat) < 1e-6)
  })

  test('a rotated tiered pocket still resolves the same three levels', () => {
    const a = buildRegions(tray([fromPreset('bambu-hotend', 40, 40)]))
    const b = buildRegions(tray([{ ...fromPreset('bambu-hotend', 40, 40), rotationDeg: 41 }]))
    assert.deepEqual(a.levels, b.levels)
  })

  test('the hotend preset really does ask for three different depths', () => {
    const d = tray([fromPreset('bambu-hotend', 40, 40)])
    // 0 and the rim, plus one level per distinct step depth.
    assert.equal(resolveLevels(d).length, 5)
  })
})

describe('randomised layouts', () => {
  test('stay watertight and keep both volume identities', () => {
    // Deterministic LCG, so a failure is reproducible.
    let s = 20260908
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff

    for (let trial = 0; trial < 20; trial++) {
      const n = 1 + Math.floor(rnd() * 5)
      const pockets: ToolPocket[] = []
      for (let i = 0; i < n; i++) {
        const w = 14 + rnd() * 26
        const h = 14 + rnd() * 26
        pockets.push(bin(
          8 + i * 46, 10 + rnd() * 40, w, h,
          rnd() < 0.15 ? null : 4 + rnd() * 15,
          rnd() < 0.4 ? { rotationDeg: rnd() * 360 } : {},
        ))
      }
      const d = tray(pockets, { profile: { kind: 'rect', widthMm: 260, heightMm: 110 } })
      const mesh = buildToolTrayMesh(d, { omitSeparateParts: true })
      const report = checkManifold(mesh)
      assert.equal(report.danglingEdges, 0, `trial ${trial}: dangling edges`)

      const want = bandSumVolume(d)
      assert.ok(Math.abs(report.volume - want) / Math.max(want, 1) < 1e-4,
        `trial ${trial}: band sum ${want.toFixed(3)} vs ${report.volume.toFixed(3)}`)

      const blank = multiArea(profileToMulti(d.profile)) * d.heightMm
      assert.ok(Math.abs(report.volume + cavityVolume(d) - blank) / blank < 1e-4,
        `trial ${trial}: blank identity`)
    }
  })
})

describe('finger access reaches where it says it does', () => {
  const pocketWith = (fa: ToolPocket['fingerAccess']): ToolPocket => ({
    id: 'p', kind: 'bin', x: 100, y: 60, widthMm: 40, heightMm: 30,
    steps: [{ shape: { kind: 'rect', widthMm: 40, heightMm: 30 }, depthMm: 8 }],
    fingerAccess: fa,
  })

  const outward = (pocket: ToolPocket, side: 'left' | 'bottom'): number => {
    const rings = fingerAccessRings(pocket, pocket.fingerAccess!)
    const xs = rings.flatMap(poly => poly[0]!.map(([x]) => x))
    const ys = rings.flatMap(poly => poly[0]!.map(([, y]) => y))
    return side === 'left' ? pocket.x - Math.min(...xs) : pocket.y - Math.min(...ys)
  }

  // `reachMm` is documented as how far the access bites into the web, and used
  // to be ignored entirely by the scallop -- which reached widthMm/2 instead,
  // so making a scoop wider silently made it deeper into the neighbouring web.
  test('a scallop reaches its reach, not half its width', () => {
    const wide = pocketWith({ style: 'scallop', side: 'left', widthMm: 25, reachMm: 8 })
    assert.ok(Math.abs(outward(wide, 'left') - 8) < 0.05)

    // Twice as wide, same reach: the web behind it must not move.
    const wider = pocketWith({ style: 'scallop', side: 'left', widthMm: 50, reachMm: 8 })
    assert.ok(Math.abs(outward(wider, 'left') - 8) < 0.05)
  })

  test('a slot reaches its reach too, so the two styles agree', () => {
    const slot = pocketWith({ style: 'slot', side: 'bottom', widthMm: 30, reachMm: 10 })
    assert.ok(Math.abs(outward(slot, 'bottom') - 10) < 1e-6)
  })

  test('the footprint a web check measures includes the scoop', () => {
    const withAccess = pocketWith({ style: 'scallop', side: 'left', widthMm: 25, reachMm: 8 })
    const without = pocketWith(undefined)
    assert.ok(multiArea(pocketFootprint(withAccess)) > multiArea(pocketFootprint(without)))
  })
})
