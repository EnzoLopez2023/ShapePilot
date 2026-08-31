import { describe, expect, test } from 'vitest'
import { groupItems, setTotals, sizeLabel, sizeRows } from './summary.ts'
import type { CoverageRow, SetItem } from './types.ts'

const item = (over: Partial<SetItem> & { units: number }): SetItem => ({ count: 1, ...over })

describe('sizeLabel', () => {
  test('writes a size the way the palette does', () => {
    expect(sizeLabel(1, 1)).toBe('1u')
    expect(sizeLabel(1.25, 1)).toBe('1.25u')
    expect(sizeLabel(6.25, 1)).toBe('6.25u')
  })

  test('names a two-row cap and the ISO Enter', () => {
    expect(sizeLabel(1, 2)).toBe('1u x 2')
    expect(sizeLabel(1.5, 2, 'iso-enter')).toBe('ISO Enter')
  })
})

describe('sizeRows', () => {
  test('aggregates line items into the size breakdown', () => {
    const items = [
      item({ units: 1, count: 35, legend: 'alphas' }),
      item({ units: 1, count: 12, group: 'Function keys' }),
      item({ units: 1.25, count: 5 }),
      item({ units: 6.25, count: 1, legend: 'Space' }),
    ]
    const rows = sizeRows(items, [])
    expect(rows.map(r => [r.units, r.owned])).toEqual([[1, 47], [1.25, 5], [6.25, 1]])
  })

  test('joins pockets against caps by size', () => {
    const items = [item({ units: 1, count: 35 }), item({ units: 2.25, count: 2 })]
    const coverage: CoverageRow[] = [
      { units: 1, heightUnits: 1, shape: null, pockets: 28 },
      { units: 2.25, heightUnits: 1, shape: null, pockets: 2 },
    ]
    const rows = sizeRows(items, coverage)
    expect(rows[0]).toMatchObject({ units: 1, owned: 35, placed: 28, remaining: 7, overflow: 0 })
    expect(rows[1]).toMatchObject({ units: 2.25, owned: 2, placed: 2, remaining: 0 })
  })

  test('a pocket with no cap behind it reads as overflow, not negative remaining', () => {
    const rows = sizeRows([], [{ units: 1, heightUnits: 1, shape: null, pockets: 3 }])
    expect(rows[0]).toMatchObject({ owned: 0, placed: 3, remaining: 0, overflow: 3 })
  })

  test('a two-row cap and a one-row cap of the same width are different sizes', () => {
    const rows = sizeRows(
      [item({ units: 2, count: 1 }), item({ units: 2, heightUnits: 2, count: 1 })], [])
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.heightUnits)).toEqual([1, 2])
  })

  test('an ISO Enter never merges into a rectangular pocket of the same width', () => {
    const rows = sizeRows([item({ units: 1.5, shape: 'iso-enter', count: 1 })],
      [{ units: 1.5, heightUnits: 1, shape: null, pockets: 1 }])
    expect(rows).toHaveLength(2)
  })
})

describe('setTotals', () => {
  test('counts caps, rows, placed and remaining', () => {
    const items = [item({ units: 1, count: 35 }), item({ units: 1.25, count: 5 })]
    const coverage: CoverageRow[] = [{ units: 1, heightUnits: 1, shape: null, pockets: 30 }]
    expect(setTotals(sizeRows(items, coverage), items))
      .toEqual({ caps: 40, entries: 2, placed: 30, remaining: 10 })
  })

  test('placed never counts a pocket beyond the caps that exist', () => {
    const items = [item({ units: 1, count: 2 })]
    const coverage: CoverageRow[] = [{ units: 1, heightUnits: 1, shape: null, pockets: 9 }]
    expect(setTotals(sizeRows(items, coverage), items).placed).toBe(2)
  })
})

describe('groupItems', () => {
  test('keeps the order the groups first appear in', () => {
    const grouped = groupItems([
      item({ units: 1, group: 'Alphas' }),
      item({ units: 1.25, group: 'Modifiers' }),
      item({ units: 1, group: 'Alphas' }),
      item({ units: 1 }),
    ])
    expect(grouped.map(g => g.group)).toEqual(['Alphas', 'Modifiers', 'Ungrouped'])
    expect(grouped[0].items).toHaveLength(2)
  })
})
