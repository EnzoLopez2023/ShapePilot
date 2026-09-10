import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import {
  DEFAULT_FINGER_ACCESS, FINGER_ACCESS_PRESETS, fingerAccessFrom, fingerAccessPresetOf,
} from './fingerAccess.ts'
import { PART_PRESETS } from './partPresets.ts'

describe('finger access library', () => {
  // The whole reason the library exists: the panel used to default to 12 mm,
  // which is narrower than the fingertip it is supposed to admit.
  test('nothing is narrower than a fingertip', () => {
    for (const preset of FINGER_ACCESS_PRESETS) {
      assert.ok(preset.widthMm >= 16,
        `${preset.label} is ${preset.widthMm} mm, too narrow to get a finger into`)
      assert.ok(preset.reachMm > 0, `${preset.label} does not reach past the wall`)
    }
  })

  test('ids are unique, so one can be found by it', () => {
    const ids = FINGER_ACCESS_PRESETS.map(p => p.id)
    assert.equal(new Set(ids).size, ids.length)
  })

  test('a placed access keeps the shape of the preset it came from', () => {
    for (const preset of FINGER_ACCESS_PRESETS) {
      const placed = fingerAccessFrom(preset, 'top')
      assert.equal(placed.side, 'top')
      assert.deepEqual(fingerAccessPresetOf(placed), preset)
    }
  })

  test('moving an access to another side does not lose its identity', () => {
    const placed = fingerAccessFrom(DEFAULT_FINGER_ACCESS, 'left')
    assert.deepEqual(fingerAccessPresetOf({ ...placed, side: 'bottom' }), DEFAULT_FINGER_ACCESS)
  })

  test('an access dialled away from every preset belongs to none', () => {
    const placed = fingerAccessFrom(DEFAULT_FINGER_ACCESS, 'left')
    assert.equal(fingerAccessPresetOf({ ...placed, widthMm: placed.widthMm + 1 }), undefined)
  })
})

describe('every part brings a way out', () => {
  // A pocket measured to fit a part closely is the pocket that keeps it. This
  // is the assertion that stops a new preset shipping without one.
  test('each part preset carries finger access', () => {
    for (const part of PART_PRESETS) {
      assert.ok(part.fingerAccess, `${part.label} has no way to lift the part out`)
    }
  })

  test('each one is a library preset, not a hand-dialled one-off', () => {
    for (const part of PART_PRESETS) {
      assert.ok(fingerAccessPresetOf(part.fingerAccess!),
        `${part.label} uses finger access that is not in the library`)
    }
  })

  // Reaching under a part means reaching from a side long enough to get a hand
  // to, and the scoop cannot be wider than the wall it breaks.
  test('the scoop sits on a side wide enough to hold it', () => {
    for (const part of PART_PRESETS) {
      const fa = part.fingerAccess!
      const side = fa.side === 'left' || fa.side === 'right' ? part.heightMm : part.widthMm
      assert.ok(fa.widthMm <= side,
        `${part.label}: a ${fa.widthMm} mm scoop does not fit a ${side} mm side`)
    }
  })
})
