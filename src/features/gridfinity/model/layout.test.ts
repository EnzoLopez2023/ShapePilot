import { describe, expect, it } from 'vitest'
import { DEFAULT_BASEPLATE, DEFAULT_BIN, type GridfinityBinParams } from '../../../../lib/contracts/gridfinity.ts'
import { binCounts, canPlace, heightLimit, resolveLayout, stackAt, stackHeight, type LayoutBin } from './layout.ts'

const bin = (id: string, over: Partial<GridfinityBinParams> = {}): LayoutBin =>
  ({ id, name: id, params: { ...DEFAULT_BIN, gridY: 1, ...over } })

const S76 = { ...DEFAULT_BASEPLATE, container: 'systainer-s76-notched' as const }
const grid = { cellsX: 5, cellsY: 3 }

describe('case layout', () => {
  it('adds the walls of a stack and only the top bin’s lip and lid', () => {
    const three = { ...DEFAULT_BIN, heightUnits: 3 }
    const two = { ...DEFAULT_BIN, heightUnits: 2 }
    expect(stackHeight([three, { ...two, stackingLip: false }])).toBeCloseTo(35, 6)
    expect(stackHeight([three, two])).toBeCloseTo(39.4, 6)
    expect(stackHeight([three, { ...two, lid: true }])).toBeCloseTo(41.4, 6)
    expect(stackHeight([])).toBe(0)
  })

  it('checks a Systainer against its base, a drawer only when given a height', () => {
    expect(heightLimit(S76)).toBe(48)
    expect(heightLimit(DEFAULT_BASEPLATE)).toBeNull()
    expect(heightLimit({ ...DEFAULT_BASEPLATE, heightLimitMm: 80 })).toBe(80)
  })

  it('flags stacks that are too tall, unheld, lidded underneath, off the plate or overlapping', () => {
    const bins = new Map([
      bin('tall', { heightUnits: 7 }), bin('flat', { stackingLip: false, heightUnits: 2 }),
      bin('lidded', { lid: true, heightUnits: 2 }), bin('wide', { gridX: 2, gridY: 1, heightUnits: 2 }),
    ].map(b => [b.id, b]))
    const stacks = resolveLayout({
      ...S76,
      layout: [
        { col: 0, row: 0, stack: ['tall'] },
        { col: 1, row: 0, stack: ['flat', 'flat'] },
        { col: 2, row: 0, stack: ['lidded', 'flat'] },
        { col: 4, row: 0, stack: ['wide'] },
        { col: 1, row: 1, stack: ['wide', 'wide'], rotated: true },
        { col: 1, row: 2, stack: ['gone'] },
      ],
    }, grid, bins)
    const said = (i: number, text: string) => stacks[i].problems.some(p => p.includes(text))
    expect(said(0, 'over the 48 mm')).toBe(true)
    expect(said(1, 'no stacking lip')).toBe(true)
    expect(said(2, 'has a lid')).toBe(true)
    expect(said(3, 'off the plate')).toBe(true)
    // Turned, the 2x1 is 1 wide and 2 deep: from row 1 it covers row 2 as well.
    expect([stacks[4].cellsX, stacks[4].cellsY]).toEqual([1, 2])
    expect(stacks[4].problems).toEqual([])
    expect(said(5, 'deleted')).toBe(true)
    expect(said(5, 'Overlaps')).toBe(true)
  })

  it('finds free room and the stack on a cell', () => {
    const bins = new Map([bin('a', { gridX: 2, gridY: 2 })].map(b => [b.id, b]))
    const stacks = resolveLayout({ ...S76, layout: [{ col: 1, row: 1, stack: ['a'] }] }, grid, bins)
    expect(stackAt(stacks, 2, 2)?.index).toBe(0)
    expect(stackAt(stacks, 0, 0)).toBeUndefined()
    expect(canPlace(stacks, grid, { col: 0, row: 0, cellsX: 1, cellsY: 3 })).toBe(true)
    expect(canPlace(stacks, grid, { col: 0, row: 0, cellsX: 2, cellsY: 2 })).toBe(false)
    expect(canPlace(stacks, grid, { col: 4, row: 0, cellsX: 2, cellsY: 1 })).toBe(false)
  })

  it('counts each saved bin across every stack', () => {
    expect(binCounts([{ col: 0, row: 0, stack: ['a', 'b'] }, { col: 1, row: 0, stack: ['a'] }]))
      .toEqual(new Map([['a', 2], ['b', 1]]))
  })
})
