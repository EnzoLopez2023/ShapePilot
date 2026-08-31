import { describe, expect, test } from 'vitest'
import { allocateSet, troughCapacity } from './allocation.ts'
import type { PocketShape } from './allocation.ts'
import { PYTHON_SIZING } from '../../keycap-tray/geometry/shapes.ts'
import type { SetItem } from './types.ts'

const cap = (units: number, count = 1, over: Partial<SetItem> = {}): SetItem =>
  ({ units, count, ...over })

const pocket = (units: number, over: Partial<PocketShape> = {}): PocketShape =>
  ({ units, heightUnits: 1, shape: null, ...over })

/** The Top tray from the Womier project: ten 1u, and four troughs. */
const TOP_TRAY: PocketShape[] = [
  ...Array.from({ length: 10 }, () => pocket(1)),
  pocket(1.5), pocket(1.75), pocket(2.25),
  pocket(7), pocket(9), pocket(10), pocket(10),
]

describe('troughCapacity', () => {
  test('a long pocket holds as many 1u caps as fit across it', () => {
    expect(troughCapacity(pocket(10), PYTHON_SIZING)).toBe(10)
    expect(troughCapacity(pocket(9), PYTHON_SIZING)).toBe(9)
    expect(troughCapacity(pocket(7), PYTHON_SIZING)).toBe(7)
    expect(troughCapacity(pocket(1), PYTHON_SIZING)).toBe(1)
  })

  test('a fractional pocket holds only whole caps', () => {
    // 2.25u is 42.6 mm and a 1u pocket is 18.8 mm: two caps, not two and a bit.
    expect(troughCapacity(pocket(2.25), PYTHON_SIZING)).toBe(2)
    expect(troughCapacity(pocket(1.75), PYTHON_SIZING)).toBe(1)
  })

  test('an ISO Enter is not a trough', () => {
    // Its footprint is an L; loose caps would not sit in a row.
    expect(troughCapacity(pocket(1.5, { shape: 'iso-enter' }), PYTHON_SIZING)).toBe(0)
  })
})

describe('allocateSet', () => {
  test('a long pocket counts as many 1u caps, not one big cap', () => {
    // The whole point: a 10u pocket is ten homes, not one.
    const result = allocateSet([cap(1, 10)], [pocket(10)], PYTHON_SIZING)
    expect(result.oneUnit).toMatchObject({ owned: 10, slots: 10, placed: 10, left: 0 })
    expect(result.left).toBe(0)
  })

  test('a named cap needs a pocket of its own size, and a trough will not do', () => {
    // A 2.25u Enter has no home in a 10u trough, however much room is in it.
    const result = allocateSet(
      [cap(2.25, 1, { legend: 'Enter' })], [pocket(10)], PYTHON_SIZING)
    expect(result.rows[0]).toMatchObject({ units: 2.25, owned: 1, placed: 0, left: 1 })
    expect(result.left).toBe(1)
    // And the trough is still ten unused 1u slots.
    expect(result.oneUnit.spare).toBe(10)
  })

  test('named caps are matched before troughs are counted', () => {
    // The 2.25u pocket must read as the Enter's home, not as two 1u slots --
    // which is what the person drawing the tray meant by cutting it that size.
    const items = [cap(2.25, 1, { legend: 'Enter' }), cap(1, 4)]
    const result = allocateSet(items, [pocket(2.25), pocket(4)], PYTHON_SIZING)
    expect(result.rows[0]).toMatchObject({ units: 2.25, placed: 1, left: 0 })
    expect(result.oneUnit).toMatchObject({ owned: 4, slots: 4, left: 0 })
  })

  test('a surplus exact-size pocket becomes 1u slots rather than going to waste', () => {
    const items = [cap(2.25, 1, { legend: 'Enter' }), cap(1, 3)]
    const result = allocateSet(items, [pocket(2.25), pocket(2.25)], PYTHON_SIZING)
    expect(result.rows[0].placed).toBe(1)
    // The second 2.25u pocket holds two 1u caps.
    expect(result.oneUnit).toMatchObject({ owned: 3, slots: 2, placed: 2, left: 1 })
  })

  test('the Womier top tray against a full base kit', () => {
    const items: SetItem[] = [
      cap(1, 57),                                   // alphas, numbers, F-keys, arrows
      cap(1.25, 6, { legend: 'Ctrl / Win / Alt' }),
      cap(1.5, 1, { legend: 'Tab' }),
      cap(1.75, 1, { legend: 'Caps Lock' }),
      cap(2, 1, { legend: 'Backspace' }),
      cap(2.25, 2, { legend: 'Enter / Shift' }),
      cap(2.75, 1, { legend: 'Shift' }),
      cap(6.25, 1, { legend: 'Space' }),
    ]
    const result = allocateSet(items, TOP_TRAY, PYTHON_SIZING)

    // Tab and Caps Lock have their pockets; one of the two 2.25u caps does.
    expect(result.rows.find(r => r.units === 1.5)).toMatchObject({ placed: 1, left: 0 })
    expect(result.rows.find(r => r.units === 1.75)).toMatchObject({ placed: 1, left: 0 })
    expect(result.rows.find(r => r.units === 2.25)).toMatchObject({ owned: 2, placed: 1, left: 1 })
    // Nothing on this tray fits a 1.25u, a 2u, a 2.75u or the spacebar yet.
    expect(result.rows.find(r => r.units === 1.25)).toMatchObject({ placed: 0, left: 6 })
    expect(result.rows.find(r => r.units === 6.25)).toMatchObject({ placed: 0, left: 1 })

    // Ten 1u pockets plus the 7u, 9u and two 10u troughs.
    expect(result.oneUnit).toMatchObject({ owned: 57, slots: 46, placed: 46, left: 11 })
    // 11 alphas, 6 modifiers, a Backspace, a Shift, a 2.25u and the spacebar.
    expect(result.left).toBe(21)
  })

  test('pockets from every tray in the project count, not just one', () => {
    const items = [cap(1, 20)]
    const oneTray = allocateSet(items, [pocket(10)], PYTHON_SIZING)
    const both = allocateSet(items, [pocket(10), pocket(10)], PYTHON_SIZING)
    expect(oneTray.left).toBe(10)
    expect(both.left).toBe(0)
  })

  test('height is part of a named cap’s identity', () => {
    // A two-row numpad Enter is not served by a 1u-tall pocket of the same width.
    const items = [cap(2, 1, { heightUnits: 2, legend: 'Enter' })]
    expect(allocateSet(items, [pocket(2)], PYTHON_SIZING).left).toBe(1)
    expect(allocateSet(items, [pocket(2, { heightUnits: 2 })], PYTHON_SIZING).left).toBe(0)
  })

  test('an ISO Enter always gets a pocket of its own', () => {
    const iso = [cap(1.5, 1, { shape: 'iso-enter', legend: 'Enter' })]

    // Not a rectangular pocket of the same width, however much room is in it.
    expect(allocateSet(iso, [pocket(1.5)], PYTHON_SIZING).left).toBe(1)
    expect(allocateSet(iso, [pocket(13)], PYTHON_SIZING).left).toBe(1)
    // Only its own shape will do.
    expect(allocateSet(iso, [pocket(1.5, { shape: 'iso-enter' })], PYTHON_SIZING).left).toBe(0)

    // And the pocket is not a trough either: its footprint is an L, so loose 1u
    // caps would not sit in a row across it.
    const withCaps = allocateSet(
      [cap(1, 4)], [pocket(1.5, { shape: 'iso-enter' })], PYTHON_SIZING)
    expect(withCaps.oneUnit).toMatchObject({ owned: 4, slots: 0, placed: 0, left: 4 })

    // Both together: the Enter is housed and the 1u caps are still homeless.
    const both = allocateSet(
      [...iso, cap(1, 4)], [pocket(1.5, { shape: 'iso-enter' })], PYTHON_SIZING)
    expect(both.rows[0]).toMatchObject({ shape: 'iso-enter', placed: 1, left: 0 })
    expect(both.oneUnit.left).toBe(4)
  })

  test('an empty set and an empty tray are both simply zero', () => {
    expect(allocateSet([], TOP_TRAY, PYTHON_SIZING)).toMatchObject({ owned: 0, left: 0 })
    expect(allocateSet([cap(1, 5)], [], PYTHON_SIZING)).toMatchObject({ owned: 5, left: 5 })
  })
})
