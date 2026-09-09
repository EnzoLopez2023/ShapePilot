import { describe, expect, test } from 'vitest'
import {
  getPreset, profileInternalClearHeight, profileLidRecessHeight, profileToMulti,
  profileTotalClearHeight, profileUndersideReliefs,
} from './trayProfile.ts'
import type { TrayProfile } from './trayProfile.ts'
import { multiArea, multiBBox, ringBBox } from '../geometry/vec.ts'
import { difference } from '../geometry/boolean.ts'

const NOTCHED: TrayProfile = { kind: 'preset', id: 'systainer-s76-notched' }
const PLAIN: TrayProfile = { kind: 'preset', id: 'systainer-s76-plain' }

describe('SYS3 S 76 case heights', () => {
  // Festool's published spec: external 265 x 171 x 71, internal 258 x 164 x 67.
  // The 67 is floor-to-lid with the case shut; the base cavity alone is ~48.
  // This replaced an estimate of 63 derived from the outer height.
  test('the clear height is the base cavity, not the lid recess as well', () => {
    for (const p of [NOTCHED, PLAIN]) {
      expect(profileInternalClearHeight(p)).toBe(48)
      expect(profileLidRecessHeight(p)).toBe(19)
      expect(profileTotalClearHeight(p)).toBe(67)
    }
  })

  test('base cavity plus lid recess is what Festool publish as the internal height', () => {
    const p = getPreset('systainer-s76-notched')
    expect(p.baseCavityHeightMm + p.lidRecessHeightMm).toBe(67)
  })

  test('a profile with no case behind it reports no height at all', () => {
    const rect: TrayProfile = { kind: 'rect', widthMm: 100, heightMm: 80 }
    expect(profileInternalClearHeight(rect)).toBeNull()
    expect(profileLidRecessHeight(rect)).toBeNull()
    expect(profileTotalClearHeight(rect)).toBeNull()
  })
})

describe('underside lift recesses', () => {
  test('only the notched outline carries them, and there are four', () => {
    expect(profileUndersideReliefs(NOTCHED)).toHaveLength(4)
    expect(profileUndersideReliefs(PLAIN)).toHaveLength(0)
    expect(profileUndersideReliefs({ kind: 'rect', widthMm: 10, heightMm: 10 })).toHaveLength(0)
  })

  /**
   * The load-bearing test of the whole feature. These are stored in the RAW
   * frame and turned 180 degrees about the *outline's* pivot, not their own --
   * a rectangle turned about its own centre is a no-op, which would leave the
   * keep-out in the wrong corner with nothing downstream to catch it.
   *
   * Measured from the community 3MF template: 18.5 mm inboard, 5 mm tall, and
   * y bands that are genuinely NOT symmetric about the tray centre.
   */
  test('they land where they were measured, in the served frame', () => {
    const boxes = profileUndersideReliefs(NOTCHED)
      .map(r => ringBBox(r.ring))
      // `|| 0` normalises the negative zero a 180 degree rotation produces,
      // which toEqual otherwise reports as a difference.
      .map(b => [
        Number(b.minX.toFixed(3)) || 0, Number(b.minY.toFixed(3)) || 0,
        Number(b.maxX.toFixed(3)) || 0, Number(b.maxY.toFixed(3)) || 0,
      ])
      .sort((a, b) => (a[1]! - b[1]!) || (a[0]! - b[0]!))

    expect(boxes).toEqual([
      [0, 37.242, 18.5, 57.242],
      [230.5, 37.242, 249, 57.242],
      [0, 110.742, 18.5, 130.742],
      [230.5, 110.742, 249, 130.742],
    ])
  })

  test('the y bands are asymmetric about the tray centre -- not a transcription slip', () => {
    const cy = getPreset('systainer-s76-notched').heightMm / 2
    const mids = profileUndersideReliefs(NOTCHED)
      .map(r => { const b = ringBBox(r.ring); return (b.minY + b.maxY) / 2 - cy })
      .map(v => Number(v.toFixed(2)))
    // Two distinct offsets from the centre, and they do not mirror each other.
    const distinct = [...new Set(mids)].sort((a, b) => a - b)
    expect(distinct).toHaveLength(2)
    expect(distinct[0]! + distinct[1]!).not.toBeCloseTo(0, 1)
  })

  test('each reaches 18.5 mm inboard and is 5 mm tall', () => {
    for (const r of profileUndersideReliefs(NOTCHED)) {
      const b = ringBBox(r.ring)
      expect(b.maxX - b.minX).toBeCloseTo(18.5, 6)
      expect(b.maxY - b.minY).toBeCloseTo(20, 6)
      expect(r.heightMm).toBe(5)
    }
  })

  test('every relief sits on solid material -- it cuts the tray, not thin air', () => {
    const region = profileToMulti(NOTCHED)
    for (const r of profileUndersideReliefs(NOTCHED)) {
      // Wholly inside the outline, so the relief is a real pocket in the
      // underside rather than a notch hanging off the edge.
      expect(multiArea(difference([[r.ring]], region))).toBeLessThan(1e-6)
    }
  })

  test('they touch the outer edge, which is how a hex key gets in', () => {
    const bb = multiBBox(profileToMulti(NOTCHED))
    for (const r of profileUndersideReliefs(NOTCHED)) {
      const b = ringBBox(r.ring)
      const atEdge = Math.abs(b.minX - bb.minX) < 1e-6 || Math.abs(b.maxX - bb.maxX) < 1e-6
      expect(atEdge).toBe(true)
    }
  })

  test('the keep-out a validator derives from them excludes 104 and admits 103', () => {
    // Pins the frame conversion in the terms the plan states it: in a frame
    // centred on the tray, a pocket edge at |x| = 104 fouls a recess and one
    // at |x| = 103 does not, once the 2.5 mm dam is allowed for.
    const DAM = 2.5
    const halfW = getPreset('systainer-s76-notched').widthMm / 2
    const inboardEdge = profileUndersideReliefs(NOTCHED)
      .map(r => { const b = ringBBox(r.ring); return Math.min(Math.abs(b.minX - halfW), Math.abs(b.maxX - halfW)) })
    const nearest = Math.min(...inboardEdge)
    expect(nearest).toBeCloseTo(106, 6)
    expect(nearest - DAM).toBeCloseTo(103.5, 6)
    expect(104).toBeGreaterThan(nearest - DAM)
    expect(103).toBeLessThan(nearest - DAM)
  })
})

describe('the 180 degree correction still applies to the outline', () => {
  test('turning the reliefs did not move the outline', () => {
    // The notched outline's own bbox is unchanged by a 180 turn about its
    // centre, so this pins the size rather than the orientation; the
    // orientation itself is pinned by keycap-tray/model/presets.test.ts.
    const bb = multiBBox(profileToMulti(NOTCHED))
    expect(bb.maxX - bb.minX).toBeCloseTo(249, 6)
    expect(bb.maxY - bb.minY).toBeCloseTo(165.4826, 3)
  })
})
