import { describe, expect, test } from 'vitest'
import { cornerSeats, edgeMidSeats, findSeats, fitsOn } from './seats.ts'
import { multiArea, multiBBox, translateRing } from './vec.ts'
import { rectRing } from './primitives.ts'
import { difference } from './boolean.ts'
import type { MultiPolygon, Polygon } from './vec.ts'
import { getPreset, profileToMulti } from '../model/trayProfile.ts'

const square = (w: number, h: number, x = 0, y = 0): MultiPolygon =>
  [[translateRing(rectRing(w, h), x, y)]]

const notched = (): MultiPolygon => profileToMulti({ kind: 'preset', id: 'systainer-s76-notched' })

describe('findSeats', () => {
  test('a plain rectangle seats all four corners at the nominal inset', () => {
    const region = square(100, 80)
    const rects = findSeats(region, 6, cornerSeats(multiBBox(region), 6))
    expect(rects).toHaveLength(4)
    // 2 mm in from each bbox corner, untouched by any search.
    const origins = rects.map(r => [Math.min(...r[0].map(p => p[0])), Math.min(...r[0].map(p => p[1]))])
    expect(origins).toEqual(expect.arrayContaining([[2, 2], [92, 2], [92, 72], [2, 72]]))
  })

  test('every seat it returns really sits on solid material', () => {
    const region = notched()
    for (const size of [4, 6, 8, 12]) {
      for (const rect of findSeats(region, size, cornerSeats(multiBBox(region), size))) {
        expect(multiArea(difference([rect], region))).toBeLessThan(1e-6)
      }
    }
  })

  // This is the bug the progressive search exists for: the notched Systainer
  // preset chamfers all four corners, so a single fixed 2 mm inset lands
  // entirely in the chamfer and the tray reports "0/4 posts fit".
  test('the notched preset seats all four corners, which a fixed inset would not', () => {
    const region = notched()
    const bb = multiBBox(region)
    const size = 8

    const fixed = cornerSeats(bb, size).map(seat => {
      const [x, y] = seat(2)
      return [translateRing(rectRing(size, size), x, y)] as Polygon
    })
    expect(fixed.some(rect => !fitsOn(rect, region))).toBe(true)

    expect(findSeats(region, size, cornerSeats(bb, size))).toHaveLength(4)
  })

  test('a seat that never finds material is dropped, not faked', () => {
    // A region far from its own bounding box: the bbox corners are all air.
    const region: MultiPolygon = [
      ...square(6, 6, 0, 0), ...square(6, 6, 194, 194),
    ]
    const bb = multiBBox(region)
    expect(bb.maxX - bb.minX).toBeCloseTo(200)
    const rects = findSeats(region, 20, cornerSeats(bb, 20), { maxMm: 10 })
    expect(rects).toHaveLength(0)
  })

  test('the search gives up at maxMm rather than walking to the centre', () => {
    const region = square(200, 200)
    // A seat forced to start well outside the region only fits once the search
    // has walked past the offset, so a tight maxMm must return nothing.
    const outward = [(inset: number): [number, number] => [-50 + inset, -50 + inset]]
    expect(findSeats(region, 10, outward, { maxMm: 20 })).toHaveLength(0)
    expect(findSeats(region, 10, outward, { maxMm: 60 })).toHaveLength(1)
  })

  test('seats come back in the order they were given', () => {
    const region = square(100, 80)
    const bb = multiBBox(region)
    const rects = findSeats(region, 6, [...cornerSeats(bb, 6), ...edgeMidSeats(bb, 6)])
    expect(rects).toHaveLength(8)
    const first = rects[0]![0]!
    expect(Math.min(...first.map(p => p[0]))).toBeCloseTo(2)
    expect(Math.min(...first.map(p => p[1]))).toBeCloseTo(2)
  })

  test('a zero or negative size seats nothing', () => {
    const region = square(100, 80)
    expect(findSeats(region, 0, cornerSeats(multiBBox(region), 0))).toHaveLength(0)
    expect(findSeats(region, -5, cornerSeats(multiBBox(region), -5))).toHaveLength(0)
  })

  test('a post bigger than the region seats nothing', () => {
    const region = square(20, 20)
    expect(findSeats(region, 40, cornerSeats(multiBBox(region), 40))).toHaveLength(0)
  })
})

describe('edgeMidSeats', () => {
  test('each edge seat stays centred on its side however far in it walks', () => {
    const bb = multiBBox(square(100, 80))
    const [bottom, top, left, right] = edgeMidSeats(bb, 10)
    // The axis it is not walking along does not move with the inset.
    expect(bottom!(2)[0]).toBeCloseTo(bottom!(30)[0])
    expect(top!(2)[0]).toBeCloseTo(top!(30)[0])
    expect(left!(2)[1]).toBeCloseTo(left!(30)[1])
    expect(right!(2)[1]).toBeCloseTo(right!(30)[1])
    // And it is genuinely the middle: 100 wide, 10 post -> origin at 45.
    expect(bottom!(2)[0]).toBeCloseTo(45)
  })
})

describe('the presets this search was written for', () => {
  test('both S76 outlines are non-degenerate, so the corner cases above mean something', () => {
    for (const id of ['systainer-s76-plain', 'systainer-s76-notched'] as const) {
      expect(getPreset(id).ring.length).toBeGreaterThan(3)
    }
  })
})
