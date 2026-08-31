import { describe, expect, test } from 'vitest'
import { groupItems, sizeLabel } from './summary.ts'
import type { SetItem } from './types.ts'

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
