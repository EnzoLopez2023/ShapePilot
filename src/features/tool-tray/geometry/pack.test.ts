import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { packParts } from './pack.ts'
import { pocketFootprint } from './shapes.ts'
import { emptyDesign } from '../model/defaults.ts'
import { PART_PRESETS } from '../model/partPresets.ts'
import type { PartPreset } from '../model/partPresets.ts'
import type { ToolPocket, ToolTrayDesign } from '../model/types.ts'
import { profileToMulti } from '../../../model/trayProfile.ts'
import { difference, intersection } from '../../../geometry/boolean.ts'
import { multiArea, multiBBox } from '../../../geometry/vec.ts'

const preset = (id: string): PartPreset => {
  const found = PART_PRESETS.find(p => p.id === id)
  if (!found) throw new Error(`no preset ${id}`)
  return found
}

const withIds = (result: ReturnType<typeof packParts>): ToolPocket[] =>
  result.placed.map((p, i) => ({ ...p, id: `p${i}` }))

const applied = (design: ToolTrayDesign, pockets: ToolPocket[]): ToolTrayDesign =>
  ({ ...design, pockets: [...design.pockets, ...pockets] })

describe('packing a parts list', () => {
  test('everything that fits lands inside the tray', () => {
    const design = emptyDesign()
    const result = packParts(design, [
      { preset: preset('bambu-hotend'), count: 5 },
      { preset: preset('sock-slots'), count: 1 },
      { preset: preset('nozzle-wiper'), count: 1 },
    ])
    assert.equal(result.placed.length, 7)

    const region = profileToMulti(design.profile)
    for (const pocket of withIds(result)) {
      const outside = difference(pocketFootprint(pocket), region)
      assert.ok(multiArea(outside) < 1e-6,
        `${pocket.label} hangs ${multiArea(outside).toFixed(2)} mm² off the tray`)
    }
  })

  test('nothing packed lands on anything else', () => {
    const result = packParts(emptyDesign(), [
      { preset: preset('bambu-hotend'), count: 4 },
      { preset: preset('bambu-lube-tube'), count: 2 },
      { preset: preset('small-parts-bin'), count: 1 },
    ])
    const prints = withIds(result).map(pocketFootprint)
    for (let i = 0; i < prints.length; i++) {
      for (let j = i + 1; j < prints.length; j++) {
        assert.ok(multiArea(intersection(prints[i]!, prints[j]!)) < 1e-6,
          `packed pockets ${i} and ${j} overlap`)
      }
    }
  })

  test('pockets already in the tray are respected, not moved', () => {
    const design = emptyDesign()
    const first = packParts(design, [{ preset: preset('allen-and-rods'), count: 1 }])
    const withOne = applied(design, withIds(first))
    const before = withOne.pockets.map(p => ({ x: p.x, y: p.y }))

    const second = packParts(withOne, [{ preset: preset('bambu-hotend'), count: 3 }])
    assert.equal(withOne.pockets.map(p => ({ x: p.x, y: p.y })).length, before.length)
    assert.deepEqual(withOne.pockets.map(p => ({ x: p.x, y: p.y })), before)

    const prints = [...withOne.pockets, ...withIds(second)].map(pocketFootprint)
    for (let i = 0; i < prints.length; i++) {
      for (let j = i + 1; j < prints.length; j++) {
        assert.ok(multiArea(intersection(prints[i]!, prints[j]!)) < 1e-6)
      }
    }
  })

  // Arrival order is the thing packing exists to beat.
  test('the biggest part goes down first, whatever order it was asked for', () => {
    const result = packParts(emptyDesign(), [
      { preset: preset('nozzle-wiper'), count: 1 },
      { preset: preset('allen-and-rods'), count: 1 },
    ])
    assert.equal(result.placed[0]!.label, preset('allen-and-rods').label)
  })

  test('what will not fit is reported rather than quietly dropped', () => {
    const result = packParts(emptyDesign(), [
      { preset: preset('allen-and-rods'), count: 40 },
    ])
    assert.ok(result.unplaced.length > 0, 'forty channel blocks cannot all fit')
    const total = result.placed.length + result.unplaced[0]!.count
    assert.equal(total, 40, 'every part asked for is either placed or reported')
  })

  test('asking for nothing places nothing', () => {
    assert.deepEqual(packParts(emptyDesign(), []), { placed: [], unplaced: [] })
    assert.deepEqual(
      packParts(emptyDesign(), [{ preset: preset('bambu-hotend'), count: 0 }]).placed, [])
  })
})

describe('the quarter turn', () => {
  // The rotation is about the box CENTRE, so a turned pocket spills outside its
  // own w x h box. If the seat were not corrected for that, a turned part would
  // sit half a box-difference away from where the search cleared -- which is how
  // a packed tray ends up with parts through its wall.
  test('a turned pocket occupies the box the search cleared', () => {
    const design = emptyDesign()
    // Fill the upright orientations out so the packer is forced to turn one.
    const result = packParts(design, [{ preset: preset('long-bay'), count: 12 }])
    const turned = withIds(result).filter(p => p.rotationDeg === 90)
    assert.ok(turned.length > 0, 'expected the packer to turn at least one part')

    const region = profileToMulti(design.profile)
    for (const pocket of turned) {
      const print = pocketFootprint(pocket)
      const box = multiBBox(print)
      // A quarter turn swaps the extents.
      assert.ok(Math.abs((box.maxX - box.minX) - pocket.heightMm) < 1.2,
        `turned width ${(box.maxX - box.minX).toFixed(2)} vs ${pocket.heightMm}`)
      assert.ok(multiArea(difference(print, region)) < 1e-6,
        `${pocket.label} turned off the tray`)
    }

    // The assertion that actually pins the correction. An uncorrected seat
    // leaves the turned body half a box-difference from where the search
    // cleared, which shows up as it sitting on its neighbours -- the extent
    // and on-tray checks above are both satisfied by a wrongly placed pocket.
    const prints = withIds(result).map(pocketFootprint)
    for (let i = 0; i < prints.length; i++) {
      for (let j = i + 1; j < prints.length; j++) {
        assert.ok(multiArea(intersection(prints[i]!, prints[j]!)) < 1e-6,
          `a turned pocket landed on another (${i} and ${j})`)
      }
    }
  })

  test('a part that fits upright is not turned for no reason', () => {
    const result = packParts(emptyDesign(), [{ preset: preset('nozzle-wiper'), count: 1 }])
    assert.equal(result.placed[0]!.rotationDeg, undefined)
  })
})
