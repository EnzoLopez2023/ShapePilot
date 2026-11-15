import { describe, expect, it } from 'vitest'
import { batchNames } from './batchName.ts'

const base = {
  listName: 'Fgruh M3 bolts, nuts and washers (2300 pcs)',
  heightUnits: 3,
  want: { bins: false, labels: false, lids: true },
  blank: true,
  footprints: [{ gridX: 1, gridY: 1 }, { gridX: 1, gridY: 2 }, { gridX: 1, gridY: 1 }],
}

describe('batch export names', () => {
  it('says what was printed, how tall, and how many of each size', () => {
    expect(batchNames(base)).toEqual({
      title: 'Fgruh M3 bolts, nuts and washers (2300 pcs) – Lids – 3u – 2 × 1×1, 1 × 1×2',
      stem: 'Fgruh_M3_bolts_nuts_and_washers_2300_lids_3u_2-of-1x1_1-of-1x2',
    })
  })

  it('tells two runs off one list apart', () => {
    const small = batchNames({ ...base, footprints: [{ gridX: 1, gridY: 1 }] })
    const large = batchNames({ ...base, footprints: [{ gridX: 1, gridY: 2 }] })
    const labels = batchNames({ ...base, want: { bins: false, labels: true, lids: false }, footprints: [{ gridX: 1, gridY: 1 }] })
    expect(new Set([small.title, large.title, labels.title]).size).toBe(3)
    expect(new Set([small.stem, large.stem, labels.stem]).size).toBe(3)
  })

  it('names every part of a full run, and marks blank bins', () => {
    const all = batchNames({ ...base, want: { bins: true, labels: true, lids: true } })
    expect(all.title).toContain('Blank bins + glue-on labels + lids')
    expect(all.stem).toContain('blank-bins+glue-on-labels+lids')
    expect(batchNames({ ...base, blank: false, want: { bins: true, labels: false, lids: false } }).title).toContain('– Bins –')
  })
})
