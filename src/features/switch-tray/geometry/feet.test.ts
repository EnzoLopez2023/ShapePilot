import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { cornerRects, feetWanted, seatFeet } from './feet.ts'
import { cellRects, fillRequestFor, planFill } from './fill.ts'
import { cellKeepoutMm, defaultFeet, defaultFill, defaultPlate, emptyDesign } from '../model/defaults.ts'
import { CHOC_V1, MX } from '../model/switches.ts'
import type { PresetProfileId, SwitchProfile, SwitchTrayDesign } from '../model/types.ts'
import { multiBBox, ringBBox } from '../../../geometry/vec.ts'
import { profileToMulti } from '../../../model/trayProfile.ts'

function tray(
  pattern: 'corners' | 'corners+edges',
  id: PresetProfileId = 'systainer-s76-notched',
  sw: SwitchProfile = MX,
): SwitchTrayDesign {
  const plate = defaultPlate('shelf', sw)
  return {
    ...emptyDesign(),
    profile: { kind: 'preset', id },
    switch: { ...sw },
    plate,
    fill: { ...defaultFill(plate, sw), marginMm: 3, spreadEvenly: true },
    feet: { ...defaultFeet(plate, sw), pattern, sizeMm: 10 },
  }
}

const cellsWith = (d: SwitchTrayDesign, feet = seatFeet(d)): number =>
  planFill(fillRequestFor(d, feet)).cells.length

const overlaps = (a: ReturnType<typeof ringBBox>, b: ReturnType<typeof ringBBox>): boolean =>
  a.minX < b.maxX - 1e-9 && a.maxX > b.minX + 1e-9
  && a.minY < b.maxY - 1e-9 && a.maxY > b.minY + 1e-9

describe('corner posts', () => {
  test('all four are seated on both outlines', () => {
    for (const id of ['systainer-s76-plain', 'systainer-s76-notched'] as const) {
      assert.equal(cornerRects(tray('corners', id).profile, tray('corners', id).feet).length, 4)
    }
  })

  test('the notched outline seats them clear of its corner chamfers', () => {
    const d = tray('corners')
    const bb = multiBBox(profileToMulti(d.profile))
    for (const r of cornerRects(d.profile, d.feet)) {
      const b = ringBBox(r[0]!)
      // Pushed in from the bounding box, because the bare corner is chamfered.
      const inFromX = Math.min(b.minX - bb.minX, bb.maxX - b.maxX)
      const inFromY = Math.min(b.minY - bb.minY, bb.maxY - b.maxY)
      assert.ok(inFromX >= 2 - 1e-9 && inFromY >= 2 - 1e-9)
    }
  })

  test('a corners-only tray seats exactly four, whatever the pattern helper says', () => {
    const d = tray('corners')
    assert.equal(seatFeet(d).length, 4)
    assert.equal(feetWanted(d.feet), 4)
  })
})

describe('edge posts cost no switches', () => {
  // The whole point of the change. Seated at the middle of each side they used
  // to land in the cell field and take a switch each -- 112 down to 108.
  test('the notched outline holds as many switches with eight posts as with four', () => {
    const four = tray('corners')
    const eight = tray('corners+edges')
    assert.equal(seatFeet(eight).length, 8)
    assert.equal(cellsWith(eight), cellsWith(four))
  })

  test('at the DEFAULT post size it costs nothing -- which is why the default is 10 mm', () => {
    // The reason `defaultFeet` seats 10 mm rather than 12: the notched
    // outline's free pockets take a 10 mm post with room to spare, so choosing
    // "Corners and edges" on a fresh tray is free. Guarded, so moving the
    // default without re-checking this fails loudly rather than quietly
    // costing a switch.
    const size = defaultFeet(defaultPlate('shelf', MX), MX).sizeMm
    assert.equal(size, 10, 'the default post size moved; re-check what it costs')
    const at = (pattern: 'corners' | 'corners+edges') => {
      const d = tray(pattern)
      return cellsWith({ ...d, feet: { ...d.feet!, sizeMm: size } })
    }
    assert.equal(at('corners+edges'), at('corners'))
  })

  test('a 12 mm post costs at most one switch, not the old four', () => {
    // Kept as the documented limit of the approach. A 12 mm post fits the
    // pockets too, but only just, and seating it perturbs the lattice by a
    // single cell -- the fill counts at the requested pitch and only then
    // spreads, so a post clear of the spread layout can still move the target.
    const at = (pattern: 'corners' | 'corners+edges') => {
      const d = tray(pattern)
      return cellsWith({ ...d, feet: { ...d.feet!, sizeMm: 12 } })
    }
    const lost = at('corners') - at('corners+edges')
    assert.ok(lost >= 0 && lost <= 1, `eight 12 mm posts cost ${lost} switches`)
  })

  test('no post overlaps a planned cell, or the margin that cell needs', () => {
    const d = tray('corners+edges')
    const feet = seatFeet(d)
    const plan = planFill(fillRequestFor(d, feet))
    const claimed = cellKeepoutMm(d.plate, d.switch) + 2 * d.fill.marginMm
    for (const f of feet) {
      for (const c of cellRects(plan, claimed)) {
        assert.ok(!overlaps(ringBBox(f[0]!), ringBBox(c[0]!)),
          `a post at ${JSON.stringify(ringBBox(f[0]!))} fouls a cell`)
      }
    }
  })

  test('the four extra posts go two per LONG edge, not one per side', () => {
    const d = tray('corners+edges')
    const bb = multiBBox(profileToMulti(d.profile))
    const edges = seatFeet(d).slice(4).map(r => ringBBox(r[0]!))
    assert.equal(edges.length, 4)
    // There is nowhere on a short edge for a post that does not cost a cell, so
    // both of each pair sit on the long edges instead.
    const bottom = edges.filter(b => b.minY - bb.minY < 40)
    const top = edges.filter(b => bb.maxY - b.maxY < 40)
    assert.equal(bottom.length, 2)
    assert.equal(top.length, 2)
    // ...and the two on an edge are well apart, not stacked in the middle.
    for (const pair of [bottom, top]) {
      const [a, b] = pair.sort((p, q) => p.minX - q.minX)
      assert.ok(b!.minX - a!.maxX > 40, 'the two posts on an edge crowded together')
    }
  })

  test('a nameplate does not push the posts around -- it is on the other face', () => {
    // The name is an inlay in the top face; the posts weld to the underside.
    const bare = tray('corners+edges')
    const named: SwitchTrayDesign = {
      ...bare,
      nameplate: { style: 'inlay', heightMm: 0, depthMm: 0.6, fontSizeMm: 10, x: 124.5, y: 13 },
    }
    // Passing no reserved box, the two designs must seat identically.
    assert.deepEqual(seatFeet(named), seatFeet(bare))
  })
})

describe('when there is nowhere free', () => {
  test('a plain rectangle still gets all eight posts, by falling back', () => {
    const d = tray('corners+edges', 'systainer-s76-plain')
    assert.equal(seatFeet(d).length, 8)
    assert.equal(feetWanted(d.feet), 8)
  })

  test('the fallback is honest: it costs cells rather than dropping a post', () => {
    const four = tray('corners', 'systainer-s76-plain')
    const eight = tray('corners+edges', 'systainer-s76-plain')
    // A plain outline has no notch pockets and a 3 mm margin, so a 10 mm post
    // has nowhere free to go. Better to seat it and lose a switch than to
    // silently ship a tray with six posts.
    assert.ok(cellsWith(eight) < cellsWith(four))
    assert.equal(seatFeet(eight).length, 8)
  })
})

describe('robustness', () => {
  test('a different switch, with a different keep-out, still seats eight', () => {
    assert.equal(seatFeet(tray('corners+edges', 'systainer-s76-notched', CHOC_V1)).length, 8)
  })

  test('seating is deterministic -- the canvas, mesher and validator must agree', () => {
    const d = tray('corners+edges')
    assert.deepEqual(seatFeet(d), seatFeet(d))
  })

  test('no feet, zero height or zero size seats nothing', () => {
    const d = tray('corners+edges')
    assert.deepEqual(seatFeet({ ...d, feet: undefined }), [])
    assert.deepEqual(seatFeet({ ...d, feet: { ...d.feet!, sizeMm: 0 } }), [])
  })
})
