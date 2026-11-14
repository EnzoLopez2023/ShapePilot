import { describe, expect, test } from 'vitest'
import { pickStarterTrays, starterTrayName } from './starterTrays.ts'

const tray = (id: string, projectName: string | null, name: string) => ({ id, projectName, name })

describe('pickStarterTrays', () => {
  test('takes the four sample trays in stack order', () => {
    const picked = pickStarterTrays([
      tray('4', 'Sample Tray', 'Bottom'),
      tray('2', 'Sample Tray', 'Middle 1'),
      tray('9', 'Sample Tray', 'Spare'),
      tray('1', 'Sample Tray', 'Top'),
      tray('3', 'Sample Tray', 'Middle 2'),
    ])
    expect(picked).toEqual([
      { sourceId: '1', label: 'Top' },
      { sourceId: '2', label: 'Middle 1' },
      { sourceId: '3', label: 'Middle 2' },
      { sourceId: '4', label: 'Bottom' },
    ])
  })

  test('ignores trays with the same names in other projects', () => {
    expect(pickStarterTrays([
      tray('1', 'Ghost in the Shell', 'Ghost in the Shell - Top'),
      tray('2', null, 'Top'),
    ])).toEqual([])
  })

  test('matches case-insensitively and prefixed names', () => {
    expect(pickStarterTrays([
      tray('1', 'sample tray', 'Sample Tray - top'),
      tray('2', 'sample tray', 'MIDDLE  1'),
    ])).toEqual([
      { sourceId: '1', label: 'Top' },
      { sourceId: '2', label: 'Middle 1' },
    ])
  })

  test('skips a label the sample has no tray for', () => {
    expect(pickStarterTrays([tray('1', 'Sample Tray', 'Top')]))
      .toEqual([{ sourceId: '1', label: 'Top' }])
  })
})

describe('starterTrayName', () => {
  test('prefixes the project name', () => {
    expect(starterTrayName(' Ghost in the Shell ', 'Top')).toBe('Ghost in the Shell - Top')
  })

  test('clips a long project name to the tray name limit', () => {
    const name = starterTrayName('x'.repeat(200), 'Middle 1')
    expect(name).toHaveLength(200)
    expect(name.endsWith(' - Middle 1')).toBe(true)
  })
})
