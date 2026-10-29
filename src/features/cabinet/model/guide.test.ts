import { describe, expect, test } from 'vitest'
import { DEFAULT_CABINET } from './cabinet.ts'
import { buildGuide, cuttingOrder, roughCutList } from './guide.ts'
import { guideHtml } from '../export/guideHtml.ts'
import { BENCHPILOT_REACH } from '../../../model/benchpilot.ts'

const mm = (v: number) => `${+v.toFixed(2)} mm`

describe('the 12-tray sample case', () => {
  const rows = roughCutList(DEFAULT_CABINET, 20)

  test('each blank is the panel plus the allowance, rounded up to 5 mm', () => {
    expect(rows.map(r => [r.part, r.count, r.roughLengthMm, r.roughWidthMm])).toEqual([
      ['Side', 2, 355, 195],
      ['Top / bottom', 2, 260, 195],
      ['Back', 1, 340, 275],
    ])
  })

  test('a blank is never smaller than its panel', () => {
    for (const r of rows) {
      expect(r.roughLengthMm).toBeGreaterThanOrEqual(r.finishedLengthMm)
      expect(r.roughWidthMm).toBeGreaterThanOrEqual(r.finishedWidthMm)
    }
  })

  test('the two thicknesses are broken down separately, thickest first', () => {
    const order = cuttingOrder(rows)
    expect(order.map(g => g.thicknessMm)).toEqual([12.7, 6.35])
    expect(order[0].rips.map(r => r.widthMm)).toEqual([195])
    expect(order.every(g => g.sheets === 1)).toBe(true)
  })

  test('the guide has no cleat steps without a cleat', () => {
    const ids = buildGuide(DEFAULT_CABINET, 20, mm).steps.map(s => s.id)
    expect(ids).toEqual(['breakdown', 'sides', 'top-bottom', 'back', 'dry-fit', 'assemble'])
  })
})

describe('with a French cleat', () => {
  const p = { ...DEFAULT_CABINET, frenchCleat: true }

  test('the cleats are one sawn strip, the spacer is sawn to size', () => {
    const rows = roughCutList(p, 20)
    const strip = rows.find(r => r.part === 'French cleat strip')!
    expect(strip.count).toBe(1)
    expect(strip.machine).toBe('saw')
    expect(strip.roughWidthMm).toBeCloseTo(2 * 50.8 - 12.7 + 3.2)
    expect(rows.find(r => r.part === 'Cleat spacer')!.roughWidthMm).toBeCloseTo(25.4)
  })

  test('the guide adds the cleat steps', () => {
    const ids = buildGuide(p, 20, mm).steps.map(s => s.id)
    expect(ids).toContain('cleat')
    expect(ids).toContain('cleat-fit')
  })
})

test('the page flags a blank that will not fit the cut area', () => {
  const big = { ...DEFAULT_CABINET, trayCount: 30 }
  const html = guideHtml(big, {
    title: 'Big', imperial: false, marginMm: 20, reach: BENCHPILOT_REACH.workstation,
  })
  expect(html).toContain('Too big')
  expect(guideHtml(DEFAULT_CABINET, {
    title: '<x>', imperial: false, marginMm: 20, reach: null,
  })).toContain('&lt;x&gt;')
})
